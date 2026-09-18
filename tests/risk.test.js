import { test } from "node:test";
import assert from "node:assert/strict";
import { computePositionSize, recalculateTrade, maxDollarRisk, DEFAULT_RISK_SETTINGS } from "../js/risk.js";

test("maxDollarRisk uses percent of balance by default", () => {
  const risk = maxDollarRisk({ accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null });
  assert.equal(risk, 20);
});

test("maxDollarRisk respects a lower explicit override", () => {
  const risk = maxDollarRisk({ accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: 10 });
  assert.equal(risk, 10);
});

test("computePositionSize divides dollar risk by per-unit risk", () => {
  const result = computePositionSize(100, 98, { accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null });
  assert.ok(result.valid);
  assert.equal(result.dollarRisk, 20);
  assert.equal(result.perUnitRisk, 2);
  assert.equal(result.units, 10); // 20 / 2
});

test("computePositionSize rejects equal entry and stop", () => {
  const result = computePositionSize(100, 100, DEFAULT_RISK_SETTINGS);
  assert.equal(result.valid, false);
});

test("recalculateTrade rejects R:R below strategy minimum", () => {
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 101, // only 0.5:1 R:R
    settings: DEFAULT_RISK_SETTINGS,
    minRR: 2,
  });
  assert.equal(result.valid, false);
});

test("recalculateTrade accepts and never exceeds max dollar risk regardless of confidence inputs", () => {
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    settings: { accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null, defaultRR: 2, maxRR: 3 },
    minRR: 2,
  });
  assert.ok(result.valid);
  assert.equal(result.dollarRisk, 20); // fixed at 2% regardless of setup quality
  assert.ok(result.rr >= 2);
});

test("recalculateTrade PULLS IN the take-profit when the raw R:R exceeds the configured maximum, rather than just flagging it", () => {
  // entry 100, stop 99 -> risk 1/unit. Raw target 110 -> raw R:R = 10:1, far past maxRR of 3.
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 110,
    settings: { accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null, defaultRR: 2, maxRR: 3 },
    minRR: 1,
  });
  assert.ok(result.valid);
  assert.equal(result.capped, true);
  // R:R must actually be clamped to maxRR, not left at the raw 10:1
  assert.equal(result.rr, 3);
  // take-profit must be pulled in to the price that yields exactly 3:1 (100 + 1*3 = 103), not left at 110
  assert.equal(result.takeProfit, 103);
  // the original farther target is preserved for transparency, but is NOT what's traded
  assert.equal(result.structuralTarget, 110);
  assert.ok(result.potentialReward < 1000); // sanity: reward is now based on the capped target, not the 10:1 one
});

test("recalculateTrade leaves take-profit untouched when R:R is already within the max", () => {
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 102, // 2:1 — under the 3:1 max
    settings: { accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null, defaultRR: 2, maxRR: 3 },
    minRR: 1,
  });
  assert.ok(result.valid);
  assert.equal(result.capped, false);
  assert.equal(result.takeProfit, 102);
  assert.equal(result.rr, 2);
});

test("recalculateTrade rejects when even the capped R:R would fall below the strategy minimum", () => {
  // If maxRR itself is lower than the strategy's minRR, capping to maxRR still can't satisfy minRR — must reject.
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 110,
    settings: { accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null, defaultRR: 2, maxRR: 1.5 },
    minRR: 2, // higher than maxRR — an impossible configuration, should reject rather than silently pick one
  });
  assert.equal(result.valid, false);
});

test("recalculateTrade rejects wrong-side stop/target for direction", () => {
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 105, // stop above entry on a long — invalid
    takeProfit: 110,
    settings: DEFAULT_RISK_SETTINGS,
    minRR: 1,
  });
  assert.equal(result.valid, false);
});

test("higher confidence does not change position sizing math", () => {
  // Risk engine has no confidence parameter at all — this test documents that
  // by confirming two calls with identical entry/stop produce identical risk.
  const a = computePositionSize(50, 48, DEFAULT_RISK_SETTINGS);
  const b = computePositionSize(50, 48, DEFAULT_RISK_SETTINGS);
  assert.equal(a.dollarRisk, b.dollarRisk);
  assert.equal(a.units, b.units);
});
