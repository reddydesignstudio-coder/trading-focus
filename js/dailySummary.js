// js/dailySummary.js
import { getAllByIndex } from "./db.js";
import { computePerformance } from "./performance.js";
import { todayKey } from "./utils.js";
import { DEFAULT_TIMEZONE } from "./timezone.js";

export async function getDailySummary({ dateKey, timeZone = DEFAULT_TIMEZONE, startingBalance = 1000, mode = "live" } = {}) {
  const key = dateKey || todayKey(new Date(), timeZone);
  const [trades, signals] = await Promise.all([getAllByIndex("trades", "byDate", key), getAllByIndex("signals", "byDate", key)]);

  const modeTrades = mode === "all" ? trades : trades.filter((t) => t.mode === mode);
  const perf = computePerformance({ trades: modeTrades, signals, startingBalance });

  const signalsGenerated = signals.length;
  const qualifyingSignals = signals.filter((s) => s.outcome === "qualifying" || s.outcome === "missed").length + modeTrades.length;
  const tradesTaken = modeTrades.length;
  const missedSignals = signals.filter((s) => s.outcome === "missed").length;

  return {
    dateKey: key,
    mode,
    headline: buildHeadline(perf),
    funnel: {
      signalsGenerated,
      qualifyingSignals,
      tradesTaken,
      wins: perf.wins,
      losses: perf.losses,
      missedSignals,
    },
    startingBalance,
    endingBalance: perf.endingBalance,
    metrics: perf,
    trades: modeTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}

function buildHeadline(perf) {
  if (perf.tradesTaken === 0) return "No trades taken today.";
  const winPctStr = perf.winPct === null ? "N/A" : `${perf.winPct}%`;
  const pnlStr = perf.netPnL >= 0 ? `+$${perf.netPnL.toFixed(2)}` : `-$${Math.abs(perf.netPnL).toFixed(2)}`;
  return `${perf.tradesTaken} TRADE${perf.tradesTaken === 1 ? "" : "S"} · ${perf.wins} WIN · ${perf.losses} LOSS · ${winPctStr} WIN RATE · ${pnlStr}`;
}
