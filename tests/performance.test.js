import { test } from "node:test";
import assert from "node:assert/strict";
import { computePerformance, buildAccountLedger } from "../js/performance.js";

function trade(overrides) {
  return {
    status: "OPEN",
    pnl: null,
    rMultiple: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    resolvedAt: null,
    strategyName: "Test Strategy",
    market: "us_stocks",
    session: "US Regular Session",
    regime: "Strong Uptrend",
    ...overrides,
  };
}

test("win % is N/A (not 0%) when there are zero completed trades", () => {
  const perf = computePerformance({ trades: [trade({ status: "OPEN" })], startingBalance: 1000 });
  assert.equal(perf.winPct, null);
});

test("win % counts only completed trades, not open or ambiguous ones", () => {
  const trades = [
    trade({ status: "WIN", pnl: 40, rMultiple: 2, resolvedAt: "2026-01-01T11:00:00.000Z" }),
    trade({ status: "OPEN" }),
    trade({ status: "AMBIGUOUS" }),
  ];
  const perf = computePerformance({ trades, startingBalance: 1000 });
  assert.equal(perf.winPct, 100);
  assert.equal(perf.tradesTaken, 3);
});

test("net P&L and ending balance reflect only completed trades", () => {
  const trades = [
    trade({ status: "WIN", pnl: 40, rMultiple: 2, resolvedAt: "2026-01-01T11:00:00.000Z" }),
    trade({ status: "LOSS", pnl: -20, rMultiple: -1, resolvedAt: "2026-01-01T12:00:00.000Z" }),
  ];
  const perf = computePerformance({ trades, startingBalance: 1000 });
  assert.equal(perf.netPnL, 20);
  assert.equal(perf.endingBalance, 1020);
  assert.equal(perf.winPct, 50);
});

test("profit factor is gross profit divided by gross loss", () => {
  const trades = [
    trade({ status: "WIN", pnl: 60, resolvedAt: "2026-01-01T11:00:00.000Z" }),
    trade({ status: "WIN", pnl: 40, resolvedAt: "2026-01-01T12:00:00.000Z" }),
    trade({ status: "LOSS", pnl: -25, resolvedAt: "2026-01-01T13:00:00.000Z" }),
  ];
  const perf = computePerformance({ trades, startingBalance: 1000 });
  assert.equal(perf.profitFactor, 4); // 100 / 25
});

test("expectancy is average P&L across completed trades", () => {
  const trades = [
    trade({ status: "WIN", pnl: 30, resolvedAt: "2026-01-01T11:00:00.000Z" }),
    trade({ status: "LOSS", pnl: -10, resolvedAt: "2026-01-01T12:00:00.000Z" }),
  ];
  const perf = computePerformance({ trades, startingBalance: 1000 });
  assert.equal(perf.expectancy, 10); // (30 + -10) / 2
});

test("max drawdown reflects the largest peak-to-trough decline in the equity curve", () => {
  const trades = [
    trade({ status: "WIN", pnl: 100, resolvedAt: "2026-01-01T10:00:00.000Z" }), // 1000 -> 1100 (peak)
    trade({ status: "LOSS", pnl: -60, resolvedAt: "2026-01-01T11:00:00.000Z" }), // 1100 -> 1040 (dd=60)
    trade({ status: "LOSS", pnl: -40, resolvedAt: "2026-01-01T12:00:00.000Z" }), // 1040 -> 1000 (dd=100 from peak)
    trade({ status: "WIN", pnl: 20, resolvedAt: "2026-01-01T13:00:00.000Z" }), // 1000 -> 1020
  ];
  const perf = computePerformance({ trades, startingBalance: 1000 });
  assert.equal(perf.maxDrawdown, 100);
});

test("missed signals never count as wins or losses", () => {
  const signals = [{ outcome: "missed" }, { outcome: "missed" }];
  const perf = computePerformance({ trades: [], signals, startingBalance: 1000 });
  assert.equal(perf.wins, 0);
  assert.equal(perf.losses, 0);
  assert.equal(perf.winPct, null);
  assert.equal(perf.missedSignals, 2);
});

test("breakdown by strategy groups completed trades only", () => {
  const trades = [
    trade({ status: "WIN", pnl: 10, strategyName: "A", resolvedAt: "2026-01-01T10:00:00.000Z" }),
    trade({ status: "LOSS", pnl: -10, strategyName: "A", resolvedAt: "2026-01-01T11:00:00.000Z" }),
    trade({ status: "OPEN", strategyName: "B" }),
  ];
  const perf = computePerformance({ trades, startingBalance: 1000 });
  const a = perf.breakdownByStrategy.find((r) => r.key === "A");
  assert.equal(a.trades, 2);
  assert.equal(a.winPct, 50);
  const bExists = perf.breakdownByStrategy.some((r) => r.key === "B");
  assert.equal(bExists, false); // open trade doesn't appear in completed-only breakdown
});

test("buildAccountLedger produces a correct running balance, win then loss", () => {
  const trades = [
    trade({ status: "WIN", pnl: 60, resolvedAt: "2026-01-01T10:00:00.000Z" }),
    trade({ status: "LOSS", pnl: -20, resolvedAt: "2026-01-01T11:00:00.000Z" }),
  ];
  const { openingBalance, entries, endingBalance } = buildAccountLedger(trades, 1000);
  assert.equal(openingBalance, 1000);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].runningBalance, 1060); // 1000 + 60
  assert.equal(entries[1].runningBalance, 1040); // 1060 - 20
  assert.equal(endingBalance, 1040);
});

test("buildAccountLedger with no trades returns the opening balance unchanged", () => {
  const { entries, endingBalance } = buildAccountLedger([], 1000);
  assert.equal(entries.length, 0);
  assert.equal(endingBalance, 1000);
});

test("buildAccountLedger treats a null/undefined pnl (e.g. AMBIGUOUS) as zero change to balance", () => {
  const trades = [trade({ status: "AMBIGUOUS", pnl: null, resolvedAt: "2026-01-01T10:00:00.000Z" })];
  const { entries, endingBalance } = buildAccountLedger(trades, 1000);
  assert.equal(entries[0].runningBalance, 1000);
  assert.equal(endingBalance, 1000);
});

test("buildAccountLedger does not mutate or re-sort the input array — order is entirely the caller's responsibility", () => {
  const trades = [
    trade({ status: "LOSS", pnl: -10, resolvedAt: "2026-01-01T12:00:00.000Z" }),
    trade({ status: "WIN", pnl: 30, resolvedAt: "2026-01-01T09:00:00.000Z" }), // deliberately out of chronological order
  ];
  const { entries } = buildAccountLedger(trades, 1000);
  // Ledger just follows input order — first entry is the LOSS since it was first in the array.
  assert.equal(entries[0].runningBalance, 990);
  assert.equal(entries[1].runningBalance, 1020);
});
