import { test } from "node:test";
import assert from "node:assert/strict";
import { openingRangeBreakout } from "../js/strategies/usStocks.js";
import { trendPullbackFx } from "../js/strategies/forex.js";
import { emaMomentumCross } from "../js/strategies/crypto.js";

function makeCtxWithIndicators(overrides) {
  const candles = Array.from({ length: 60 }, (_, i) => ({ t: i * 900000, o: 100, h: 101, l: 99, c: 100, v: 1000 }));
  return {
    candles,
    indicators: { rvol20: new Array(60).fill(1.7), ema9: new Array(60).fill(100), ema20: new Array(60).fill(100), ema50: new Array(60).fill(98), atr14: new Array(60).fill(1), adx14: { adx: new Array(60).fill(25) }, rsi14: new Array(60).fill(50) },
    structure: { swings: [], levels: {} },
    regimeResult: { regime: "Strong Uptrend", trendLabel: "Strong Uptrend" },
    ...overrides,
  };
}

test("openingRangeBreakout: a candle that qualifies at the default RVOL threshold no longer qualifies once the threshold is raised above the measured value", () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({ t: i * 300000, o: 100, h: 100.5, l: 99.5, c: 100, v: 1000 }));
  candles[candles.length - 1] = { t: 9 * 300000, o: 100, h: 102, l: 100, c: 101.8, v: 5000 }; // breaks the opening range high
  const indicators = { rvol20: new Array(10).fill(1.7) }; // measured RVOL = 1.7
  const ctx = { candles, indicators, structure: { swings: [] } };

  const withDefault = openingRangeBreakout.evaluate(ctx); // default threshold 1.5 — 1.7 qualifies
  assert.ok(withDefault, "expected a candidate at the default 1.5 threshold with a measured RVOL of 1.7");

  const withRaised = openingRangeBreakout.evaluate(ctx, { rvolMin: 2.0 }); // raise the bar above the measured 1.7
  assert.equal(withRaised, null, "expected no candidate once the threshold is raised above the measured RVOL");
});

test("openingRangeBreakout: captures the measured RVOL value on the returned candidate for future threshold-tuning analysis", () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({ t: i * 300000, o: 100, h: 100.5, l: 99.5, c: 100, v: 1000 }));
  candles[candles.length - 1] = { t: 9 * 300000, o: 100, h: 102, l: 100, c: 101.8, v: 5000 };
  const ctx = { candles, indicators: { rvol20: new Array(10).fill(2.35) }, structure: { swings: [] } };
  const candidate = openingRangeBreakout.evaluate(ctx);
  assert.equal(candidate.measuredValues.rvol, 2.35);
});

test("trendPullbackFx: a signal that qualifies at the default RSI band no longer qualifies once the band is narrowed past the measured RSI", () => {
  const ctx = makeCtxWithIndicators({});
  ctx.indicators.rsi14[ctx.candles.length - 1] = 62; // measured RSI = 62, within default long band (40,65)

  const withDefault = trendPullbackFx.evaluate(ctx);
  assert.ok(withDefault, "expected a candidate — 62 is within the default (40,65) band");

  const withNarrowed = trendPullbackFx.evaluate(ctx, { emaProximity: 0.0015, rsiLongMin: 40, rsiLongMax: 60, rsiShortMin: 35, rsiShortMax: 60 }); // band narrowed to exclude 62
  assert.equal(withNarrowed, null, "expected no candidate once the RSI band no longer covers the measured value");
});

test("emaMomentumCross: a cross that qualifies at the default ADX threshold no longer qualifies once ADX is required to be higher than the measured value", () => {
  const ctx = makeCtxWithIndicators({});
  const i = ctx.candles.length - 1;
  ctx.indicators.ema9[i - 1] = 99;
  ctx.indicators.ema20[i - 1] = 100; // was below
  ctx.indicators.ema9[i] = 101;
  ctx.indicators.ema20[i] = 100; // crossed above
  ctx.indicators.adx14.adx[i] = 24; // measured ADX = 24

  const withDefault = emaMomentumCross.evaluate(ctx); // default adxMin 20 — 24 qualifies
  assert.ok(withDefault, "expected a candidate — measured ADX 24 clears the default minimum of 20");

  const withRaised = emaMomentumCross.evaluate(ctx, { adxMin: 30 }); // raise above the measured 24
  assert.equal(withRaised, null, "expected no candidate once the ADX minimum is raised above the measured value");
});

test("evaluate() called with no thresholds argument at all still works exactly as before (backward compatible)", () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({ t: i * 300000, o: 100, h: 100.5, l: 99.5, c: 100, v: 1000 }));
  candles[candles.length - 1] = { t: 9 * 300000, o: 100, h: 102, l: 100, c: 101.8, v: 5000 };
  const ctx = { candles, indicators: { rvol20: new Array(10).fill(1.7) }, structure: { swings: [] } };
  // No second argument — must fall back to the strategy's own defaultThresholds via the default parameter.
  assert.ok(openingRangeBreakout.evaluate(ctx));
});
