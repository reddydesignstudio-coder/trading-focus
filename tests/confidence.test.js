import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConfidence, DEFAULT_WEIGHTS, totalWeight } from "../js/confidence.js";

test("default weights sum to 100", () => {
  assert.equal(totalWeight(DEFAULT_WEIGHTS), 100);
});

function fakeCtx(overrides = {}) {
  return {
    candles: [{ t: 0, o: 1, h: 1, l: 1, c: 1 }],
    indicators: { rvol20: [2.5] },
    relativeStrengthSpread: 0.6,
    ...overrides,
  };
}

test("confidence score never exceeds the max weight total", () => {
  const ctx = fakeCtx();
  const candidate = { direction: "long", idealEntry: 100 };
  const confirmationResult = {
    categories: ["structure", "trend", "momentum", "vwap", "support_resistance", "candlestick", "regime", "relative_strength"],
  };
  const result = computeConfidence(ctx, candidate, confirmationResult);
  assert.ok(result.score <= result.maxScore);
  assert.equal(result.maxScore, 100);
});

test("a setup with zero confirmations scores low but not necessarily zero (volume is continuous)", () => {
  const ctx = fakeCtx({ indicators: { rvol20: [1.0] } }); // at threshold, no bonus
  const candidate = { direction: "long", idealEntry: 100 };
  const confirmationResult = { categories: [] };
  const result = computeConfidence(ctx, candidate, confirmationResult);
  assert.ok(result.score < 30);
});

test("confidence breakdown components sum (approximately) to the total score", () => {
  const ctx = fakeCtx();
  const candidate = { direction: "long", idealEntry: 100 };
  const confirmationResult = { categories: ["structure", "momentum", "vwap"] };
  const result = computeConfidence(ctx, candidate, confirmationResult);
  const summed = Object.values(result.breakdown).reduce((a, b) => a + b.points, 0);
  assert.ok(Math.abs(summed - result.score) < 1);
});

test("confidence label reflects score tier", () => {
  const ctx = fakeCtx();
  const candidate = { direction: "long", idealEntry: 100 };
  const strongConfirm = {
    categories: ["structure", "trend", "momentum", "vwap", "support_resistance", "candlestick", "regime", "relative_strength"],
  };
  const strong = computeConfidence(ctx, candidate, strongConfirm);
  assert.equal(strong.label, "Strong");

  const weakConfirm = { categories: [] };
  const weak = computeConfidence(fakeCtx({ indicators: { rvol20: [1.0] } }), candidate, weakConfirm);
  assert.ok(["Weak", "Very Weak"].includes(weak.label));
});
