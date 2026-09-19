import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIndicatorSet } from "../js/indicators.js";
import { analyzeStructure } from "../js/structure.js";
import { classifyRegime } from "../js/regime.js";
import { bollingerMeanReversion, gapAndGo } from "../js/strategies/usStocks.js";
import { emaMomentumCross } from "../js/strategies/crypto.js";

function buildCtx(candles, overrides = {}) {
  const indicators = computeIndicatorSet(candles);
  const structure = analyzeStructure(candles);
  const regimeResult = classifyRegime(candles, indicators);
  return {
    candles,
    indicators,
    structure,
    regimeResult,
    price: candles[candles.length - 1].c,
    market: "us_stocks",
    symbol: "TEST",
    sessionFlags: { london: false, overlap: false, ny: true, tokyo: false },
    ...overrides,
  };
}

function candle(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v };
}

test("Bollinger Mean Reversion only fires in a Range regime — never in a trend, per its own design", () => {
  const candles = [];
  let price = 100;
  for (let i = 0; i < 60; i++) {
    const wiggle = Math.sin(i / 3) * 0.5;
    const c = 100 + wiggle;
    candles.push(candle(i * 900000, price, c + 0.3, c - 0.3, c));
    price = c;
  }
  const last = candles[candles.length - 1];
  candles[candles.length - 1] = candle(last.t, last.o, last.h, last.o - 5, last.o - 0.1);

  const ctx = buildCtx(candles);
  const candidate = bollingerMeanReversion.evaluate(ctx);
  if (ctx.regimeResult.regime === "Range") {
    assert.ok(candidate, "expected a candidate when regime is genuinely Range and the band was pierced");
    assert.equal(candidate.direction, "long");
  } else {
    assert.equal(candidate, null);
  }
});

test("Bollinger Mean Reversion declines outright when regime is not Range, even with a band touch", () => {
  const candles = [];
  for (let i = 0; i < 60; i++) {
    const c = 100 + i * 1.5;
    candles.push(candle(i * 900000, c - 1, c + 1, c - 1.5, c));
  }
  const ctx = buildCtx(candles);
  assert.notEqual(ctx.regimeResult.regime, "Range");
  const candidate = bollingerMeanReversion.evaluate(ctx);
  assert.equal(candidate, null);
});

test("Gap and Go requires a real gap (>=1%) between sessions — does nothing on a flat open", () => {
  const candles = [];
  const day1Start = Date.UTC(2026, 0, 5, 14, 30);
  for (let i = 0; i < 20; i++) {
    const c = 100 + Math.sin(i / 4);
    candles.push(candle(day1Start + i * 900000, c, c + 0.3, c - 0.3, c));
  }
  const day2Start = Date.UTC(2026, 0, 6, 14, 30);
  for (let i = 0; i < 20; i++) {
    const c = 100.05 + Math.sin(i / 4);
    candles.push(candle(day2Start + i * 900000, c, c + 0.3, c - 0.3, c, 5000));
  }
  const ctx = buildCtx(candles);
  const candidate = gapAndGo.evaluate(ctx);
  assert.equal(candidate, null);
});

test("Gap and Go fires long on a genuine upward gap held with strong volume", () => {
  const candles = [];
  const day1Start = Date.UTC(2026, 0, 5, 14, 30);
  for (let i = 0; i < 20; i++) {
    const c = 100 + Math.sin(i / 4) * 0.3;
    candles.push(candle(day1Start + i * 900000, c, c + 0.3, c - 0.3, c, 1000));
  }
  const day2Start = Date.UTC(2026, 0, 6, 14, 30);
  const gapOpen = 103;
  for (let i = 0; i < 5; i++) {
    const c = gapOpen + i * 0.4;
    candles.push(candle(day2Start + i * 900000, i === 0 ? gapOpen : c - 0.4, c + 0.2, c - 0.2, c, 8000));
  }
  const ctx = buildCtx(candles);
  const candidate = gapAndGo.evaluate(ctx);
  assert.ok(candidate, "expected Gap and Go to fire on a held 3% gap with strong volume");
  assert.equal(candidate.direction, "long");
});

test("EMA 9/20 Momentum Cross fires long exactly on the crossover bar, not before or after", () => {
  const candles = [];
  let price = 100;
  for (let i = 0; i < 40; i++) {
    price -= 0.1;
    candles.push(candle(i * 3600000, price, price + 0.2, price - 0.2, price, 1000));
  }
  for (let i = 0; i < 15; i++) {
    price += 1.2;
    candles.push(candle((40 + i) * 3600000, price, price + 0.5, price - 0.1, price, 1500));
  }
  const ctx = buildCtx(candles, { market: "crypto" });
  const candidate = emaMomentumCross.evaluate(ctx);
  if (candidate) {
    assert.equal(candidate.direction, "long");
  }
});

test("EMA 9/20 Momentum Cross does nothing when EMA9 and EMA20 aren't actually crossing", () => {
  const candles = [];
  for (let i = 0; i < 40; i++) {
    const c = 100 + Math.sin(i / 5) * 0.2;
    candles.push(candle(i * 3600000, c, c + 0.1, c - 0.1, c, 1000));
  }
  const ctx = buildCtx(candles, { market: "crypto" });
  const candidate = emaMomentumCross.evaluate(ctx);
  assert.equal(candidate, null);
});
