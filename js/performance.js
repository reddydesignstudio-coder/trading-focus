// js/performance.js
//
// Performance Engine
// --------------------------------------------------------------
// ONE set of calculations, reused everywhere stats are shown. Takes
// an array of TRADES (already resolved or still open) plus the
// signals generated in the same window, and returns a full metrics
// object. Win % is computed ONLY from completed (WIN/LOSS) trades —
// per spec, N/A (not 0%) when there are zero completed trades.

import { mean, stdev, round } from "./utils.js";

export function computePerformance({ trades = [], signals = [], startingBalance = 1000 }) {
  const completed = trades.filter((t) => t.status === "WIN" || t.status === "LOSS");
  const wins = completed.filter((t) => t.status === "WIN");
  const losses = completed.filter((t) => t.status === "LOSS");
  const open = trades.filter((t) => t.status === "OPEN");
  const ambiguous = trades.filter((t) => t.status === "AMBIGUOUS");

  const netPnL = sumPnl(completed);
  const winPct = completed.length > 0 ? (wins.length / completed.length) * 100 : null;
  const avgWin = wins.length ? mean(wins.map((t) => t.pnl)) : null;
  const avgLoss = losses.length ? mean(losses.map((t) => t.pnl)) : null; // negative number
  const grossProfit = sum(wins.map((t) => t.pnl));
  const grossLossAbs = Math.abs(sum(losses.map((t) => t.pnl)));
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : wins.length > 0 ? Infinity : null;
  const avgR = completed.length ? mean(completed.map((t) => t.rMultiple ?? 0)) : null;
  const expectancy = completed.length ? mean(completed.map((t) => t.pnl ?? 0)) : null;

  const { equityCurve, maxDrawdown, maxDrawdownPct } = buildEquityCurve(completed, startingBalance);
  const endingBalance = startingBalance + netPnL;

  const { longestWinStreak, longestLossStreak, currentStreak } = streaks(orderByTime(completed));

  const avgHoldingTimeMs = computeAvgHoldingTime(completed);

  const qualifyingSignals = signals.filter((s) => s.outcome === "qualifying" || s.outcome === "missed").length + trades.length;
  const missed = signals.filter((s) => s.outcome === "missed").length;

  return {
    startingBalance,
    endingBalance: round(endingBalance, 2),
    totalSignals: signals.length,
    qualifyingSignals,
    tradesTaken: trades.length,
    missedSignals: missed,
    openTrades: open.length,
    ambiguousTrades: ambiguous.length,
    wins: wins.length,
    losses: losses.length,
    winPct: winPct === null ? null : round(winPct, 1),
    netPnL: round(netPnL, 2),
    avgWin: avgWin === null ? null : round(avgWin, 2),
    avgLoss: avgLoss === null ? null : round(avgLoss, 2),
    profitFactor: profitFactor === null ? null : profitFactor === Infinity ? Infinity : round(profitFactor, 2),
    expectancy: expectancy === null ? null : round(expectancy, 2),
    avgR: avgR === null ? null : round(avgR, 2),
    maxDrawdown: round(maxDrawdown, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    equityCurve,
    longestWinStreak,
    longestLossStreak,
    currentStreak,
    avgHoldingTimeMs,
    breakdownByStrategy: groupBreakdown(completed, (t) => t.strategyName || t.strategyId),
    breakdownByMarket: groupBreakdown(completed, (t) => t.market),
    breakdownBySession: groupBreakdown(completed, (t) => t.session || "Unknown"),
    breakdownByRegime: groupBreakdown(completed, (t) => t.regime || "Unknown"),
  };
}

function sum(arr) {
  return arr.reduce((a, b) => a + (b || 0), 0);
}

function sumPnl(trades) {
  return sum(trades.map((t) => t.pnl));
}

function orderByTime(trades) {
  return [...trades].sort((a, b) => new Date(a.resolvedAt || a.createdAt) - new Date(b.resolvedAt || b.createdAt));
}

function buildEquityCurve(completedTrades, startingBalance) {
  const ordered = orderByTime(completedTrades);
  let balance = startingBalance;
  let peak = startingBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const curve = [{ t: null, balance }];
  for (const trade of ordered) {
    balance += trade.pnl || 0;
    peak = Math.max(peak, balance);
    const dd = peak - balance;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    curve.push({ t: trade.resolvedAt || trade.createdAt, balance: round(balance, 2) });
  }
  return { equityCurve: curve, maxDrawdown, maxDrawdownPct };
}

function streaks(orderedCompleted) {
  let longestWin = 0;
  let longestLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  let current = { type: null, count: 0 };
  for (const t of orderedCompleted) {
    if (t.status === "WIN") {
      curWin += 1;
      curLoss = 0;
      current = { type: "WIN", count: curWin };
    } else {
      curLoss += 1;
      curWin = 0;
      current = { type: "LOSS", count: curLoss };
    }
    longestWin = Math.max(longestWin, curWin);
    longestLoss = Math.max(longestLoss, curLoss);
  }
  return { longestWinStreak: longestWin, longestLossStreak: longestLoss, currentStreak: current };
}

function computeAvgHoldingTime(completedTrades) {
  const durations = completedTrades
    .filter((t) => t.createdAt && t.resolvedAt)
    .map((t) => new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime())
    .filter((d) => d >= 0);
  return durations.length ? mean(durations) : null;
}

function groupBreakdown(completedTrades, keyFn) {
  const groups = {};
  for (const t of completedTrades) {
    const key = keyFn(t) || "Unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  return Object.entries(groups).map(([key, trades]) => {
    const wins = trades.filter((t) => t.status === "WIN").length;
    const losses = trades.filter((t) => t.status === "LOSS").length;
    const pnl = sumPnl(trades);
    const avgR = trades.length ? mean(trades.map((t) => t.rMultiple ?? 0)) : null;
    return {
      key,
      trades: trades.length,
      wins,
      losses,
      winPct: trades.length ? round((wins / trades.length) * 100, 1) : null,
      pnl: round(pnl, 2),
      avgR: avgR === null ? null : round(avgR, 2),
    };
  });
}

export function formatHoldingTime(ms) {
  if (ms === null || ms === undefined) return "N/A";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}
