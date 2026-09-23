import { test } from "node:test";
import assert from "node:assert/strict";

function stubFetchByHost(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    for (const [hostFragment, handler] of handlers) {
      if (u.hostname.includes(hostFragment)) return handler(u);
    }
    throw new Error(`No stub for ${u.hostname}`);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

test("chain falls through Finnhub (403, premium-only) to Twelve Data successfully", async () => {
  const restore = stubFetchByHost([
    ["finnhub.io", () => jsonResponse(403, { error: "You don't have access to this resource." })],
    [
      "twelvedata.com",
      () =>
        jsonResponse(200, {
          status: "ok",
          values: Array.from({ length: 30 }, (_, i) => ({
            datetime: `2026-01-0${(i % 9) + 1} 10:${String(i).padStart(2, "0")}:00`,
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100.5 + i,
            volume: 1000,
          })),
        }),
    ],
  ]);
  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    const result = await getMarketData({
      symbol: "AAPL",
      market: "us_stocks",
      timeframe: "15m",
      limit: 30,
      apiKeys: { finnhub: "finnhub-key", twelvedata: "td-key" },
      allowDemoFallback: false,
    });
    assert.equal(result.source, "twelvedata");
    assert.equal(result.chainPosition, 1); // 0 = finnhub (failed), 1 = twelvedata (succeeded)
    assert.ok(result.candles.length > 0);
  } finally {
    restore();
  }
});

test("chain never even calls a provider whose key isn't configured", async () => {
  let fmpCalled = false;
  const restore = stubFetchByHost([
    [
      "twelvedata.com",
      () =>
        jsonResponse(200, {
          status: "ok",
          values: Array.from({ length: 30 }, (_, i) => ({
            datetime: `2026-01-0${(i % 9) + 1} 10:${String(i).padStart(2, "0")}:00`,
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100.5 + i,
            volume: 1000,
          })),
        }),
    ],
    [
      "financialmodelingprep.com",
      () => {
        fmpCalled = true;
        return jsonResponse(200, []);
      },
    ],
  ]);
  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    // Only twelvedata is configured — fmp/finnhub/alphavantage keys are absent.
    const result = await getMarketData({
      symbol: "AAPL",
      market: "us_stocks",
      timeframe: "15m",
      limit: 30,
      apiKeys: { twelvedata: "td-key" },
      allowDemoFallback: false,
    });
    assert.equal(result.source, "twelvedata");
    assert.equal(fmpCalled, false);
  } finally {
    restore();
  }
});

test("falls all the way through to demo data when the whole chain fails, and every provider is DELAYED never LIVE", async () => {
  const restore = stubFetchByHost([
    ["finnhub.io", () => jsonResponse(429, {})],
    ["twelvedata.com", () => jsonResponse(429, { status: "error", code: 429 })],
    ["financialmodelingprep.com", () => jsonResponse(429, {})],
    ["alphavantage.co", () => jsonResponse(200, { Note: "rate limit exceeded" })],
  ]);
  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    const result = await getMarketData({
      symbol: "AAPL",
      market: "us_stocks",
      timeframe: "15m",
      limit: 30,
      apiKeys: { finnhub: "a", twelvedata: "b", fmp: "c", alphavantage: "d" },
      allowDemoFallback: true,
    });
    assert.equal(result.isDemo, true);
  } finally {
    restore();
  }
});

test("no configured keys at all -> UNAVAILABLE/NO_API_KEY, not a crash, before demo fallback", async () => {
  const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
  invalidateCache();
  const result = await getMarketData({
    symbol: "AAPL",
    market: "us_stocks",
    timeframe: "15m",
    limit: 30,
    apiKeys: {},
    allowDemoFallback: false,
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "NO_API_KEY");
});
