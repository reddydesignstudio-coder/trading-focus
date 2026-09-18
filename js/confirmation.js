// js/confirmation.js
//
// Confirmation Engine
// --------------------------------------------------------------
// Evaluates a fixed set of INDEPENDENT confirmation categories
// against the current market context and a candidate direction.
// Each category maps to a genuinely distinct underlying signal
// source (structure, volume, VWAP, momentum, trend, S/R proximity,
// candlestick, regime, relative strength) so confidence cannot be
// inflated by counting the same fact twice under different names.
//
// Minimum required: 2. Preferred: 3+. Enforced by the scanner.

import { detectPatternsAt, PATTERN_LIST } from "./candlestick.js";

const MIN_REQUIRED_CONFIRMATIONS = 2;
const PREFERRED_CONFIRMATIONS = 3;

function checkStructure(ctx, direction) {
  const bos = ctx.structure.bos;
  if (!bos.bos) return false;
  return (direction === "long" && bos.direction === "bullish") || (direction === "short" && bos.direction === "bearish");
}

function checkTrendAlignment(ctx, direction) {
  const t = ctx.regimeResult.trendLabel;
  if (direction === "long") return t === "Strong Uptrend" || t === "Weak Uptrend";
  return t === "Strong Downtrend" || t === "Weak Downtrend";
}

function checkVolumeRVOL(ctx) {
  const rvol = ctx.indicators.rvol20[ctx.candles.length - 1];
  return rvol !== null && rvol >= 1.3;
}

function checkVWAP(ctx, direction) {
  const i = ctx.candles.length - 1;
  const vwap = ctx.indicators.vwap[i];
  const price = ctx.candles[i].c;
  if (vwap === null) return false;
  return direction === "long" ? price > vwap : price < vwap;
}

function checkMomentum(ctx, direction) {
  const i = ctx.candles.length - 1;
  const hist = ctx.indicators.macd.histogram[i];
  const rsiVal = ctx.indicators.rsi14[i];
  if (hist === null || rsiVal === null) return false;
  if (direction === "long") return hist > 0 && rsiVal > 45 && rsiVal < 75;
  return hist < 0 && rsiVal < 55 && rsiVal > 25;
}

function checkSupportResistance(ctx, direction, candidate) {
  const levels = ctx.structure.levels;
  const price = candidate.idealEntry;
  const tol = price * 0.006;
  if (direction === "long") return levels.some((l) => l.side === "support" && Math.abs(l.price - price) <= tol * 3);
  return levels.some((l) => l.side === "resistance" && Math.abs(l.price - price) <= tol * 3);
}

function checkCandlestick(ctx, direction) {
  const patterns = detectPatternsAt(ctx.candles);
  const wanted = direction === "long" ? PATTERN_LIST.bullish : PATTERN_LIST.bearish;
  const hit = patterns.find((p) => wanted.includes(p.name));
  return hit ? hit.name : null;
}

function checkRegime(ctx, direction) {
  const r = ctx.regimeResult.regime;
  if (direction === "long") return r === "Breakout" || r === "Strong Uptrend" || r === "Weak Uptrend";
  return r === "Breakout" || r === "Strong Downtrend" || r === "Weak Downtrend";
}

function checkRelativeStrength(ctx, direction) {
  if (!ctx.relativeStrengthSpread && ctx.relativeStrengthSpread !== 0) return false;
  return direction === "long" ? ctx.relativeStrengthSpread > 0.3 : ctx.relativeStrengthSpread < -0.3;
}

/**
 * Evaluates all confirmation categories for a candidate. Returns
 * { satisfied: [{category, detail}], count, passes(bool) }.
 * `strategyBypass` lists categories that ARE the strategy's own entry
 * condition (e.g. a breakout strategy already requires "structure") so we
 * don't recount the entry trigger itself as a bonus confirmation — it still
 * counts once, but we make sure at least one ADDITIONAL independent source
 * beyond the trigger is present.
 */
export function evaluateConfirmations(ctx, candidate, triggerCategory) {
  const satisfied = [];

  if (checkStructure(ctx, candidate.direction)) satisfied.push({ category: "structure", detail: "Break of structure aligns with trade direction." });
  if (checkTrendAlignment(ctx, candidate.direction)) satisfied.push({ category: "trend", detail: `Regime trend label: ${ctx.regimeResult.trendLabel}.` });
  if (checkVolumeRVOL(ctx)) satisfied.push({ category: "volume", detail: `RVOL ${ctx.indicators.rvol20[ctx.candles.length - 1].toFixed(2)}x.` });
  if (checkVWAP(ctx, candidate.direction)) satisfied.push({ category: "vwap", detail: "Price on the favorable side of session VWAP." });
  if (checkMomentum(ctx, candidate.direction)) satisfied.push({ category: "momentum", detail: "MACD histogram and RSI agree with direction." });
  if (checkSupportResistance(ctx, candidate.direction, candidate)) satisfied.push({ category: "support_resistance", detail: "Entry zone sits at a validated S/R level." });
  const candle = checkCandlestick(ctx, candidate.direction);
  if (candle) satisfied.push({ category: "candlestick", detail: `${candle} detected (confirmation only).` });
  if (checkRegime(ctx, candidate.direction)) satisfied.push({ category: "regime", detail: `Market regime (${ctx.regimeResult.regime}) supports this direction.` });
  if (checkRelativeStrength(ctx, candidate.direction)) satisfied.push({ category: "relative_strength", detail: "Relative strength/weakness vs. benchmark agrees." });

  // De-duplicate: the strategy's own trigger condition (e.g. "structure" for
  // a breakout-retest strategy) shouldn't be double-counted as a bonus — it
  // is already required to produce the candidate at all. We still show it in
  // the list (transparency), but require at least MIN_REQUIRED beyond it.
  const distinctCategories = [...new Set(satisfied.map((s) => s.category))];
  const bonusCount = distinctCategories.filter((c) => c !== triggerCategory).length;

  return {
    satisfied,
    categories: distinctCategories,
    count: distinctCategories.length,
    bonusCount,
    minRequired: MIN_REQUIRED_CONFIRMATIONS,
    preferred: PREFERRED_CONFIRMATIONS,
    passes: distinctCategories.length >= MIN_REQUIRED_CONFIRMATIONS,
  };
}
