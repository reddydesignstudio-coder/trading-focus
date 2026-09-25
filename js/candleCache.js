// js/candleCache.js
//
// Persistent Candle Cache
// --------------------------------------------------------------
// Wires up the `marketCache` IndexedDB store, which existed in the
// schema but was never actually used — every previous "cache" was
// in-memory only (dataProviders/index.js's short-TTL Map), lost on
// every reload. This module makes candle history survive across
// sessions, on THIS device, and lets the rolling window grow forward
// over time rather than being re-fetched from scratch on every visit.
//
// Honest scope: this is a LAZY cache. It is only ever checked and
// refreshed when a scan actually runs — there is no backend process
// keeping it warm while nobody's looking. That's a real, deliberate
// trade-off (see PROJECT_DESCRIPTION.md's V2 discussion for what a
// proactive version would need), not an oversight.
//
// Also deliberately excluded: DEMO data is never persisted here. Demo
// candles are synthetic/seeded and would corrupt a real cache if
// merged into it — they stay exactly as ephemeral as they've always
// been.

import { get, put } from "./db.js";

export const DEFAULT_MAX_CANDLES = 2000;
export const MINIMUM_CANDLES_FOR_READY = 60;

const TIMEFRAME_MS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };

function cacheKey(symbol, market, timeframe) {
  return `${market}:${symbol}:${timeframe}`;
}

export async function getCachedCandles(symbol, market, timeframe) {
  const record = await get("marketCache", cacheKey(symbol, market, timeframe));
  return record?.candles || [];
}

/**
 * Merges freshly-fetched candles into whatever's already stored,
 * de-duplicating by timestamp (the newly-fetched value wins on overlap,
 * since it's the more current read of that candle), sorts chronologically,
 * and trims to maxCandles from the newest end — the rolling-window
 * behavior. Because this is a MERGE, not a replace, the stored history
 * can grow past whatever a single fetch's `limit` returns, one real
 * fetch at a time, exactly the "build forward" behavior the V2 planning
 * doc described — just running lazily against real scans instead of a
 * schedule. `meta` (dataStatus, source) is stored alongside so a later
 * cache-served response can honestly report where the data came from
 * and how current it was represented to be — the cache never upgrades
 * a DELAYED read into something that looks LIVE.
 */
export async function mergeAndStoreCandles(symbol, market, timeframe, newCandles, maxCandles = DEFAULT_MAX_CANDLES, meta = {}) {
  if (!newCandles || !newCandles.length) return null;
  const key = cacheKey(symbol, market, timeframe);
  const existing = await get("marketCache", key);
  const existingCandles = existing?.candles || [];
  const byTimestamp = new Map(existingCandles.map((c) => [c.t, c]));
  newCandles.forEach((c) => byTimestamp.set(c.t, c));
  const merged = [...byTimestamp.values()].sort((a, b) => a.t - b.t);
  const trimmed = merged.length > maxCandles ? merged.slice(merged.length - maxCandles) : merged;
  const record = {
    key,
    symbol,
    market,
    timeframe,
    candles: trimmed,
    storedCount: trimmed.length,
    maxCandles,
    lastUpdated: Date.now(),
    dataStatus: meta.dataStatus ?? existing?.dataStatus ?? null,
    source: meta.source ?? existing?.source ?? null,
  };
  await put("marketCache", record);
  return record;
}

/** Full stored record (candles + status/source/timestamps metadata), or null if nothing's cached yet. */
export async function getCachedRecord(symbol, market, timeframe) {
  return (await get("marketCache", cacheKey(symbol, market, timeframe))) || null;
}

/** The most recent candle boundary that has definitely fully closed, for a given timeframe, as of `now`. */
export function expectedLatestCompletedCandleTime(timeframe, now = Date.now()) {
  const intervalMs = TIMEFRAME_MS[timeframe];
  if (!intervalMs) return null;
  return Math.floor(now / intervalMs) * intervalMs - intervalMs;
}

/**
 * READY | STALE | INSUFFICIENT_HISTORY — the lazy, on-scan version of
 * the readiness check. Never fetches anything itself; purely reads
 * what's already stored and compares against the current clock.
 */
export async function assessFreshness(symbol, market, timeframe, minimumCandles = MINIMUM_CANDLES_FOR_READY, now = Date.now()) {
  const candles = await getCachedCandles(symbol, market, timeframe);
  if (!candles.length) {
    return { status: "INSUFFICIENT_HISTORY", storedCount: 0, reason: "No cached history yet for this symbol/timeframe." };
  }
  if (candles.length < minimumCandles) {
    return { status: "INSUFFICIENT_HISTORY", storedCount: candles.length, reason: `Only ${candles.length} candles cached; need at least ${minimumCandles}.` };
  }
  const expected = expectedLatestCompletedCandleTime(timeframe, now);
  const latestStored = candles[candles.length - 1].t;
  if (expected === null) return { status: "READY", storedCount: candles.length, latestStored }; // unrecognized timeframe — don't block on it
  if (latestStored < expected) {
    return { status: "STALE", storedCount: candles.length, latestStored, expectedLatest: expected };
  }
  return { status: "READY", storedCount: candles.length, latestStored };
}
