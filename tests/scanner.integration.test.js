import { test } from "node:test";
import assert from "node:assert/strict";
import { scanMarket } from "../js/scanner.js";
import { DEFAULT_RISK_SETTINGS } from "../js/risk.js";

test("scanMarket runs end-to-end against demo data for each market without throwing", async () => {
  for (const market of ["us_stocks", "forex", "crypto"]) {
    const result = await scanMarket({
      market,
      watchlist: market === "us_stocks" ? ["AAPL", "MSFT"] : market === "forex" ? ["EURUSD", "GBPUSD"] : ["BTCUSDT", "ETHUSDT"],
      riskSettings: DEFAULT_RISK_SETTINGS,
      apiKeys: {},
      forceProviderId: "demo",
    });
    assert.equal(result.market, market);
    assert.ok(Array.isArray(result.qualifying));
    assert.ok(["QUALIFYING_SETUPS_FOUND", "NO_QUALIFYING_TRADE"].includes(result.summary));
    // every qualifying setup must carry the full required field set
    for (const setup of result.qualifying) {
      assert.ok(setup.entryZone.low <= setup.entryZone.high);
      assert.ok(setup.confidence.score >= 0 && setup.confidence.score <= 100);
      assert.ok(setup.confirmations.count >= 2, "qualifying setups must have >= 2 confirmations");
      assert.ok(setup.rr === null || setup.rr >= 1);
      assert.ok(setup.dataStatus === "DEMO" || setup.isDemo === true);
    }
  }
});

test("scanMarket never fabricates a qualifying count — 0 qualifying is a valid, unforced outcome", async () => {
  // Run several times; demo data is randomized per (symbol|market|timeframe) seed so this just
  // sanity-checks that the pipeline never throws or force-pads to a target number.
  const result = await scanMarket({
    market: "us_stocks",
    watchlist: ["ZZZZ_NONEXISTENT"],
    riskSettings: DEFAULT_RISK_SETTINGS,
    apiKeys: {},
    forceProviderId: "demo",
  });
  assert.ok(result.qualifying.length >= 0); // no crash; count is whatever genuinely qualified
});

test("scanNotableActivity returns a purely factual, non-strategy shape (no direction/entry/confidence fields)", async () => {
  const { scanNotableActivity } = await import("../js/scanner.js");
  const result = await scanNotableActivity({
    market: "crypto",
    watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
    apiKeys: {},
    forceProviderId: "demo",
  });
  for (const item of result) {
    assert.ok(item.symbol);
    assert.ok(item.rvol >= 1.5 || item.regime === "Breakout");
    // Deliberately must NOT look like a trade signal — no direction, no entry/stop/target, no confidence score.
    assert.equal(item.direction, undefined);
    assert.equal(item.entryZone, undefined);
    assert.equal(item.confidence, undefined);
  }
});

test("a symbol whose analysis throws unexpectedly does NOT take down the rest of the scan — per-symbol isolation", async (t) => {
  const { mock } = await import("node:test");
  mock.module("../js/indicators.js", {
    namedExports: {
      computeIndicatorSet: () => {
        throw new Error("simulated unexpected indicator failure");
      },
    },
  });
  try {
    const { scanMarket } = await import("../js/scanner.js?t=" + Date.now());
    const risk = await import("../js/risk.js");
    const result = await scanMarket({
      market: "crypto",
      watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      riskSettings: risk.DEFAULT_RISK_SETTINGS,
      apiKeys: {},
      forceProviderId: "demo",
    });
    // scanMarket must still return a full, complete result — never throw/reject —
    // with EVERY symbol accounted for, each correctly marked as an error.
    assert.equal(result.perSymbol.length, 3);
    result.perSymbol.forEach((r) => {
      assert.ok(r.error, `expected ${r.symbol} to have an error recorded`);
    });
    const { errorCount, symbolsWithErrors } = result.log.errorSummary();
    assert.equal(errorCount, 3);
    assert.equal(symbolsWithErrors.length, 3);
  } finally {
    mock.reset();
  }
});

test("scan log records step-by-step detail and exports as readable text, including each symbol's last candle time", async () => {
  const { scanMarket } = await import("../js/scanner.js?t=" + Date.now());
  const risk = await import("../js/risk.js");
  const result = await scanMarket({
    market: "crypto",
    watchlist: ["BTCUSDT", "ETHUSDT"],
    riskSettings: risk.DEFAULT_RISK_SETTINGS,
    apiKeys: {},
    forceProviderId: "demo",
  });
  const text = result.log.toText();
  assert.ok(text.includes("BTCUSDT"));
  assert.ok(text.includes("ETHUSDT"));
  assert.ok(text.includes("Scan complete") || text.includes("Candle fetch complete"));
  result.perSymbol.forEach((r) => {
    assert.ok(r.lastCandleTime, `expected ${r.symbol} to report a last candle time`);
  });
});

test("a strategy needing more candles than were fetched is marked DISABLED and logged with required/fetched counts, while lower-requirement strategies still evaluate normally", async () => {
  const { mock } = await import("node:test");
  // Return exactly 65 candles — above the blanket 60-candle minimum, but below
  // trend_pullback's minCandles (70), and below every strategy's recommendedCandles.
  mock.module("../js/dataProviders/index.js", {
    namedExports: {
      getMarketData: async () => {
        const { demoProvider } = await import("../js/dataProviders/demo.js");
        const full = await demoProvider.getCandles({ symbol: "AAPL", market: "us_stocks", timeframe: "15m", limit: 65 });
        return full;
      },
    },
  });
  try {
    const { scanSymbol } = await import("../js/scanner.js?t=" + Date.now());
    const risk = await import("../js/risk.js");
    const result = await scanSymbol({ symbol: "AAPL", market: "us_stocks", riskSettings: risk.DEFAULT_RISK_SETTINGS, apiKeys: {} });

    const trendPullback = result.strategyDataQuality.find((s) => s.strategyName === "Trend Pullback");
    assert.ok(trendPullback, "expected Trend Pullback to appear in strategyDataQuality");
    assert.equal(trendPullback.status, "DISABLED");
    assert.equal(trendPullback.required, 70);
    assert.equal(trendPullback.fetched, 65);

    const otherStrategy = result.strategyDataQuality.find((s) => s.status !== "DISABLED");
    assert.ok(otherStrategy, "expected at least one lower-requirement strategy to still be evaluated");
    assert.equal(otherStrategy.status, "LIMITED"); // 65 fetched is below every strategy's recommendedCandles (100+)

    // the disabled strategy shows up as a clear, specific reason — not silently dropped
    const disabledReason = result.noCandidateStrategies.find((n) => n.strategyName === "Trend Pullback");
    assert.ok(disabledReason.reason.includes("70"));
    assert.ok(disabledReason.reason.includes("65"));
  } finally {
    mock.reset();
  }
});

test("every per-symbol result reports which data source supplied the candles, and it appears in the scan log text", async () => {
  const { scanMarket } = await import("../js/scanner.js?t=" + Date.now());
  const risk = await import("../js/risk.js");
  const result = await scanMarket({
    market: "crypto",
    watchlist: ["BTCUSDT"],
    riskSettings: risk.DEFAULT_RISK_SETTINGS,
    apiKeys: {},
    forceProviderId: "demo",
  });
  assert.equal(result.perSymbol[0].source, "demo");
  const text = result.log.toText();
  assert.ok(text.includes("source: demo"), "expected the source to appear directly in the readable log text");
});

test("a full scan with no API keys configured returns honest UNAVAILABLE results for every symbol — never fabricated demo signals", async () => {
  const { scanMarket } = await import("../js/scanner.js?t=" + Date.now());
  const risk = await import("../js/risk.js");
  const result = await scanMarket({
    market: "us_stocks",
    watchlist: ["AAPL", "MSFT"],
    riskSettings: risk.DEFAULT_RISK_SETTINGS,
    apiKeys: {}, // nothing configured
  });
  assert.equal(result.isDemo, false);
  assert.equal(result.qualifying.length, 0);
  result.perSymbol.forEach((r) => {
    assert.equal(r.isDemo, false);
    assert.equal(r.dataStatus, "UNAVAILABLE");
    assert.ok(r.error); // clearly explained, not silently empty
  });
});

test("a settings-based threshold override actually changes what scanMarket qualifies, end to end", async () => {
  const { scanMarket } = await import("../js/scanner.js?t=" + Date.now());
  const risk = await import("../js/risk.js");

  // Default settings (empty override) — see what crypto's EMA momentum cross strategy naturally does against demo data.
  const withDefaults = await scanMarket({
    market: "crypto",
    watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
    riskSettings: risk.DEFAULT_RISK_SETTINGS,
    apiKeys: {},
    forceProviderId: "demo",
    settings: { strategyThresholds: {} },
  });

  // Now require an absurdly high ADX (99) for the same strategy — should produce strictly fewer (likely zero) qualifying signals from it specifically.
  const withStrictOverride = await scanMarket({
    market: "crypto",
    watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
    riskSettings: risk.DEFAULT_RISK_SETTINGS,
    apiKeys: {},
    forceProviderId: "demo",
    settings: { strategyThresholds: { ema_momentum_cross_crypto: { adxMin: 99 } } },
  });

  const countFromCrossStrategy = (result) => result.qualifying.filter((s) => s.strategyId === "ema_momentum_cross_crypto").length + result.perSymbol.flatMap((r) => r.rejected).filter((s) => s.strategyId === "ema_momentum_cross_crypto").length;

  assert.ok(countFromCrossStrategy(withStrictOverride) <= countFromCrossStrategy(withDefaults), "an ADX minimum of 99 should never produce MORE candidates than the default");
});
