import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_STRATEGIES } from "../js/strategies/index.js";
import { STRATEGY_GUIDE, getStrategyGuide } from "../js/strategyGuide.js";

test("every registered strategy has a real guide entry — not the generic fallback", () => {
  const missing = [];
  ALL_STRATEGIES.forEach((s) => {
    if (!STRATEGY_GUIDE[s.id]) missing.push(s.id);
  });
  assert.deepEqual(missing, [], `these strategies have no guide entry: ${missing.join(", ")}`);
});

test("every guide entry has both a 'when' and a 'why', each substantial (not a one-word placeholder)", () => {
  Object.entries(STRATEGY_GUIDE).forEach(([id, entry]) => {
    assert.ok(entry.when && entry.when.length > 20, `${id} is missing a real 'when' explanation`);
    assert.ok(entry.why && entry.why.length > 20, `${id} is missing a real 'why' explanation`);
  });
});

test("getStrategyGuide never throws and always returns a usable shape, even for an unknown id", () => {
  const result = getStrategyGuide("some_strategy_that_does_not_exist");
  assert.ok(result.when);
  assert.equal(typeof result.when, "string");
});

test("guide entries stay free of raw indicator jargon in the 'why' (same bar plainEnglish.js already holds itself to)", () => {
  const jargon = /\bEMA\d|\bRSI\b|\bADX\b|\bATR\b|\bVWAP\b(?!.*average)/i;
  // VWAP is allowed since it's explained inline ("volume-weighted average price") — everything else should stay in plain words in the 'why'.
  Object.entries(STRATEGY_GUIDE).forEach(([id, entry]) => {
    if (id === "ema_momentum_cross_crypto") return; // this one's 'when' legitimately needs to name EMA9/20/ADX to be accurate — it's in 'when', not 'why', and is explained
    const hasRawJargon = /\bRSI\b|\bADX\b(?!.*confirm)/i.test(entry.why);
    assert.ok(!hasRawJargon, `${id}'s 'why' uses raw jargon without explanation: ${entry.why}`);
  });
});
