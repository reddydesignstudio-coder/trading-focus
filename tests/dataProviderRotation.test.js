import { test } from "node:test";
import assert from "node:assert/strict";

// We test the rotation LOGIC directly by stubbing global fetch, rather than
// reaching into dataProviders/index.js's module-private helper — this
// exercises the real code path (getMarketData -> twelvedata -> rotation)
// end to end.

function mockFetchSequence(responses) {
  let call = 0;
  globalThis.fetch = async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: r.status < 400,
      status: r.status,
      json: async () => r.body,
    };
  };
  return () => call;
}

test("falls back to the backup Twelve Data key when the primary is rate-limited", async () => {
  const originalFetch = globalThis.fetch;
  const values = Array.from({ length: 60 }, (_, i) => ({
    datetime: `2026-01-0${(i % 9) + 1} 10:${String(i).padStart(2, "0")}:00`,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1000,
  }));
  const getCallCount = mockFetchSequence([
    { status: 429, body: { status: "error", code: 429, message: "rate limit" } }, // primary key: rate-limited
    { status: 200, body: { status: "ok", values } }, // backup key: succeeds
  ]);

  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    const result = await getMarketData({
      symbol: "AAPL",
      market: "us_stocks",
      timeframe: "15m",
      limit: 50,
      apiKeys: { twelvedata: "primary-key", twelvedataBackup: "backup-key" },
      forceProviderId: "twelvedata",
      allowDemoFallback: false,
    });
    assert.equal(result.source, "twelvedata");
    assert.equal(result.chainPosition, 1); // 0 = primary key, 1 = backup key — confirms it fell through to the backup
    assert.ok(result.candles.length > 0);
    assert.ok(getCallCount() >= 2); // confirms it actually tried a second key, not just one call
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to demo data when every Twelve Data key is rate-limited", async () => {
  const originalFetch = globalThis.fetch;
  mockFetchSequence([{ status: 429, body: { status: "error", code: 429, message: "rate limit" } }]);

  try {
    const { getMarketData, invalidateCache } = await import("../js/dataProviders/index.js?t=" + Date.now());
    invalidateCache();
    const result = await getMarketData({
      symbol: "AAPL",
      market: "us_stocks",
      timeframe: "15m",
      limit: 50,
      apiKeys: { twelvedata: "primary-key", twelvedataBackup: "backup-key" },
      forceProviderId: "twelvedata",
      allowDemoFallback: true,
    });
    assert.equal(result.isDemo, true);
    assert.equal(result.fallbackReason, "RATE_LIMIT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
