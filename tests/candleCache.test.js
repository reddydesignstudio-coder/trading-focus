import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeIndexedDB } from "./helpers/fakeIndexedDB.js";
import { _resetForTests } from "../js/db.js";
import { getCachedCandles, mergeAndStoreCandles, expectedLatestCompletedCandleTime, assessFreshness } from "../js/candleCache.js";

function candle(t, c = 100) {
  return { t, o: c, h: c + 1, l: c - 1, c, v: 1000 };
}

test("getCachedCandles returns an empty array when nothing has been cached yet", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const result = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.deepEqual(result, []);
});

test("mergeAndStoreCandles stores candles that can then be read back", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const candles = [candle(1000), candle(2000), candle(3000)];
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", candles);
  const stored = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.equal(stored.length, 3);
  assert.equal(stored[0].t, 1000);
});

test("mergeAndStoreCandles de-duplicates by timestamp — the newer fetch's value wins on overlap", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(1000, 100), candle(2000, 101)]);
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(2000, 999), candle(3000, 102)]); // 2000 refetched with a different value
  const stored = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.equal(stored.length, 3); // still just 3 distinct timestamps, not 4
  const t2000 = stored.find((c) => c.t === 2000);
  assert.equal(t2000.c, 999); // the newer merge's value won
});

test("mergeAndStoreCandles keeps chronological order regardless of input order", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(3000), candle(1000), candle(2000)]);
  const stored = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.deepEqual(stored.map((c) => c.t), [1000, 2000, 3000]);
});

test("mergeAndStoreCandles trims to maxCandles from the newest end — the rolling window", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const first50 = Array.from({ length: 50 }, (_, i) => candle((i + 1) * 1000));
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", first50, 30); // max 30
  const stored = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.equal(stored.length, 30);
  assert.equal(stored[0].t, 21000); // oldest 20 were trimmed off
  assert.equal(stored[29].t, 50000); // newest kept
});

test("mergeAndStoreCandles grows the stored window forward across repeated merges, up to the max", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(1000), candle(2000)], 2000);
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(3000), candle(4000)], 2000);
  const stored = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.equal(stored.length, 4); // grew from 2 to 4, nothing trimmed since well under max
});

test("different symbol/market/timeframe combinations never share or collide with each other's cache", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(1000)]);
  await mergeAndStoreCandles("AAPL", "us_stocks", "1h", [candle(1000), candle(2000)]);
  await mergeAndStoreCandles("MSFT", "us_stocks", "15m", [candle(1000), candle(2000), candle(3000)]);
  assert.equal((await getCachedCandles("AAPL", "us_stocks", "15m")).length, 1);
  assert.equal((await getCachedCandles("AAPL", "us_stocks", "1h")).length, 2);
  assert.equal((await getCachedCandles("MSFT", "us_stocks", "15m")).length, 3);
});

test("expectedLatestCompletedCandleTime returns the most recent fully-closed candle's OPEN timestamp, not the current (still-forming) one", () => {
  // 15m candles open at :00/:15/:30/:45. At 10:07 the currently-forming candle opened at 10:00
  // (still open, not closed yet), so the latest COMPLETED candle is the one that opened at 9:45
  // and closed at 10:00. Candles are indexed by their open time throughout this codebase.
  const now = new Date("2026-01-01T10:07:00.000Z").getTime();
  const expected = expectedLatestCompletedCandleTime("15m", now);
  assert.equal(expected, new Date("2026-01-01T09:45:00.000Z").getTime());
});

test("expectedLatestCompletedCandleTime returns null for an unrecognized timeframe rather than throwing", () => {
  assert.equal(expectedLatestCompletedCandleTime("3m", Date.now()), null);
});

test("assessFreshness reports INSUFFICIENT_HISTORY when nothing is cached", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const result = await assessFreshness("AAPL", "us_stocks", "15m");
  assert.equal(result.status, "INSUFFICIENT_HISTORY");
  assert.equal(result.storedCount, 0);
});

test("assessFreshness reports INSUFFICIENT_HISTORY when below the minimum, even if the data itself is current", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const now = new Date("2026-01-01T10:07:00.000Z").getTime();
  const latestCompleted = expectedLatestCompletedCandleTime("15m", now);
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", [candle(latestCompleted)]); // only 1 candle, current, but far below minimum
  const result = await assessFreshness("AAPL", "us_stocks", "15m", 60, now);
  assert.equal(result.status, "INSUFFICIENT_HISTORY");
});

test("assessFreshness reports STALE when enough history exists but the latest candle hasn't caught up to the clock", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const now = new Date("2026-01-01T10:07:00.000Z").getTime();
  const oldCandles = Array.from({ length: 60 }, (_, i) => candle(now - (70 - i) * 900000)); // last one well before the expected latest completed candle
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", oldCandles);
  const result = await assessFreshness("AAPL", "us_stocks", "15m", 60, now);
  assert.equal(result.status, "STALE");
});

test("assessFreshness reports READY when there's enough history and the latest candle matches the expected boundary", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const now = new Date("2026-01-01T10:07:00.000Z").getTime();
  const latestCompleted = expectedLatestCompletedCandleTime("15m", now);
  const candles = Array.from({ length: 60 }, (_, i) => candle(latestCompleted - (59 - i) * 900000));
  await mergeAndStoreCandles("AAPL", "us_stocks", "15m", candles);
  const result = await assessFreshness("AAPL", "us_stocks", "15m", 60, now);
  assert.equal(result.status, "READY");
  assert.equal(result.storedCount, 60);
});

test("getMarketData integration: a fresh fetch is persisted, and a second call within the same period serves from disk with ZERO network calls", async () => {
  const { installFakeIndexedDB } = await import("./helpers/fakeIndexedDB.js");
  installFakeIndexedDB();
  _resetForTests();

  let fetchCount = 0;
  const now = new Date("2026-01-01T10:07:00.000Z").getTime();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  Date.now = () => now;
  globalThis.fetch = async (url) => {
    fetchCount++;
    const u = new URL(url);
    if (u.hostname.includes("twelvedata.com")) {
      const { expectedLatestCompletedCandleTime } = await import("../js/candleCache.js");
      const latest = expectedLatestCompletedCandleTime("15m", now);
      const values = Array.from({ length: 70 }, (_, i) => {
        const t = latest - (69 - i) * 900000;
        const d = new Date(t);
        const pad = (n) => String(n).padStart(2, "0");
        return {
          datetime: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`,
          open: 100, high: 101, low: 99, close: 100.5, volume: 1000,
        };
      });
      return { ok: true, status: 200, json: async () => ({ status: "ok", values }) };
    }
    throw new Error(`unexpected fetch to ${u.hostname}`);
  };

  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();

    const first = await getMarketData({ symbol: "AAPL", market: "us_stocks", timeframe: "15m", limit: 70, apiKeys: { twelvedata: "test-key" } });
    assert.equal(fetchCount, 1);
    assert.equal(first.fromPersistentCache, undefined); // this one was a live fetch

    const second = await getMarketData({ symbol: "AAPL", market: "us_stocks", timeframe: "15m", limit: 70, apiKeys: { twelvedata: "test-key" } });
    assert.equal(fetchCount, 1); // no new network call — served entirely from the persistent cache
    assert.equal(second.fromPersistentCache, true);
    assert.equal(second.status, first.status); // honestly carries forward the original DELAYED status, never upgraded
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("with no keys configured, nothing gets fetched or written to the persistent cache — a clean UNAVAILABLE, never fabricated data filling the gap", async () => {
  const { installFakeIndexedDB } = await import("./helpers/fakeIndexedDB.js");
  installFakeIndexedDB();
  _resetForTests();
  const { getMarketData } = await import("../js/dataProviders/index.js?t=" + Date.now());
  const result = await getMarketData({ symbol: "AAPL", market: "us_stocks", timeframe: "15m", limit: 70, apiKeys: {} });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.isDemo, false);
  const cached = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.equal(cached.length, 0);
});

test("even the test-only explicit demo override (forceProviderId: 'demo', never used by the real app) still never lands in the persistent cache", async () => {
  const { installFakeIndexedDB } = await import("./helpers/fakeIndexedDB.js");
  installFakeIndexedDB();
  _resetForTests();
  const { getMarketData } = await import("../js/dataProviders/index.js?t=" + Date.now());
  await getMarketData({ symbol: "AAPL", market: "us_stocks", timeframe: "15m", limit: 70, apiKeys: {}, forceProviderId: "demo" });
  const cached = await getCachedCandles("AAPL", "us_stocks", "15m");
  assert.equal(cached.length, 0); // demo output must never land in the real persistent cache
});
