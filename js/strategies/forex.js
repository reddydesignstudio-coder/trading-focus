// js/strategies/forex.js
import { nearestLevel, lastSwingLow, lastSwingHigh, priorRange, makeCandidate } from "./common.js";

export const londonBreakout = {
  id: "london_breakout",
  name: "London Breakout",
  description: "Trades the breakout of the Asian/pre-London range at the London open.",
  market: "forex",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Weak Uptrend", "Weak Downtrend", "Strong Uptrend", "Strong Downtrend"],
  timeframe: "15m entry / 1h context",
  minRR: 2,
  entryConditions: "Close breaks the pre-London (Asian session) range high/low shortly after London opens.",
  confirmationConditions: "London session flagged active; ATR expansion vs. Asian-session ATR.",
  stopLogic: "Opposite side of the pre-London range.",
  targetLogic: "Measured move of the pre-London range.",
  invalidations: "Price re-enters the pre-London range and closes back inside it.",
  evaluate(ctx) {
    if (!ctx.sessionFlags?.london) return null;
    const pr = priorRange(ctx.candles, 16); // ~4h of 15m bars as an Asian-session proxy
    if (!pr) return null;
    const lastC = ctx.candles[ctx.candles.length - 1];
    const mm = pr.high - pr.low;
    if (lastC.c > pr.high) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: pr.high,
        entryZoneHigh: lastC.h,
        idealEntry: pr.high + mm * 0.1,
        stopLoss: pr.low,
        targetHint: { type: "measured_move", price: lastC.c + mm },
        rationale: `London-open breakout above pre-session range high (${pr.high.toFixed(5)}).`,
        invalidation: `Close back below ${pr.high.toFixed(5)}.`,
        minRR: this.minRR,
      });
    }
    if (lastC.c < pr.low) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.l,
        entryZoneHigh: pr.low,
        idealEntry: pr.low - mm * 0.1,
        stopLoss: pr.high,
        targetHint: { type: "measured_move", price: lastC.c - mm },
        rationale: `London-open breakdown below pre-session range low (${pr.low.toFixed(5)}).`,
        invalidation: `Close back above ${pr.low.toFixed(5)}.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const overlapMomentum = {
  id: "london_ny_overlap_momentum",
  name: "London/New York Overlap Momentum",
  description: "Trades continuation moves in the direction of the prevailing trend during the highest-liquidity overlap window.",
  market: "forex",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Strong Uptrend", "Strong Downtrend", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "15m",
  minRR: 2,
  entryConditions: "Price makes a fresh higher-high (uptrend) or lower-low (downtrend) during the London/NY overlap.",
  confirmationConditions: "Overlap session flag active; ADX rising; momentum (MACD histogram) agrees with direction.",
  stopLogic: "Most recent swing low/high.",
  targetLogic: "ATR-multiple continuation target.",
  invalidations: "MACD histogram flips against the trade direction.",
  evaluate(ctx) {
    if (!ctx.sessionFlags?.overlap) return null;
    const { trendLabel } = ctx.regimeResult;
    const i = ctx.candles.length - 1;
    const hist = ctx.indicators.macd.histogram[i];
    const lastC = ctx.candles[i];
    if (hist === null) return null;

    if ((trendLabel === "Strong Uptrend" || trendLabel === "Weak Uptrend") && hist > 0) {
      const swingLow = lastSwingLow(ctx.structure.swings);
      const atr = ctx.indicators.atr14[i];
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: lastC.c - atr * 0.15,
        entryZoneHigh: lastC.c + atr * 0.1,
        idealEntry: lastC.c,
        stopLoss: swingLow ? swingLow.price : lastC.c - atr * 1.5,
        targetHint: { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: "Uptrend momentum continuation during the London/New York liquidity overlap.",
        invalidation: "MACD histogram turns negative.",
        minRR: this.minRR,
      });
    }
    if ((trendLabel === "Strong Downtrend" || trendLabel === "Weak Downtrend") && hist < 0) {
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      const atr = ctx.indicators.atr14[i];
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.c - atr * 0.1,
        entryZoneHigh: lastC.c + atr * 0.15,
        idealEntry: lastC.c,
        stopLoss: swingHigh ? swingHigh.price : lastC.c + atr * 1.5,
        targetHint: { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: "Downtrend momentum continuation during the London/New York liquidity overlap.",
        invalidation: "MACD histogram turns positive.",
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const trendPullbackFx = {
  id: "trend_pullback_fx",
  name: "Trend Pullback",
  description: "Buys pullbacks to EMA20 in an FX uptrend, sells rallies in a downtrend.",
  market: "forex",
  minCandles: 70, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 150, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Strong Uptrend", "Weak Uptrend", "Strong Downtrend", "Weak Downtrend"],
  timeframe: "1h",
  minRR: 2,
  entryConditions: "Price pulls back to EMA20 within an established trend.",
  confirmationConditions: "RSI resets toward 50 without crossing into the opposite extreme.",
  stopLogic: "Beyond the most recent swing.",
  targetLogic: "Prior swing extreme or ATR multiple.",
  invalidations: "Close beyond EMA50 against the trend.",
  // Editable in Settings → Strategy Thresholds.
  defaultThresholds: { emaProximity: 0.0015, rsiLongMin: 40, rsiLongMax: 65, rsiShortMin: 35, rsiShortMax: 60 },
  evaluate(ctx, thresholds = this.defaultThresholds) {
    const { trendLabel } = ctx.regimeResult;
    const i = ctx.candles.length - 1;
    const ema20 = ctx.indicators.ema20[i];
    const ema50 = ctx.indicators.ema50[i];
    const rsiVal = ctx.indicators.rsi14[i];
    if (ema20 === null || ema50 === null || rsiVal === null) return null;
    const lastC = ctx.candles[i];
    const emaProximity = thresholds.emaProximity ?? 0.0015;
    const nearEma = Math.abs(lastC.c - ema20) / lastC.c < emaProximity;

    if ((trendLabel === "Strong Uptrend" || trendLabel === "Weak Uptrend") && nearEma && rsiVal > (thresholds.rsiLongMin ?? 40) && rsiVal < (thresholds.rsiLongMax ?? 65)) {
      const swingLow = lastSwingLow(ctx.structure.swings);
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: ema20 * 0.9985,
        entryZoneHigh: ema20 * 1.002,
        idealEntry: ema20,
        stopLoss: swingLow ? swingLow.price : ema50,
        targetHint: swingHigh ? { type: "level", price: swingHigh.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Pullback to EMA20 (${ema20.toFixed(5)}) within an FX uptrend; RSI resetting from ${rsiVal.toFixed(1)}.`,
        invalidation: `Close below EMA50 (${ema50.toFixed(5)}).`,
        minRR: this.minRR,
        measuredValues: { rsi: rsiVal, emaDistancePct: Math.abs(lastC.c - ema20) / lastC.c },
      });
    }
    if ((trendLabel === "Strong Downtrend" || trendLabel === "Weak Downtrend") && nearEma && rsiVal < (thresholds.rsiShortMax ?? 60) && rsiVal > (thresholds.rsiShortMin ?? 35)) {
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      const swingLow = lastSwingLow(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: ema20 * 0.998,
        entryZoneHigh: ema20 * 1.0015,
        idealEntry: ema20,
        stopLoss: swingHigh ? swingHigh.price : ema50,
        targetHint: swingLow ? { type: "level", price: swingLow.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Rally into EMA20 (${ema20.toFixed(5)}) within an FX downtrend; RSI resetting from ${rsiVal.toFixed(1)}.`,
        invalidation: `Close above EMA50 (${ema50.toFixed(5)}).`,
        minRR: this.minRR,
        measuredValues: { rsi: rsiVal, emaDistancePct: Math.abs(lastC.c - ema20) / lastC.c },
      });
    }
    return null;
  },
};

export const liquiditySweepReversal = {
  id: "liquidity_sweep_reversal_fx",
  name: "Liquidity Sweep + Reversal",
  description: "Fades a brief spike beyond a swing high/low (a stop-hunt/liquidity sweep) that immediately reverses back inside the range.",
  market: "forex",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "15m",
  minRR: 1.5,
  entryConditions: "A candle wicks beyond a recent swing high/low but closes back inside it.",
  confirmationConditions: "Rejection wick >= 60% of candle range; RSI shows divergence or extreme reading on the sweep.",
  stopLogic: "Beyond the sweep wick extreme.",
  targetLogic: "Opposite side of the range / mid-range VWAP.",
  invalidations: "Price later closes beyond the sweep extreme in the sweep direction.",
  evaluate(ctx) {
    const i = ctx.candles.length - 1;
    const lastC = ctx.candles[i];
    const swingHigh = lastSwingHigh(ctx.structure.swings);
    const swingLow = lastSwingLow(ctx.structure.swings);
    const range = lastC.h - lastC.l || 1e-9;

    if (swingHigh && lastC.h > swingHigh.price && lastC.c < swingHigh.price && (lastC.h - Math.max(lastC.o, lastC.c)) / range >= 0.6) {
      const sup = nearestLevel(ctx.structure.levels, "support", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.c - range * 0.1,
        entryZoneHigh: lastC.c + range * 0.15,
        idealEntry: lastC.c,
        stopLoss: lastC.h + range * 0.1,
        targetHint: sup ? { type: "level", price: sup.price } : { type: "atr_multiple", atrMultiple: 1.5 },
        rationale: `Liquidity sweep above swing high (${swingHigh.price.toFixed(5)}) rejected back inside range.`,
        invalidation: `Close above sweep high (${lastC.h.toFixed(5)}).`,
        minRR: this.minRR,
      });
    }
    if (swingLow && lastC.l < swingLow.price && lastC.c > swingLow.price && (Math.min(lastC.o, lastC.c) - lastC.l) / range >= 0.6) {
      const res = nearestLevel(ctx.structure.levels, "resistance", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: lastC.c - range * 0.15,
        entryZoneHigh: lastC.c + range * 0.1,
        idealEntry: lastC.c,
        stopLoss: lastC.l - range * 0.1,
        targetHint: res ? { type: "level", price: res.price } : { type: "atr_multiple", atrMultiple: 1.5 },
        rationale: `Liquidity sweep below swing low (${swingLow.price.toFixed(5)}) rejected back inside range.`,
        invalidation: `Close below sweep low (${lastC.l.toFixed(5)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const srRejectionFx = {
  id: "sr_rejection_fx",
  name: "Support/Resistance Rejection",
  description: "Fades a clean reaction off a well-touched support/resistance level.",
  market: "forex",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "1h",
  minRR: 1.5,
  entryConditions: "Price reaches a level with >= 2 prior touches and prints a rejection candle.",
  confirmationConditions: "Candlestick rejection pattern present at the level.",
  stopLogic: "Just beyond the level.",
  targetLogic: "Opposite side of the range.",
  invalidations: "Close beyond the level.",
  evaluate(ctx) {
    const i = ctx.candles.length - 1;
    const lastC = ctx.candles[i];
    const res = nearestLevel(ctx.structure.levels, "resistance", lastC.c);
    const sup = nearestLevel(ctx.structure.levels, "support", lastC.c);
    const tol = lastC.c * 0.0015;

    if (res && res.touches >= 2 && Math.abs(lastC.h - res.price) <= tol && lastC.c < res.price) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: res.price - tol * 2,
        entryZoneHigh: res.price,
        idealEntry: res.price - tol,
        stopLoss: res.price + tol * 3,
        targetHint: sup ? { type: "level", price: sup.price } : { type: "atr_multiple", atrMultiple: 1.5 },
        rationale: `Rejection at resistance (${res.price.toFixed(5)}, ${res.touches} touches).`,
        invalidation: `Close above ${(res.price + tol * 3).toFixed(5)}.`,
        minRR: this.minRR,
      });
    }
    if (sup && sup.touches >= 2 && Math.abs(lastC.l - sup.price) <= tol && lastC.c > sup.price) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: sup.price,
        entryZoneHigh: sup.price + tol * 2,
        idealEntry: sup.price + tol,
        stopLoss: sup.price - tol * 3,
        targetHint: res ? { type: "level", price: res.price } : { type: "atr_multiple", atrMultiple: 1.5 },
        rationale: `Rejection at support (${sup.price.toFixed(5)}, ${sup.touches} touches).`,
        invalidation: `Close below ${(sup.price - tol * 3).toFixed(5)}.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const FOREX_STRATEGIES = [londonBreakout, overlapMomentum, trendPullbackFx, liquiditySweepReversal, srRejectionFx];
