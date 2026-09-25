// js/strategies/common.js
// Shared helpers for strategy modules. Keeps each strategy file focused on
// its own entry/confirmation/stop/target logic instead of re-deriving
// swing/level lookups.

export function nearestLevel(levels, side, price) {
  const filtered = levels.filter((l) => l.side === side);
  if (!filtered.length) return null;
  return filtered.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
}

export function lastSwingLow(swings) {
  const lows = swings.filter((s) => s.type === "low");
  return lows.length ? lows[lows.length - 1] : null;
}

export function lastSwingHigh(swings) {
  const highs = swings.filter((s) => s.type === "high");
  return highs.length ? highs[highs.length - 1] : null;
}

export function last(arr) {
  return arr[arr.length - 1];
}

export function lastIndicatorValue(series) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && series[i] !== undefined) return series[i];
  }
  return null;
}

/** Recent N-bar high/low excluding the current bar — used for breakout/opening-range logic. */
export function priorRange(candles, bars) {
  const slice = candles.slice(Math.max(0, candles.length - 1 - bars), candles.length - 1);
  if (!slice.length) return null;
  return { high: Math.max(...slice.map((c) => c.h)), low: Math.min(...slice.map((c) => c.l)) };
}

/** Wraps a raw strategy candidate with common metadata so downstream engines have a uniform shape. */
export function makeCandidate({ strategyId, direction, entryZoneLow, entryZoneHigh, idealEntry, stopLoss, targetHint, rationale, invalidation, minRR, measuredValues }) {
  return {
    strategyId,
    direction,
    entryZone: { low: Math.min(entryZoneLow, entryZoneHigh), high: Math.max(entryZoneLow, entryZoneHigh) },
    idealEntry,
    stopLoss,
    targetHint, // a raw structural target suggestion; targetEngine.js will validate/refine it
    rationale,
    invalidation,
    minRR,
    measuredValues, // the actual raw indicator value(s) this strategy measured — captured for future threshold-tuning suggestions, never used for anything else
  };
}
