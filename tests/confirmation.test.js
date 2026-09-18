import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateConfirmations } from "../js/confirmation.js";

function baseCandles(n = 40) {
  const candles = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price + 0.5; // steady uptrend
    candles.push({ t: i * 900000, o, h: c + 0.3, l: o - 0.3, c, v: 1000 });
    price = c;
  }
  return candles;
}

function fakeCtxPassingLong() {
  const candles = baseCandles();
  const last = candles.length - 1;
  return {
    candles,
    structure: { bos: { bos: true, direction: "bullish", level: candles[last - 3].c }, levels: [{ price: candles[last].c - 1, side: "support", touches: 3 }] },
    regimeResult: { trendLabel: "Strong Uptrend", regime: "Strong Uptrend" },
    indicators: {
      rvol20: new Array(candles.length).fill(1.8),
      vwap: new Array(candles.length).fill(candles[last].c - 0.5),
      macd: { histogram: new Array(candles.length).fill(0.5) },
      rsi14: new Array(candles.length).fill(60),
    },
  };
}

test("a well-supported long candidate satisfies at least the minimum 2 confirmations", () => {
  const ctx = fakeCtxPassingLong();
  const candidate = { direction: "long", idealEntry: ctx.candles[ctx.candles.length - 1].c };
  const result = evaluateConfirmations(ctx, candidate, "structure");
  assert.ok(result.count >= 2);
  assert.equal(result.passes, true);
});

test("confirmation categories are de-duplicated (a category never counted twice)", () => {
  const ctx = fakeCtxPassingLong();
  const candidate = { direction: "long", idealEntry: ctx.candles[ctx.candles.length - 1].c };
  const result = evaluateConfirmations(ctx, candidate, "structure");
  const unique = new Set(result.categories);
  assert.equal(unique.size, result.categories.length);
});

test("a candidate with no supporting evidence fails the minimum confirmation requirement", () => {
  const candles = baseCandles();
  const ctx = {
    candles,
    structure: { bos: { bos: false }, levels: [] },
    regimeResult: { trendLabel: "Unclear", regime: "Unclear" },
    indicators: {
      rvol20: new Array(candles.length).fill(0.5), // weak volume
      vwap: new Array(candles.length).fill(candles[candles.length - 1].c + 5), // price below vwap => fails for a long
      macd: { histogram: new Array(candles.length).fill(-0.2) }, // against direction
      rsi14: new Array(candles.length).fill(30),
    },
  };
  const candidate = { direction: "long", idealEntry: candles[candles.length - 1].c };
  const result = evaluateConfirmations(ctx, candidate, null);
  assert.equal(result.passes, false);
});
