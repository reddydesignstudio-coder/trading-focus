// js/noTrade.js
//
// No-Trade Engine
// --------------------------------------------------------------
// Runs AFTER a strategy produces a raw candidate and the
// confirmation/confidence/target/risk engines have evaluated it.
// Collects every failing filter (not just the first) so the UI can
// explain a rejection fully. Filters are never weakened to produce
// more signals.

const MAX_STOP_DISTANCE_PCT = 3.5; // stop wider than this % of price is considered "too wide" for the intraday strategies in scope
const MAX_EXTENSION_ATR = 3.5; // price extended > 3.5x ATR beyond EMA20 is considered over-extended
const MIN_ATR_PCT_FOR_LIQUIDITY = 0.02; // sanity floor — near-zero ATR usually means illiquid/bad data

export function runNoTradeFilters({ ctx, candidate, confirmationResult, confidenceResult, targetResult, sizingResult, dataStatus }) {
  const reasons = [];

  if (dataStatus && dataStatus.status !== "LIVE" && dataStatus.status !== "DELAYED") {
    reasons.push(`Data status is ${dataStatus.status} — new signal generation is disabled until fresh data is available.`);
  }

  if (!confirmationResult.passes) {
    reasons.push(`Only ${confirmationResult.count} independent confirmation(s) found — minimum required is ${confirmationResult.minRequired}.`);
  }

  if (targetResult.rejected) {
    reasons.push(targetResult.reason);
  }

  if (sizingResult && !sizingResult.valid) {
    reasons.push(sizingResult.reason);
  }

  const i = ctx.candles.length - 1;
  const price = ctx.candles[i].c;
  const atr = ctx.indicators.atr14[i];

  if (atr !== null && price) {
    const stopDistPct = (Math.abs((candidate.idealEntry ?? price) - candidate.stopLoss) / price) * 100;
    if (stopDistPct > MAX_STOP_DISTANCE_PCT) {
      reasons.push(`Stop distance (${stopDistPct.toFixed(2)}%) is wider than the ${MAX_STOP_DISTANCE_PCT}% ceiling for this setup type.`);
    }
    const atrPct = (atr / price) * 100;
    if (atrPct < MIN_ATR_PCT_FOR_LIQUIDITY) {
      reasons.push("ATR is near zero relative to price — likely illiquid or low-quality data for this symbol/timeframe.");
    }
    const ema20 = ctx.indicators.ema20[i];
    if (ema20 !== null && atr > 0) {
      const extension = Math.abs(price - ema20) / atr;
      if (extension > MAX_EXTENSION_ATR) {
        reasons.push(`Price is extended ${extension.toFixed(1)}x ATR beyond EMA20 — excessive extension risk for a fresh entry.`);
      }
    }
  }

  const regime = ctx.regimeResult.regime;
  if (regime === "Range" && (candidate.strategyId.includes("trend_pullback") || candidate.strategyId.includes("breakout_volume"))) {
    reasons.push("Market regime is Range — trend/breakout strategies are not applicable in this regime.");
  }

  if (ctx.regimeResult.trendLabel === "Unclear" && ctx.regimeResult.regime === "Unclear") {
    reasons.push("Market structure/regime is unclear — insufficient data quality for a confident read.");
  }

  return {
    rejected: reasons.length > 0,
    reasons,
  };
}

export const NO_TRADE_FILTER_CATALOG = [
  "Insufficient confirmation",
  "Poor R:R (target capped by structure)",
  "Weak volume/RVOL",
  "Conflicting structure",
  "Middle of range",
  "Nearby S/R capping realistic target",
  "Excessive volatility / near-zero ATR",
  "Low liquidity",
  "Stale or unavailable data",
  "Wrong regime for strategy",
  "Weak momentum",
  "Unclear structure",
  "Excessive extension from EMA",
  "Stop too wide",
  "Unrealistic target",
  "Invalid position sizing",
];
