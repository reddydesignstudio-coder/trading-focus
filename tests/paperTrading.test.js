import { test } from "node:test";
import assert from "node:assert/strict";

// paperTrading.js talks to IndexedDB via js/db.js, which needs a real
// `indexedDB` global (browser-only). We only need to verify the guard
// clause fires BEFORE any storage call, so we stub the minimum global
// surface db.js touches and assert the rejection happens synchronously
// for the demo+live combination, and never reaches storage.

test("Live Mode trade execution is refused for demo-sourced signals before any storage write is attempted", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  let dbTouched = false;
  // A minimal stand-in that would throw loudly if paperTrading tried to use it —
  // proving the guard clause returns before any DB interaction.
  globalThis.indexedDB = {
    open() {
      dbTouched = true;
      throw new Error("db should not be touched for a blocked live+demo trade");
    },
  };

  try {
    const { executeTrade } = await import("../js/paperTrading.js");
    const demoSignal = {
      id: "sig_1",
      symbol: "AAPL",
      market: "us_stocks",
      direction: "long",
      isDemo: true,
      entryZone: { low: 100, high: 101 },
      idealEntry: 100.5,
      stopLoss: 99,
      takeProfit: 103,
      confidence: { score: 70 },
      confirmations: { count: 3 },
      strategyId: "trend_pullback_us",
      strategyName: "Trend Pullback",
    };
    await assert.rejects(
      () => executeTrade({ signal: demoSignal, actualEntry: 100.5, sizing: { units: 1, dollarRisk: 20, potentialReward: 40, rr: 2 }, mode: "live" }),
      /Live Mode requires real market data/
    );
    assert.equal(dbTouched, false);
  } finally {
    globalThis.indexedDB = originalIndexedDB;
  }
});
