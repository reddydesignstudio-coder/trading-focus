// js/backtest.js
//
// Backtest Engine
// --------------------------------------------------------------
// Walks forward bar-by-bar through historical candles, calling the
// SAME strategy modules / confirmation / confidence / target / risk
// logic the live scanner uses, but only ever showing each strategy
// the candles up to and including "now" in the walk (index i) — the
// strategy never sees future bars, which is what avoids look-ahead
// bias. Trade resolution then walks forward from the entry bar
// using the same tradeResolution.js used by paper trading.
//
// IN-SAMPLE vs OUT-OF-SAMPLE: the caller supplies a `splitIndex`
// (or `splitDate`). Bars before it are IN-SAMPLE (used to judge fit
// while iterating on a strategy); bars at/after it are OUT-OF-SAMPLE
// (a holdout the strategy's rules were not tuned against in this
// run). The engine does not itself tune parameters — Phase 1 has no
// automatic optimizer — so this split exists primarily so the UI
// can present both windows' stats separately per the requirement.

import { computeIndicatorSet } from "./indicators.js";
import { analyzeStructure } from "./structure.js";
import { classifyRegime } from "./regime.js";
import { getStrategyById } from "./strategies/index.js";
import { evaluateConfirmations } from "./confirmation.js";
import { computeConfidence } from "./confidence.js";
import { resolveTarget } from "./targetEngine.js";
import { recalculateTrade } from "./risk.js";
import { runNoTradeFilters } from "./noTrade.js";
import { resolveAgainstCandles, computeTradeOutcome } from "./tradeResolution.js";
import { computePerformance } from "./performance.js";
import { uid } from "./utils.js";
import { getEffectiveThresholds } from "./strategyThresholds.js";

const MIN_HISTORY_BARS = 60;

/**
 * @param candles          Full historical OHLCV array, oldest first.
 * @param strategyIds      Array of strategy ids to test (defaults to all applicable to `market`).
 * @param market
 * @param riskSettings
 * @param splitIndex       Index in `candles` separating in-sample (< splitIndex) from out-of-sample (>= splitIndex).
 * @param tradesPerDayCap  Optional cap mirroring Test Mode limits, for realism.
 */
export function runBacktest({ candles, strategyIds, market, symbol, riskSettings, splitIndex, minRRoverride, settings = {} }) {
  if (!candles || candles.length < MIN_HISTORY_BARS + 5) {
    return { error: "Not enough historical candles supplied for a meaningful backtest (need at least 65 bars)." };
  }
  const strategies = strategyIds.map((id) => getStrategyById(id)).filter(Boolean);
  const effectiveSplit = splitIndex ?? Math.floor(candles.length * 0.7);

  const trades = [];
  let openTrade = null;

  for (let i = MIN_HISTORY_BARS; i < candles.length; i++) {
    const windowCandles = candles.slice(0, i + 1); // ONLY past + current bar — no look-ahead

    // If a trade is open, check resolution using bars strictly after entry, one at a time as we walk forward.
    if (openTrade && !openTrade.resolved) {
      const barsSinceEntry = candles.slice(openTrade.entryIndex + 1, i + 1);
      if (barsSinceEntry.length) {
        const resolution = resolveAgainstCandles(
          { direction: openTrade.direction, entryPrice: openTrade.entryPrice, stopLoss: openTrade.stopLoss, takeProfit: openTrade.takeProfit },
          barsSinceEntry
        );
        if (resolution.status !== "OPEN") {
          const outcome = computeTradeOutcome(
            { direction: openTrade.direction, entryPrice: openTrade.entryPrice, stopLoss: openTrade.stopLoss, positionSize: openTrade.positionSize },
            resolution
          );
          trades.push({
            ...openTrade,
            status: resolution.status,
            pnl: outcome.pnl,
            rMultiple: outcome.rMultiple,
            resolvedAt: resolution.resolvedAt ? new Date(resolution.resolvedAt).toISOString() : new Date(candles[i].t).toISOString(),
            resolvedIndex: i,
            resolved: true,
            inSample: openTrade.entryIndex < effectiveSplit,
          });
          openTrade = null;
        }
      }
      continue; // one open trade at a time in this Phase-1 backtester (documented simplification)
    }

    if (windowCandles.length < MIN_HISTORY_BARS) continue;

    const indicators = computeIndicatorSet(windowCandles);
    const structureResult = analyzeStructure(windowCandles);
    const regimeResult = classifyRegime(windowCandles, indicators);
    const ctx = {
      candles: windowCandles,
      indicators,
      structure: structureResult,
      regimeResult,
      price: windowCandles[windowCandles.length - 1].c,
      market,
      symbol,
      sessionFlags: { london: true, overlap: true, ny: true, tokyo: true }, // backtests are session-agnostic by default (documented)
      benchmarkCandles: null,
    };

    for (const strategy of strategies) {
      let candidate;
      try {
        candidate = strategy.evaluate(ctx, getEffectiveThresholds(strategy, settings));
      } catch {
        continue;
      }
      if (!candidate) continue;

      const confirmationResult = evaluateConfirmations(ctx, candidate, null);
      const confidenceResult = computeConfidence(ctx, candidate, confirmationResult);
      const atrNow = indicators.atr14[windowCandles.length - 1] ?? ctx.price * 0.01;
      const minRR = minRRoverride ?? candidate.minRR;
      const targetResult = resolveTarget({ ...candidate, minRR }, candidate.idealEntry, candidate.stopLoss, atrNow, structureResult.levels);
      if (targetResult.rejected) continue;

      const sizing = recalculateTrade({
        direction: candidate.direction,
        entryPrice: candidate.idealEntry,
        stopLoss: candidate.stopLoss,
        takeProfit: targetResult.finalTarget,
        settings: riskSettings,
        minRR,
      });
      if (!sizing.valid) continue;

      const noTrade = runNoTradeFilters({
        ctx,
        candidate: { ...candidate, minRR },
        confirmationResult,
        confidenceResult,
        targetResult,
        sizingResult: sizing,
        dataStatus: { status: "LIVE" },
      });
      if (noTrade.rejected) continue;

      openTrade = {
        id: uid("bt_trade"),
        symbol,
        market,
        strategyId: strategy.id,
        strategyName: strategy.name,
        direction: candidate.direction,
        entryIndex: i,
        entryPrice: candidate.idealEntry,
        stopLoss: candidate.stopLoss,
        takeProfit: sizing.takeProfit,
        positionSize: sizing.units,
        dollarRisk: sizing.dollarRisk,
        rr: sizing.rr,
        confidence: confidenceResult,
        regime: regimeResult.regime,
        createdAt: new Date(windowCandles[windowCandles.length - 1].t).toISOString(),
        resolved: false,
      };
      break; // one candidate trade per bar in this simplified walk-forward loop
    }
  }

  const inSampleTrades = trades.filter((t) => t.inSample);
  const outOfSampleTrades = trades.filter((t) => !t.inSample);

  return {
    market,
    symbol,
    strategyIds,
    totalBars: candles.length,
    splitIndex: effectiveSplit,
    trades,
    inSample: { count: inSampleTrades.length, performance: computePerformance({ trades: inSampleTrades, startingBalance: riskSettings.accountBalance }) },
    outOfSample: {
      count: outOfSampleTrades.length,
      performance: computePerformance({ trades: outOfSampleTrades, startingBalance: riskSettings.accountBalance }),
    },
    overall: computePerformance({ trades, startingBalance: riskSettings.accountBalance }),
    caveats: [
      "One open position at a time is modeled in Phase 1 (no portfolio-level concurrency).",
      "Sessions are treated as always-active in backtests — session-gated strategies (e.g. London Breakout) will trigger outside their real session window; interpret with that in mind.",
      "Backtest results use historical data quality from the same free providers as live data and do not reflect slippage, fees, or partial fills.",
      "Past performance in a backtest does not indicate future results.",
    ],
  };
}
