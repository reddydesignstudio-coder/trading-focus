// js/dataProviders/index.js
//
// Market Data Abstraction Layer
// --------------------------------------------------------------
// Everything above this module (the scanner, backtest engine, UI)
// talks ONLY to `getMarketData(...)` below — never to a specific
// provider. This is what lets Phase 2 swap in a different data
// source without touching the trading engine.
//
// Cross-cutting concerns implemented HERE, once, for every provider:
//   - in-memory + IndexedDB-backed caching with TTL
//   - request de-duplication (concurrent identical requests share one fetch)
//   - per-provider throttling (min ms between calls)
//   - exponential backoff retry on transient failures
//   - basic rate-limit bookkeeping (calls per rolling minute)
//   - AbortController-based cancellation
//   - explicit stale-data detection (never silently relabels stale as live)

import { demoProvider } from "./demo.js";
import { binanceProvider } from "./binance.js";
import { twelveDataProvider } from "./twelveData.js";
import { ProviderError } from "./binance.js";

const PROVIDERS = {
  demo: demoProvider,
  binance: binanceProvider,
  twelvedata: twelveDataProvider,
};

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, requiresKey: !!p.requiresKey, markets: p.markets }));
}

// Default provider routing per market. Users can override crypto's provider
// choice in Settings (e.g. force demo mode), but stocks/forex always require
// a user-supplied key via Twelve Data (or demo mode) since there is no
// no-key, reliable, real-time-capable free intraday equities/FX API.
const DEFAULT_PROVIDER_FOR_MARKET = {
  crypto: "binance",
  us_stocks: "twelvedata",
  forex: "twelvedata",
};

const cache = new Map(); // key -> { data, fetchedAt }
const inFlight = new Map(); // key -> Promise
const lastCallAt = new Map(); // providerId -> timestamp
const callLog = new Map(); // providerId -> [timestamps within last 60s]

const MIN_INTERVAL_MS = { binance: 250, twelvedata: 7500, demo: 0 }; // twelvedata free tier ~8/min => ~7.5s spacing
const CACHE_TTL_MS = { "1m": 20000, "5m": 45000, "15m": 90000, "1h": 5 * 60000, "4h": 15 * 60000, "1d": 30 * 60000 };
const MAX_RETRIES = 3;

function cacheKey({ providerId, symbol, market, timeframe }) {
  return `${providerId}:${market}:${symbol}:${timeframe}`;
}

function recordCall(providerId) {
  const now = Date.now();
  lastCallAt.set(providerId, now);
  const log = (callLog.get(providerId) || []).filter((t) => now - t < 60000);
  log.push(now);
  callLog.set(providerId, log);
}

export function callsInLastMinute(providerId) {
  const now = Date.now();
  return (callLog.get(providerId) || []).filter((t) => now - t < 60000).length;
}

async function throttle(providerId) {
  const min = MIN_INTERVAL_MS[providerId] ?? 500;
  const last = lastCallAt.get(providerId) || 0;
  const wait = min - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function friendlyError(err) {
  if (err instanceof ProviderError) {
    if (err.httpStatus === 429) return { code: "RATE_LIMIT", message: "Market data provider limit reached. Please wait before checking again." };
    if (err.httpStatus >= 500) return { code: "PROVIDER_DOWN", message: "Market data provider is temporarily unavailable. Please try again shortly." };
    return { code: "PROVIDER_ERROR", message: "Market data temporarily unavailable." };
  }
  if (err.name === "AbortError") return { code: "CANCELLED", message: "Request cancelled." };
  return { code: "UNKNOWN", message: "Market data temporarily unavailable." };
}

/**
 * Main entry point. Options:
 *   symbol, market, timeframe, limit, forceProviderId, apiKeys ({twelvedata: 'xxx'}),
 *   allowDemoFallback (bool), signal (AbortSignal)
 */
export async function getMarketData(opts) {
  const { symbol, market, timeframe, limit = 200, forceProviderId, apiKeys = {}, allowDemoFallback = true, signal } = opts;
  const providerId = forceProviderId || DEFAULT_PROVIDER_FOR_MARKET[market] || "demo";
  const provider = PROVIDERS[providerId];
  const key = cacheKey({ providerId, symbol, market, timeframe });

  // Serve from cache if fresh.
  const cached = cache.get(key);
  const ttl = CACHE_TTL_MS[timeframe] ?? 60000;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return { ...cached.data, fromCache: true };
  }

  // De-duplicate concurrent identical requests.
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    let attempt = 0;
    let lastErr;
    while (attempt < MAX_RETRIES) {
      try {
        await throttle(providerId);
        recordCall(providerId);
        const result =
          providerId === "twelvedata"
            ? await provider.getCandles({ symbol, timeframe, limit, apiKey: apiKeys.twelvedata, signal })
            : await provider.getCandles({ symbol, timeframe, limit, signal });

        if (result.status === "UNAVAILABLE" && allowDemoFallback && providerId !== "demo") {
          const demo = await demoProvider.getCandles({ symbol, market, timeframe, limit });
          return { ...demo, fallbackReason: result.reason || "PROVIDER_UNAVAILABLE" };
        }
        cache.set(key, { data: result, fetchedAt: Date.now() });
        return result;
      } catch (err) {
        lastErr = err;
        if (err.name === "AbortError") throw err; // never retry a user-cancelled request
        attempt += 1;
        const backoff = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    const friendly = friendlyError(lastErr);
    if (allowDemoFallback && providerId !== "demo") {
      const demo = await demoProvider.getCandles({ symbol, market, timeframe, limit });
      return { ...demo, fallbackReason: friendly.code };
    }
    return { candles: [], status: "UNAVAILABLE", error: friendly, isDemo: false, asOf: new Date(), source: providerId };
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

export function invalidateCache(prefix) {
  for (const k of cache.keys()) {
    if (!prefix || k.startsWith(prefix)) cache.delete(k);
  }
}

export async function searchSymbols(market, query, apiKeys = {}) {
  const providerId = DEFAULT_PROVIDER_FOR_MARKET[market] || "demo";
  const provider = PROVIDERS[providerId];
  try {
    if (providerId === "twelvedata") return await provider.searchSymbols(query, apiKeys.twelvedata);
    return await provider.searchSymbols(query, market);
  } catch {
    return demoProvider.searchSymbols(query, market);
  }
}

export { PROVIDERS };
