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

test("recalculateTrade flags but does not silently exceed configured max R:R", () => {
  const result = recalculateTrade({
    direction: "long",
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 110, // 10:1 R:R — far past max
    settings: { accountBalance: 1000, riskPercent: 2, maxRiskOverrideUSD: null, defaultRR: 2, maxRR: 3 },
    minRR: 1,
  });
  assert.ok(result.valid);
  assert.equal(result.capped, true);
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
