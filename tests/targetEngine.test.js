import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget } from "../js/targetEngine.js";

test("resolves a level-based target directly when nothing caps it", () => {
  const candidate = { direction: "long", targetHint: { type: "level", price: 120 }, minRR: 2 };
  const result = resolveTarget(candidate, 100, 95, 3, []);
  assert.equal(result.rejected, false);
  assert.equal(result.finalTarget, 120);
  assert.ok(result.rr >= 2);
});

test("caps a target at nearer opposing structure for a long", () => {
  const candidate = { direction: "long", targetHint: { type: "level", price: 130 }, minRR: 1 };
  const levels = [{ price: 110, side: "resistance", touches: 3 }];
  const result = resolveTarget(candidate, 100, 95, 3, levels);
  assert.equal(result.rejected, false);
  assert.equal(result.finalTarget, 110); // capped by nearer resistance, not the raw 130 target
  assert.equal(result.cappedByStructure, true);
});

test("rejects rather than forcing an unrealistic target below minimum R:R", () => {
  const candidate = { direction: "long", targetHint: { type: "level", price: 101 }, minRR: 2 };
  // risk = 5 (100-95), reward would only be 1 => 0.2:1, well below minRR of 2
  const result = resolveTarget(candidate, 100, 95, 3, []);
  assert.equal(result.rejected, true);
  assert.match(result.reason, /R:R/);
});

test("ATR-multiple target hint computes a price when no structural level given", () => {
  const candidate = { direction: "short", targetHint: { type: "atr_multiple", atrMultiple: 3 }, minRR: 1 };
  const result = resolveTarget(candidate, 100, 105, 2, []);
  assert.equal(result.rejected, false);
  assert.equal(result.finalTarget, 94); // 100 - 2*3, reward 6 vs risk 5 => 1.2:1, clears minRR of 1
});

test("zero or invalid stop distance is rejected outright", () => {
  const candidate = { direction: "long", targetHint: { type: "level", price: 110 }, minRR: 1 };
  const result = resolveTarget(candidate, 100, 100, 2, []);
  assert.equal(result.rejected, true);
});
