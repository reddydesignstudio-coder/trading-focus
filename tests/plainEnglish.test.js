import { test } from "node:test";
import assert from "node:assert/strict";
import { explainPlainEnglish } from "../js/plainEnglish.js";
import { ALL_STRATEGIES } from "../js/strategies/index.js";

test("every registered strategy has a dedicated plain-English template (not the generic fallback)", () => {
  for (const strategy of ALL_STRATEGIES) {
    for (const direction of ["long", "short"]) {
      const text = explainPlainEnglish({ symbol: "TEST", direction, strategyId: strategy.id });
      assert.ok(text && text.length > 20, `${strategy.id} (${direction}) produced no real explanation`);
      assert.ok(!text.includes("historically favored"), `${strategy.id} (${direction}) fell through to the generic fallback — needs its own template`);
    }
  }
});

test("plain-English text avoids raw indicator jargon", () => {
  const jargon = ["EMA", "RSI", "ADX", "RVOL", "VWAP", "ATR"];
  for (const strategy of ALL_STRATEGIES) {
    const text = explainPlainEnglish({ symbol: "TEST", direction: "long", strategyId: strategy.id });
    for (const term of jargon) {
      assert.ok(!text.includes(term), `${strategy.id} plain-English text still contains raw jargon term "${term}": "${text}"`);
    }
  }
});

test("long and short versions of the same strategy read differently (direction-aware, not just a find-replace)", () => {
  const long = explainPlainEnglish({ symbol: "AAPL", direction: "long", strategyId: "trend_pullback_us" });
  const short = explainPlainEnglish({ symbol: "AAPL", direction: "short", strategyId: "trend_pullback_us" });
  assert.notEqual(long, short);
  assert.match(long, /climbing/);
  assert.match(short, /falling/);
});

test("unknown strategy id falls back to the generic explanation rather than throwing", () => {
  const text = explainPlainEnglish({ symbol: "XYZ", direction: "long", strategyId: "not_a_real_strategy" });
  assert.ok(text.includes("historically favored"));
});
