// js/strategyLab.js
import { getAll } from "./db.js";
import { computePerformance } from "./performance.js";
import { ALL_STRATEGIES } from "./strategies/index.js";

export async function getStrategyLab({ startingBalance = 1000, mode = "all" } = {}) {
  const allTrades = await getAll("trades");
  const trades = mode === "all" ? allTrades : allTrades.filter((t) => t.mode === mode);

  const rows = ALL_STRATEGIES.map((strategy) => {
    const strategyTrades = trades.filter((t) => t.strategyId === strategy.id);
    const perf = computePerformance({ trades: strategyTrades, startingBalance });
    return {
      strategyId: strategy.id,
      name: strategy.name,
      market: strategy.market,
      description: strategy.description,
      minRR: strategy.minRR,
      trades: strategyTrades.length,
      winPct: perf.winPct,
      avgWin: perf.avgWin,
      avgLoss: perf.avgLoss,
      profitFactor: perf.profitFactor,
      expectancy: perf.expectancy,
      avgR: perf.avgR,
      maxDrawdown: perf.maxDrawdown,
      byMarketBreakdown: perf.breakdownByMarket,
      byRegimeBreakdown: perf.breakdownByRegime,
      bySessionBreakdown: perf.breakdownBySession,
    };
  });

  // Sorted by sample size only (most-data-first), NEVER by a "best" score — the
  // spec explicitly forbids labeling any strategy "best".
  rows.sort((a, b) => b.trades - a.trades);
  return rows;
}
