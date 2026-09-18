// js/paperTrading.js
//
// Paper Trading Engine
// --------------------------------------------------------------
// Enforces the hard separation between SIGNAL and TRADE:
//   - A qualifying setup from the scanner is a SIGNAL. It never
//     touches account performance on its own.
//   - Pressing "Paper Trade" converts a signal into a TRADE, which
//     IS tracked against account balance/performance.
//   - A signal the user does not act on can be explicitly marked
//     "missed" for the funnel — missed signals never count as
//     wins/losses.
//
// Live Mode: exactly one COMPLETED trade per calendar day (local
// timezone). After that trade resolves WIN or LOSS, Live Mode locks
// for the rest of the day. An OPEN trade does not lock or unlock
// anything until it resolves.
//
// Test Mode: user-selected cap of 1/2/5/10 trades per day, tracked
// in a completely separate `mode: "test"` partition so statistics
// never mix with Live Mode.

import { put, get, getAllByIndex } from "./db.js";
import { uid, todayKey } from "./utils.js";
import { DEFAULT_TIMEZONE } from "./timezone.js";

export const LIVE_MODE_DAILY_LIMIT = 1;
export const TEST_MODE_OPTIONS = [1, 2, 5, 10];

export async function getTradesForDay(dateKey, mode) {
  const all = await getAllByIndex("trades", "byDate", dateKey);
  return mode ? all.filter((t) => t.mode === mode) : all;
}

export async function getLiveModeStatus(timeZone = DEFAULT_TIMEZONE) {
  const dateKey = todayKey(new Date(), timeZone);
  const trades = await getTradesForDay(dateKey, "live");
  const completed = trades.filter((t) => t.status === "WIN" || t.status === "LOSS");
  const open = trades.filter((t) => t.status === "OPEN");

  if (completed.length >= LIVE_MODE_DAILY_LIMIT) {
    return { available: false, reason: "COMPLETED_FOR_TODAY", completedTrade: completed[0], dateKey };
  }
  if (open.length >= LIVE_MODE_DAILY_LIMIT) {
    return { available: false, reason: "TRADE_OPEN", openTrade: open[0], dateKey };
  }
  return { available: true, dateKey };
}

export async function getTestModeStatus(dailyLimit, timeZone = DEFAULT_TIMEZONE) {
  const dateKey = todayKey(new Date(), timeZone);
  const trades = await getTradesForDay(dateKey, "test");
  const takenToday = trades.length;
  return { available: takenToday < dailyLimit, takenToday, dailyLimit, dateKey };
}

/**
 * Converts a qualifying signal into an executed paper trade.
 * `actualEntry` may differ from `signal.idealEntry` (user selected a price
 * inside the entry zone) — the caller must have already re-validated
 * sizing/R:R via risk.recalculateTrade before calling this.
 */
export async function executeTrade({ signal, actualEntry, sizing, mode, timeZone = DEFAULT_TIMEZONE }) {
  if (mode === "live") {
    if (signal.isDemo) {
      throw new Error(
        "Live Mode requires real market data. This signal was generated from simulated Demo data (no data-provider API key configured), so it can't be executed as a Live Mode trade. Add a free Twelve Data API key in Settings, or use Test Mode to practice with demo data."
      );
    }
    const status = await getLiveModeStatus(timeZone);
    if (!status.available) {
      throw new Error(status.reason === "COMPLETED_FOR_TODAY" ? "Live Mode already completed for today." : "A Live Mode trade is already open today.");
    }
  }

  const dateKey = todayKey(new Date(), timeZone);
  const trade = {
    id: uid("trade"),
    signalId: signal.id,
    mode, // "live" | "test"
    dateKey,
    createdAt: new Date().toISOString(),
    symbol: signal.symbol,
    market: signal.market,
    direction: signal.direction,
    strategyId: signal.strategyId,
    strategyName: signal.strategyName,
    entryZone: signal.entryZone,
    idealEntry: signal.idealEntry,
    entryPrice: actualEntry,
    stopLoss: signal.stopLoss,
    takeProfit: sizing.takeProfit ?? signal.takeProfit,
    rr: sizing.rr,
    positionSize: sizing.units,
    dollarRisk: sizing.dollarRisk,
    potentialReward: sizing.potentialReward,
    confidence: signal.confidence,
    confirmations: signal.confirmations,
    regime: signal.regime,
    session: signal.session,
    status: "OPEN",
    pnl: null,
    rMultiple: null,
    resolvedAt: null,
    notes: "",
  };
  await put("trades", trade);
  return trade;
}

export async function resolveTradeRecord(tradeId, resolution, outcome) {
  const trade = await get("trades", tradeId);
  if (!trade) throw new Error("Trade not found.");
  trade.status = resolution.status;
  trade.pnl = outcome.pnl;
  trade.rMultiple = outcome.rMultiple;
  trade.resolvedAt = resolution.resolvedAt ? new Date(resolution.resolvedAt).toISOString() : new Date().toISOString();
  await put("trades", trade);
  return trade;
}

/** Marks a qualifying signal the user chose not to act on — tracked separately from trades. */
export async function markSignalMissed(signal, timeZone = DEFAULT_TIMEZONE) {
  const record = { ...signal, id: signal.id, dateKey: todayKey(new Date(), timeZone), outcome: "missed" };
  await put("signals", record);
  return record;
}

export async function saveSignal(signal, timeZone = DEFAULT_TIMEZONE) {
  const record = { ...signal, dateKey: todayKey(new Date(), timeZone), outcome: signal.rejected ? "rejected" : "qualifying" };
  await put("signals", record);
  return record;
}
