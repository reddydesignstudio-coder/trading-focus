import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffectiveThresholds, hasTunableThresholds } from "../js/strategyThresholds.js";

test("with no user override, returns the strategy's own defaults exactly", () => {
  const strategy = { id: "orb_volume", defaultThresholds: { rvolMin: 1.5, orBars: 6 } };
  const settings = { strategyThresholds: {} };
  assert.deepEqual(getEffectiveThresholds(strategy, settings), { rvolMin: 1.5, orBars: 6 });
});

test("a partial override replaces only the overridden field, keeping the rest at default", () => {
  const strategy = { id: "orb_volume", defaultThresholds: { rvolMin: 1.5, orBars: 6 } };
  const settings = { strategyThresholds: { orb_volume: { rvolMin: 2.0 } } };
  assert.deepEqual(getEffectiveThresholds(strategy, settings), { rvolMin: 2.0, orBars: 6 });
});

test("an override for a different strategy id never leaks into this one", () => {
  const strategy = { id: "orb_volume", defaultThresholds: { rvolMin: 1.5 } };
  const settings = { strategyThresholds: { some_other_strategy: { rvolMin: 99 } } };
  assert.deepEqual(getEffectiveThresholds(strategy, settings), { rvolMin: 1.5 });
});

test("handles missing settings, missing strategyThresholds, and a strategy with no defaults, all without throwing", () => {
  assert.deepEqual(getEffectiveThresholds({ id: "x" }, {}), {});
  assert.deepEqual(getEffectiveThresholds({ id: "x", defaultThresholds: { a: 1 } }, {}), { a: 1 });
  assert.deepEqual(getEffectiveThresholds({ id: "x" }, undefined), {});
  assert.deepEqual(getEffectiveThresholds({ id: "x" }, null), {});
});

test("never mutates the strategy's own defaultThresholds object", () => {
  const strategy = { id: "orb_volume", defaultThresholds: { rvolMin: 1.5 } };
  const settings = { strategyThresholds: { orb_volume: { rvolMin: 3.0 } } };
  getEffectiveThresholds(strategy, settings);
  assert.equal(strategy.defaultThresholds.rvolMin, 1.5); // untouched — a fresh scan next time still sees the real default
});

test("hasTunableThresholds correctly distinguishes strategies with and without configurable parameters", () => {
  assert.equal(hasTunableThresholds({ id: "a", defaultThresholds: { x: 1 } }), true);
  assert.equal(hasTunableThresholds({ id: "b", defaultThresholds: {} }), false);
  assert.equal(hasTunableThresholds({ id: "c" }), false);
});
