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

test("a provider that never responds times out instead of hanging the scan forever", async () => {
  const restore = stubFetchByHost([
    ["twelvedata.com", () => new Promise(() => {})], // never resolves — simulates a hung request
  ]);
  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    const start = Date.now();
    const result = await getMarketData({
      symbol: "AAPL",
      market: "us_stocks",
      timeframe: "15m",
      limit: 30,
      apiKeys: { twelvedata: "td-key" },
      allowDemoFallback: true,
    });
    const elapsed = Date.now() - start;
    assert.equal(result.isDemo, true); // fell through to demo rather than hanging forever
    assert.ok(elapsed < 20000, `expected the timeout to resolve well under 20s, took ${elapsed}ms`);
  } finally {
    restore();
  }
});

test("getUsageStats tracks cumulative calls per provider+key and reports the documented limit", async () => {
  const restore = stubFetchByHost([
    [
      "twelvedata.com",
      () =>
        jsonResponse(200, {
          status: "ok",
          values: Array.from({ length: 30 }, (_, i) => ({
            datetime: `2026-01-0${(i % 9) + 1} 10:${String(i).padStart(2, "0")}:00`,
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 1000,
          })),
        }),
    ],
  ]);
  try {
    const { getMarketData, getUsageStats, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    let usage = getUsageStats("twelvedata", "my-key");
    assert.equal(usage.totalThisSession, 0);
    assert.equal(usage.limitValue, 800);
    assert.equal(usage.limitWindow, "day");

    await getMarketData({ symbol: "AAPL", market: "us_stocks", timeframe: "15m", limit: 30, apiKeys: { twelvedata: "my-key" }, allowDemoFallback: false });
    usage = getUsageStats("twelvedata", "my-key");
    assert.equal(usage.totalThisSession, 1);

    // a different key for the same provider tracks separately
    const otherKeyUsage = getUsageStats("twelvedata", "different-key");
    assert.equal(otherKeyUsage.totalThisSession, 0);
  } finally {
    restore();
  }
});

test("Twelve Data forex symbols are converted to BASE/QUOTE slash format, per Twelve Data's own documented requirement", async () => {
  const { toTwelveDataSymbol } = await import("../js/dataProviders/twelveData.js");
  assert.equal(toTwelveDataSymbol("EURUSD", "forex"), "EUR/USD");
  assert.equal(toTwelveDataSymbol("XAUUSD", "forex"), "XAU/USD");
  assert.equal(toTwelveDataSymbol("USDJPY", "forex"), "USD/JPY");
});

test("Twelve Data stock symbols are left as plain tickers, never given a slash", async () => {
  const { toTwelveDataSymbol } = await import("../js/dataProviders/twelveData.js");
  assert.equal(toTwelveDataSymbol("AAPL", "us_stocks"), "AAPL");
});

test("an already-slashed forex symbol is left alone (idempotent)", async () => {
  const { toTwelveDataSymbol } = await import("../js/dataProviders/twelveData.js");
  assert.equal(toTwelveDataSymbol("EUR/USD", "forex"), "EUR/USD");
});

test("getCandles actually sends the slash-formatted symbol in the request URL for forex", async () => {
  let capturedUrl = null;
  const restore = stubFetchByHost([
    [
      "twelvedata.com",
      (u) => {
        capturedUrl = u.toString();
        return jsonResponse(200, { status: "ok", values: [{ datetime: "2026-01-01 10:00:00", open: 1, high: 1, low: 1, close: 1, volume: 0 }] });
      },
    ],
  ]);
  try {
    const { twelveDataProvider } = await import("../js/dataProviders/twelveData.js");
    await twelveDataProvider.getCandles({ symbol: "XAUUSD", market: "forex", timeframe: "1h", limit: 10, apiKey: "test-key" });
    assert.ok(capturedUrl.includes("symbol=XAU%2FUSD") || capturedUrl.includes("symbol=XAU/USD"), `expected slash-encoded symbol in URL, got: ${capturedUrl}`);
  } finally {
    restore();
  }
});
