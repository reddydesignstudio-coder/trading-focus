// js/strategies/crypto.js
import { nearestLevel, lastSwingLow, lastSwingHigh, priorRange, makeCandidate } from "./common.js";

export const breakoutRetestCrypto = {
  id: "breakout_retest_crypto",
  name: "Breakout + Retest",
  description: "Trades a retest-and-hold of a broken range level, 24/7 market variant.",
  market: "crypto",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Strong Uptrend", "Strong Downtrend"],
  timeframe: "1h",
  minRR: 2,
  entryConditions: "Range breakout followed by a retest of the broken level that holds.",
  confirmationConditions: "Volume expansion on the breakout; retest volume contraction.",
  stopLogic: "Beyond the retested level.",
  targetLogic: "Measured move of the prior range.",
  invalidations: "Close back through the retested level.",
  evaluate(ctx) {
    const bos = ctx.structure.bos;
    if (!bos.bos) return null;
    const lastC = ctx.candles[ctx.candles.length - 1];
    const tol = lastC.c * 0.004;
    const nearLevel = Math.abs(lastC.l - bos.level) <= tol || Math.abs(lastC.h - bos.level) <= tol;
    if (!nearLevel) return null;
    const pr = priorRange(ctx.candles, 20);
    const mm = pr ? pr.high - pr.low : lastC.c * 0.02;

    if (bos.direction === "bullish" && lastC.c > bos.level) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: bos.level,
        entryZoneHigh: bos.level + tol * 2,
        idealEntry: bos.level + tol,
        stopLoss: bos.level - tol * 3,
        targetHint: { type: "measured_move", price: lastC.c + mm },
        rationale: `Retest of broken level ${bos.level.toFixed(2)} held.`,
        invalidation: `Close below ${(bos.level - tol * 3).toFixed(2)}.`,
        minRR: this.minRR,
      });
    }
    if (bos.direction === "bearish" && lastC.c < bos.level) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: bos.level - tol * 2,
        entryZoneHigh: bos.level,
        idealEntry: bos.level - tol,
        stopLoss: bos.level + tol * 3,
        targetHint: { type: "measured_move", price: lastC.c - mm },
        rationale: `Retest of broken level ${bos.level.toFixed(2)} held.`,
        invalidation: `Close above ${(bos.level + tol * 3).toFixed(2)}.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const trendPullbackCrypto = {
  id: "trend_pullback_crypto",
  name: "Trend Pullback",
  description: "Buys/sells pullbacks to EMA20 within an established crypto trend.",
  market: "crypto",
  minCandles: 70, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 150, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Strong Uptrend", "Weak Uptrend", "Strong Downtrend", "Weak Downtrend"],
  timeframe: "1h / 4h context",
  minRR: 2,
  entryConditions: "Pullback to EMA20 within trend.",
  confirmationConditions: "RSI resets without extreme reversal reading; ADX still trending.",
  stopLogic: "Beyond most recent swing.",
  targetLogic: "Prior swing extreme / ATR multiple.",
  invalidations: "Close beyond EMA50 against trend.",
  evaluate(ctx) {
    const { trendLabel } = ctx.regimeResult;
    const i = ctx.candles.length - 1;
    const ema20 = ctx.indicators.ema20[i];
    const ema50 = ctx.indicators.ema50[i];
    const adxVal = ctx.indicators.adx14.adx[i];
    if (ema20 === null || ema50 === null || adxVal === null || adxVal < 15) return null;
    const lastC = ctx.candles[i];
    const nearEma = Math.abs(lastC.c - ema20) / lastC.c < 0.006;

    if ((trendLabel === "Strong Uptrend" || trendLabel === "Weak Uptrend") && nearEma) {
      const swingLow = lastSwingLow(ctx.structure.swings);
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: ema20 * 0.994,
        entryZoneHigh: ema20 * 1.008,
        idealEntry: ema20,
        stopLoss: swingLow ? swingLow.price : ema50,
        targetHint: swingHigh ? { type: "level", price: swingHigh.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Pullback to EMA20 (${ema20.toFixed(2)}) within a crypto uptrend, ADX ${adxVal.toFixed(1)}.`,
        invalidation: `Close below EMA50 (${ema50.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    if ((trendLabel === "Strong Downtrend" || trendLabel === "Weak Downtrend") && nearEma) {
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      const swingLow = lastSwingLow(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: ema20 * 0.992,
        entryZoneHigh: ema20 * 1.006,
        idealEntry: ema20,
        stopLoss: swingHigh ? swingHigh.price : ema50,
        targetHint: swingLow ? { type: "level", price: swingLow.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Rally into EMA20 (${ema20.toFixed(2)}) within a crypto downtrend, ADX ${adxVal.toFixed(1)}.`,
        invalidation: `Close above EMA50 (${ema50.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const compressionExpansion = {
  id: "volatility_compression_expansion",
  name: "Volatility Compression → Expansion",
  description: "Trades the first directional expansion candle out of an ATR-compression regime.",
  market: "crypto",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "1h",
  minRR: 2,
  entryConditions: "Regime flagged as ATR compression, followed by a strong directional breakout candle.",
  confirmationConditions: "Breakout candle body >= 60% of range; volume above the 20-bar average.",
  stopLogic: "Opposite side of the compression range.",
  targetLogic: "ATR multiple (expansion targets tend to move fast — kept conservative).",
  invalidations: "Price closes back inside the compression range.",
  evaluate(ctx) {
    if (!ctx.regimeResult.compression) return null;
    const i = ctx.candles.length - 1;
    const lastC = ctx.candles[i];
    const range = lastC.h - lastC.l || 1e-9;
    const bodyRatio = Math.abs(lastC.c - lastC.o) / range;
    const rvol = ctx.indicators.rvol20[i];
    if (bodyRatio < 0.6 || rvol === null || rvol < 1.3) return null;
    const pr = priorRange(ctx.candles, 12);
    if (!pr) return null;

    if (lastC.c > lastC.o && lastC.c >= pr.high) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: pr.high,
        entryZoneHigh: lastC.h,
        idealEntry: (pr.high + lastC.h) / 2,
        stopLoss: pr.low,
        targetHint: { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Directional expansion out of a compression regime, RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Close back inside compression range (below ${pr.high.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    if (lastC.c < lastC.o && lastC.c <= pr.low) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.l,
        entryZoneHigh: pr.low,
        idealEntry: (pr.low + lastC.l) / 2,
        stopLoss: pr.high,
        targetHint: { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Directional expansion out of a compression regime, RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Close back inside compression range (above ${pr.low.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const vwapReclaimCrypto = {
  id: "vwap_reclaim_crypto",
  name: "VWAP Reclaim",
  description: "Trades a reclaim of session VWAP with volume, 24/7 rolling-window variant.",
  market: "crypto",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range", "Weak Uptrend", "Weak Downtrend", "Strong Uptrend"],
  timeframe: "1h",
  minRR: 1.5,
  entryConditions: "Close reclaims rolling VWAP from below.",
  confirmationConditions: "Volume above recent average on the reclaim candle.",
  stopLogic: "Below the reclaim candle low.",
  targetLogic: "Next resistance level or ATR multiple.",
  invalidations: "Close back below VWAP.",
  evaluate(ctx) {
    const i = ctx.candles.length - 1;
    const vwap = ctx.indicators.vwap[i];
    const prevVwap = ctx.indicators.vwap[i - 1];
    if (vwap === null || prevVwap === null) return null;
    const lastC = ctx.candles[i];
    const prevC = ctx.candles[i - 1];
    const rvol = ctx.indicators.rvol20[i];
    if (rvol === null || rvol < 1.1) return null;

    if (prevC.c < prevVwap && lastC.c > vwap) {
      const res = nearestLevel(ctx.structure.levels, "resistance", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: vwap,
        entryZoneHigh: lastC.c,
        idealEntry: vwap + (lastC.c - vwap) * 0.3,
        stopLoss: lastC.l,
        targetHint: res ? { type: "level", price: res.price } : { type: "atr_multiple", atrMultiple: 1.5 },
        rationale: `Reclaimed rolling VWAP (${vwap.toFixed(2)}) with RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Close back below VWAP (${vwap.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const liquiditySweepCrypto = {
  id: "liquidity_sweep_reversal_crypto",
  name: "Liquidity Sweep Reversal",
  description: "Fades a wick-based stop hunt beyond a swing extreme that closes back inside range.",
  market: "crypto",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "1h",
  minRR: 1.5,
  entryConditions: "Wick sweep beyond swing high/low, close back inside.",
  confirmationConditions: "Rejection wick >= 60% of candle range.",
  stopLogic: "Beyond the sweep extreme.",
  targetLogic: "Opposite side of range.",
  invalidations: "Close beyond the sweep extreme in sweep direction.",
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
        rationale: `Liquidity sweep above ${swingHigh.price.toFixed(2)} rejected.`,
        invalidation: `Close above ${lastC.h.toFixed(2)}.`,
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
        rationale: `Liquidity sweep below ${swingLow.price.toFixed(2)} rejected.`,
        invalidation: `Close below ${lastC.l.toFixed(2)}.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const emaMomentumCross = {
  id: "ema_momentum_cross_crypto",
  name: "EMA 9/20 Momentum Cross",
  description: "Trades a fresh crossover of the fast EMA9 above/below EMA20, confirmed by trend strength (ADX) — a widely used fast-momentum setup that wasn't covered, well suited to crypto's pace.",
  market: "crypto",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Strong Uptrend", "Weak Uptrend", "Strong Downtrend", "Weak Downtrend", "Breakout"],
  timeframe: "1h",
  minRR: 2,
  entryConditions: "EMA9 crosses above/below EMA20 on the most recent candle (it was on the other side the candle before).",
  confirmationConditions: "ADX >= 20 (real trend strength, not just chop).",
  stopLogic: "Most recent swing low/high around the cross.",
  targetLogic: "ATR-multiple continuation.",
  invalidations: "EMA9 crosses back through EMA20 against the trade direction.",
  // Editable in Settings → Strategy Thresholds.
  defaultThresholds: { adxMin: 20 },
  evaluate(ctx, thresholds = this.defaultThresholds) {
    const i = ctx.candles.length - 1;
    const ema9 = ctx.indicators.ema9;
    const ema20 = ctx.indicators.ema20;
    if (i < 1 || ema9[i] === null || ema9[i - 1] === null || ema20[i] === null || ema20[i - 1] === null) return null;
    const adxVal = ctx.indicators.adx14.adx[i];
    const adxMin = thresholds.adxMin ?? 20;
    if (adxVal === null || adxVal < adxMin) return null;
    const lastC = ctx.candles[i];
    const atrNow = ctx.indicators.atr14[i] ?? lastC.c * 0.01;

    const crossedUp = ema9[i - 1] <= ema20[i - 1] && ema9[i] > ema20[i];
    const crossedDown = ema9[i - 1] >= ema20[i - 1] && ema9[i] < ema20[i];

    if (crossedUp) {
      const swingLow = lastSwingLow(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: lastC.c - atrNow * 0.15,
        entryZoneHigh: lastC.c + atrNow * 0.1,
        idealEntry: lastC.c,
        stopLoss: swingLow ? swingLow.price : lastC.c - atrNow * 1.5,
        targetHint: { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: `Fast EMA9 crossed above EMA20 with ADX ${adxVal.toFixed(1)} confirming trend strength.`,
        invalidation: `EMA9 crosses back below EMA20.`,
        minRR: this.minRR,
        measuredValues: { adx: adxVal },
      });
    }
    if (crossedDown) {
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.c - atrNow * 0.1,
        entryZoneHigh: lastC.c + atrNow * 0.15,
        idealEntry: lastC.c,
        stopLoss: swingHigh ? swingHigh.price : lastC.c + atrNow * 1.5,
        targetHint: { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: `Fast EMA9 crossed below EMA20 with ADX ${adxVal.toFixed(1)} confirming trend strength.`,
        invalidation: `EMA9 crosses back above EMA20.`,
        minRR: this.minRR,
        measuredValues: { adx: adxVal },
      });
    }
    return null;
  },
};

export const CRYPTO_STRATEGIES = [breakoutRetestCrypto, trendPullbackCrypto, compressionExpansion, vwapReclaimCrypto, liquiditySweepCrypto, emaMomentumCross];
