// js/confidence.js
//
// Confidence Engine
// --------------------------------------------------------------
// Produces a 0-100 "setup quality score" broken into stored
// components so the UI can show WHY a setup scored what it did.
//
// IMPORTANT: this is NOT a probability of winning. It measures how
// well the setup satisfies the technical criteria the strategy/
// confirmation engines look for. Two setups with the same score can
// have very different real-world outcomes.

export const DEFAULT_WEIGHTS = {
  marketStructure: 20,
  momentum: 15,
  volume: 15,
  vwap: 10,
  supportResistance: 15,
  candlestick: 10,
  relativeStrength: 10,
  marketRegime: 5,
};

export function totalWeight(weights = DEFAULT_WEIGHTS) {
  return Object.values(weights).reduce((a, b) => a + b, 0);
}

/**
 * Scores each component 0..1 (fraction of its weight earned) from the
 * confirmation-engine output + raw context, then sums to the weight total.
 */
export function computeConfidence(ctx, candidate, confirmationResult, weights = DEFAULT_WEIGHTS) {
  const cats = new Set(confirmationResult.categories);
  const i = ctx.candles.length - 1;

  const components = {};

  // Market Structure: full credit if BOS aligns; half if trend structure aligns without a fresh BOS.
  components.marketStructure = cats.has("structure") ? 1 : cats.has("trend") ? 0.5 : 0;

  // Momentum: full credit if RSI+MACD both agree (checked together in confirmation.js).
  components.momentum = cats.has("momentum") ? 1 : 0;

  // Volume: scaled by how far above the 1.3x RVOL confirmation threshold we are, capped at 1.
  const rvol = ctx.indicators.rvol20[i];
  components.volume = rvol !== null ? Math.min(1, Math.max(0, (rvol - 1) / 1.2)) : 0;

  // VWAP: full credit if on favorable side.
  components.vwap = cats.has("vwap") ? 1 : 0;

  // Support/Resistance: full credit if entry zone sits at a multi-touch level.
  components.supportResistance = cats.has("support_resistance") ? 1 : 0;

  // Candlestick: confirmation-only, partial weight (never allowed to solely create a trade — enforced upstream).
  components.candlestick = cats.has("candlestick") ? 1 : 0;

  // Relative Strength: only applicable when a benchmark spread was computed.
  components.relativeStrength = cats.has("relative_strength") ? 1 : ctx.relativeStrengthSpread === undefined ? 0.5 : 0;

  // Market Regime: full credit if regime explicitly supports the direction.
  components.marketRegime = cats.has("regime") ? 1 : 0;

  const breakdown = Object.fromEntries(
    Object.entries(components).map(([key, frac]) => [key, { fraction: round1(frac), points: round1(frac * weights[key]), maxPoints: weights[key] }])
  );

  const score = Object.entries(components).reduce((acc, [key, frac]) => acc + frac * weights[key], 0);
  const maxScore = totalWeight(weights);

  return {
    score: Math.round(score),
    maxScore,
    breakdown,
    label: scoreLabel(score, maxScore),
    disclaimer: "Confidence is a setup-quality score, not a probability of winning.",
  };
}

function scoreLabel(score, max) {
  const pct = (score / max) * 100;
  if (pct >= 80) return "Strong";
  if (pct >= 65) return "Moderate";
  if (pct >= 50) return "Weak";
  return "Very Weak";
}

function round1(v) {
  return Math.round(v * 100) / 100;
}
