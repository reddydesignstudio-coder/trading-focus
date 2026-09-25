// js/strategies/usStocks.js
import { nearestLevel, lastSwingLow, lastSwingHigh, priorRange, makeCandidate } from "./common.js";
import { localParts } from "../timezone.js";

export const openingRangeBreakout = {
  id: "orb_volume",
  name: "Opening Range Breakout + Volume",
  description: "Trades a breakout of the first N bars' range on the entry timeframe, confirmed by expanding volume.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Strong Uptrend", "Strong Downtrend", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "5m entry / 15m context",
  minRR: 2,
  entryConditions: "Close breaks above/below the opening-range high/low.",
  confirmationConditions: "RVOL >= 1.5x and breakout candle body > 50% of its range.",
  stopLogic: "Opposite side of the opening range (or breakout candle low/high, whichever is tighter).",
  targetLogic: "Structural target: next resistance/support beyond the range, minimum configured R:R.",
  invalidations: "Price re-enters the opening range and closes back inside it.",
  // Editable in Settings → Strategy Thresholds. These are the exact values
  // that were previously hardcoded literals inside evaluate() below —
  // moving them here changes nothing for anyone until they're explicitly
  // tuned. rvolMin is also the one this strategy's "why" doc calls out;
  // orBars intentionally stays out of the tunable set for now (changing
  // it changes what "the opening range" even means, not just a filter
  // threshold — a bigger, more deliberate decision than a slider).
  defaultThresholds: { rvolMin: 1.5 },
  evaluate(ctx, thresholds = this.defaultThresholds) {
    const OR_BARS = 6; // first ~30 min on 5m bars
    const rangeSlice = ctx.candles.slice(0, OR_BARS);
    if (ctx.candles.length <= OR_BARS + 2 || !rangeSlice.length) return null;
    const orHigh = Math.max(...rangeSlice.map((c) => c.h));
    const orLow = Math.min(...rangeSlice.map((c) => c.l));
    const lastC = ctx.candles[ctx.candles.length - 1];
    const rvol = ctx.indicators.rvol20[ctx.candles.length - 1];
    const rvolMin = thresholds.rvolMin ?? 1.5;

    if (lastC.c > orHigh && rvol !== null && rvol >= rvolMin) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: orHigh,
        entryZoneHigh: orHigh + (lastC.h - orHigh) * 0.5,
        idealEntry: orHigh + (lastC.h - orHigh) * 0.2,
        stopLoss: orLow,
        targetHint: { type: "structure_or_atr_multiple", atrMultiple: 2 },
        rationale: `Broke above opening-range high ($${orHigh.toFixed(2)}) with RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Close back below opening-range high ($${orHigh.toFixed(2)}).`,
        minRR: this.minRR,
        measuredValues: { rvol }, // captured for future threshold-tuning suggestions — see js/strategyThresholds.js
      });
    }
    if (lastC.c < orLow && rvol !== null && rvol >= rvolMin) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: orLow - (orLow - lastC.l) * 0.5,
        entryZoneHigh: orLow,
        idealEntry: orLow - (orLow - lastC.l) * 0.2,
        stopLoss: orHigh,
        targetHint: { type: "structure_or_atr_multiple", atrMultiple: 2 },
        rationale: `Broke below opening-range low ($${orLow.toFixed(2)}) with RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Close back above opening-range low ($${orLow.toFixed(2)}).`,
        minRR: this.minRR,
        measuredValues: { rvol },
      });
    }
    return null;
  },
};

export const breakoutVolume = {
  id: "breakout_volume",
  name: "Breakout + Volume",
  description: "Trades a decisive close beyond a recent N-bar high/low with volume confirmation.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Strong Uptrend", "Strong Downtrend"],
  timeframe: "15m",
  minRR: 2,
  entryConditions: "Close beyond prior 20-bar high/low.",
  confirmationConditions: "RVOL >= 1.5x, ADX rising.",
  stopLogic: "Beyond the breakout base (opposite side of the prior range).",
  targetLogic: "Structural: measured move of the prior range, capped/floored by min/max R:R.",
  invalidations: "Breakout candle closes back inside the prior range.",
  evaluate(ctx) {
    const pr = priorRange(ctx.candles, 20);
    if (!pr) return null;
    const lastC = ctx.candles[ctx.candles.length - 1];
    const rvol = ctx.indicators.rvol20[ctx.candles.length - 1];
    const adxSeries = ctx.indicators.adx14.adx;
    const adxNow = adxSeries[adxSeries.length - 1];
    const adxPrev = adxSeries[adxSeries.length - 2];
    const adxRising = adxNow !== null && adxPrev !== null && adxNow > adxPrev;

    if (lastC.c > pr.high && rvol >= 1.5 && adxRising) {
      const measuredMove = pr.high - pr.low;
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: pr.high,
        entryZoneHigh: lastC.h,
        idealEntry: pr.high + (lastC.c - pr.high) * 0.3,
        stopLoss: pr.high - (pr.high - pr.low) * 0.25,
        targetHint: { type: "measured_move", price: lastC.c + measuredMove },
        rationale: `Closed above 20-bar range high ($${pr.high.toFixed(2)}) with RVOL ${rvol.toFixed(2)}x and rising ADX.`,
        invalidation: `Close back inside the prior range (below $${pr.high.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    if (lastC.c < pr.low && rvol >= 1.5 && adxRising) {
      const measuredMove = pr.high - pr.low;
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.l,
        entryZoneHigh: pr.low,
        idealEntry: pr.low - (pr.low - lastC.c) * 0.3,
        stopLoss: pr.low + (pr.high - pr.low) * 0.25,
        targetHint: { type: "measured_move", price: lastC.c - measuredMove },
        rationale: `Closed below 20-bar range low ($${pr.low.toFixed(2)}) with RVOL ${rvol.toFixed(2)}x and rising ADX.`,
        invalidation: `Close back inside the prior range (above $${pr.low.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const breakoutRetest = {
  id: "breakout_retest",
  name: "Breakout Retest",
  description: "Waits for a prior breakout level to be retested and held before entering — avoids chasing.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Strong Uptrend", "Strong Downtrend", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "15m",
  minRR: 2,
  entryConditions: "Price breaks structure, then pulls back to the broken level and shows a rejection candle.",
  confirmationConditions: "Rejection wick at the level; volume contraction into the retest then expansion on the bounce.",
  stopLogic: "Just beyond the retested level.",
  targetLogic: "Next structural level (resistance for longs, support for shorts).",
  invalidations: "Close back through the retested level in the opposite direction.",
  evaluate(ctx) {
    const bos = ctx.structure.bos;
    if (!bos.bos) return null;
    const lastC = ctx.candles[ctx.candles.length - 1];
    const tolerance = lastC.c * 0.003; // 0.3% retest tolerance
    const nearLevel = Math.abs(lastC.l - bos.level) <= tolerance || Math.abs(lastC.h - bos.level) <= tolerance;
    if (!nearLevel) return null;

    if (bos.direction === "bullish" && lastC.c > bos.level) {
      const res = nearestLevel(ctx.structure.levels, "resistance", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: bos.level,
        entryZoneHigh: bos.level + tolerance * 2,
        idealEntry: bos.level + tolerance,
        stopLoss: bos.level - tolerance * 3,
        targetHint: res ? { type: "level", price: res.price } : { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: `Retest of broken structure level at $${bos.level.toFixed(2)} held on the pullback.`,
        invalidation: `Close back below $${(bos.level - tolerance * 3).toFixed(2)}.`,
        minRR: this.minRR,
      });
    }
    if (bos.direction === "bearish" && lastC.c < bos.level) {
      const sup = nearestLevel(ctx.structure.levels, "support", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: bos.level - tolerance * 2,
        entryZoneHigh: bos.level,
        idealEntry: bos.level - tolerance,
        stopLoss: bos.level + tolerance * 3,
        targetHint: sup ? { type: "level", price: sup.price } : { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: `Retest of broken structure level at $${bos.level.toFixed(2)} held on the bounce.`,
        invalidation: `Close back above $${(bos.level + tolerance * 3).toFixed(2)}.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const trendPullback = {
  id: "trend_pullback_us",
  name: "Trend Pullback",
  description: "Buys pullbacks to the rising EMA20/50 in an established uptrend (or sells rallies in a downtrend).",
  market: "us_stocks",
  minCandles: 70, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 150, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Strong Uptrend", "Weak Uptrend", "Strong Downtrend", "Weak Downtrend"],
  timeframe: "15m / 1h context",
  minRR: 2,
  entryConditions: "Price pulls back to the EMA20 (or EMA20-50 zone) within an established trend and shows a reaction candle.",
  confirmationConditions: "Higher-timeframe trend agrees; RSI not extreme against the trend.",
  stopLogic: "Beyond the most recent swing low (uptrend) / swing high (downtrend).",
  targetLogic: "Prior swing high (uptrend) / swing low (downtrend), or ATR multiple if no clear level.",
  invalidations: "Close beyond the EMA50 against trend direction.",
  evaluate(ctx) {
    const { trendLabel } = ctx.regimeResult;
    const lastC = ctx.candles[ctx.candles.length - 1];
    const ema20 = ctx.indicators.ema20[ctx.candles.length - 1];
    const ema50 = ctx.indicators.ema50[ctx.candles.length - 1];
    if (ema20 === null || ema50 === null) return null;
    const nearEma = Math.abs(lastC.l - ema20) / lastC.c < 0.01 || Math.abs(lastC.h - ema20) / lastC.c < 0.01;

    if ((trendLabel === "Strong Uptrend" || trendLabel === "Weak Uptrend") && nearEma && lastC.c > ema20 * 0.995) {
      const swingLow = lastSwingLow(ctx.structure.swings);
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: ema20 * 0.998,
        entryZoneHigh: ema20 * 1.004,
        idealEntry: ema20,
        stopLoss: swingLow ? swingLow.price : ema50,
        targetHint: swingHigh ? { type: "level", price: swingHigh.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Pullback to rising EMA20 ($${ema20.toFixed(2)}) within an established uptrend.`,
        invalidation: `Close below EMA50 ($${ema50.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    if ((trendLabel === "Strong Downtrend" || trendLabel === "Weak Downtrend") && nearEma && lastC.c < ema20 * 1.005) {
      const swingHigh = lastSwingHigh(ctx.structure.swings);
      const swingLow = lastSwingLow(ctx.structure.swings);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: ema20 * 0.996,
        entryZoneHigh: ema20 * 1.002,
        idealEntry: ema20,
        stopLoss: swingHigh ? swingHigh.price : ema50,
        targetHint: swingLow ? { type: "level", price: swingLow.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Rally into falling EMA20 ($${ema20.toFixed(2)}) within an established downtrend.`,
        invalidation: `Close above EMA50 ($${ema50.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const vwapReclaim = {
  id: "vwap_reclaim_rejection",
  name: "VWAP Reclaim/Rejection",
  description: "Trades a reclaim of session VWAP from below (long) or rejection from above (short) as a mean-reversion-to-trend setup.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range", "Weak Uptrend", "Weak Downtrend", "Strong Uptrend", "Strong Downtrend"],
  timeframe: "5m / 15m",
  minRR: 1.5,
  entryConditions: "Price closes back above VWAP after trading below it (or below VWAP after trading above it).",
  confirmationConditions: "Volume on the reclaim/rejection candle above the recent average.",
  stopLogic: "Beyond the reclaim/rejection candle's opposite extreme.",
  targetLogic: "Next resistance/support level or 1.5-2x ATR.",
  invalidations: "Price closes back on the wrong side of VWAP.",
  evaluate(ctx) {
    const i = ctx.candles.length - 1;
    const vwap = ctx.indicators.vwap[i];
    const prevVwap = ctx.indicators.vwap[i - 1];
    if (vwap === null) return null;
    const prevC = ctx.candles[i - 1];
    const lastC = ctx.candles[i];
    const rvol = ctx.indicators.rvol20[i];
    const volOk = rvol !== null ? rvol >= 1.1 : true;

    if (prevC.c < prevVwap && lastC.c > vwap && volOk) {
      const res = nearestLevel(ctx.structure.levels, "resistance", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: vwap,
        entryZoneHigh: vwap + (lastC.c - vwap) * 0.6,
        idealEntry: vwap + (lastC.c - vwap) * 0.25,
        stopLoss: Math.min(lastC.l, vwap - (lastC.c - vwap) * 0.5),
        targetHint: res ? { type: "level", price: res.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Reclaimed session VWAP ($${vwap.toFixed(2)}) with supporting volume.`,
        invalidation: `Close back below VWAP ($${vwap.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    if (prevC.c > prevVwap && lastC.c < vwap && volOk) {
      const sup = nearestLevel(ctx.structure.levels, "support", lastC.c);
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: vwap - (vwap - lastC.c) * 0.6,
        entryZoneHigh: vwap,
        idealEntry: vwap - (vwap - lastC.c) * 0.25,
        stopLoss: Math.max(lastC.h, vwap + (vwap - lastC.c) * 0.5),
        targetHint: sup ? { type: "level", price: sup.price } : { type: "atr_multiple", atrMultiple: 2 },
        rationale: `Rejected from session VWAP ($${vwap.toFixed(2)}) with supporting volume.`,
        invalidation: `Close back above VWAP ($${vwap.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const relativeStrengthBreakout = {
  id: "relative_strength_breakout",
  name: "Relative Strength Breakout",
  description: "Trades a breakout in a symbol showing relative strength (or weakness) versus its sector/benchmark.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Strong Uptrend", "Strong Downtrend"],
  timeframe: "15m",
  minRR: 2,
  entryConditions: "Symbol breaks its own N-bar range while outperforming (long) or underperforming (short) the benchmark's return over the same window.",
  confirmationConditions: "Relative performance spread >= 0.5% vs. benchmark over the lookback window.",
  stopLogic: "Beyond the breakout base.",
  targetLogic: "Measured move / next structural level.",
  invalidations: "Relative strength reverses (symbol underperforms benchmark on the next bar).",
  evaluate(ctx) {
    if (!ctx.benchmarkCandles || ctx.benchmarkCandles.length < 20) return null; // requires a benchmark series (e.g. SPY)
    const lookback = 20;
    const pr = priorRange(ctx.candles, lookback);
    if (!pr) return null;
    const lastC = ctx.candles[ctx.candles.length - 1];
    const symReturn = (lastC.c - ctx.candles[ctx.candles.length - 1 - lookback].c) / ctx.candles[ctx.candles.length - 1 - lookback].c;
    const benchStart = ctx.benchmarkCandles[ctx.benchmarkCandles.length - 1 - lookback];
    const benchEnd = ctx.benchmarkCandles[ctx.benchmarkCandles.length - 1];
    if (!benchStart || !benchEnd) return null;
    const benchReturn = (benchEnd.c - benchStart.c) / benchStart.c;
    const spread = (symReturn - benchReturn) * 100;

    if (lastC.c > pr.high && spread >= 0.5) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: pr.high,
        entryZoneHigh: lastC.h,
        idealEntry: pr.high + (lastC.c - pr.high) * 0.3,
        stopLoss: pr.low,
        targetHint: { type: "measured_move", price: lastC.c + (pr.high - pr.low) },
        rationale: `Breakout with relative-strength spread of +${spread.toFixed(2)}% vs. benchmark over ${lookback} bars.`,
        invalidation: `Relative strength spread turns negative, or close back inside the prior range.`,
        minRR: this.minRR,
      });
    }
    if (lastC.c < pr.low && spread <= -0.5) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.l,
        entryZoneHigh: pr.low,
        idealEntry: pr.low - (pr.low - lastC.c) * 0.3,
        stopLoss: pr.high,
        targetHint: { type: "measured_move", price: lastC.c - (pr.high - pr.low) },
        rationale: `Breakdown with relative-weakness spread of ${spread.toFixed(2)}% vs. benchmark over ${lookback} bars.`,
        invalidation: `Relative weakness reverses, or close back inside the prior range.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const bollingerMeanReversion = {
  id: "bollinger_mean_reversion_us",
  name: "Bollinger Band Mean Reversion",
  description: "Fades a touch of the outer Bollinger Band back toward the middle band — a range-bound counterpart to the trend strategies above, added because Bollinger mean reversion is one of the most widely used range setups and wasn't covered.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Range"],
  timeframe: "15m",
  minRR: 1.5,
  entryConditions: "Price touches or pierces the lower/upper Bollinger Band (20-period, 2 standard deviations) while the market is in a Range regime (not trending).",
  confirmationConditions: "Rejection wick at the touched band; regime confirms Range.",
  stopLogic: "Just beyond the touched band.",
  targetLogic: "The middle band (20-period moving average) — a conservative, structural mean-reversion target.",
  invalidations: "Close beyond the touched band — the range is breaking, not holding.",
  evaluate(ctx) {
    if (ctx.regimeResult.regime !== "Range") return null; // by design, only fades within a genuine range
    const i = ctx.candles.length - 1;
    const lastC = ctx.candles[i];
    const { upper, middle, lower } = ctx.indicators.bollinger20;
    if (upper[i] === null || lower[i] === null) return null;

    if (lastC.l <= lower[i] && lastC.c > lower[i]) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: lower[i],
        entryZoneHigh: lower[i] + (lastC.c - lower[i]) * 0.6,
        idealEntry: lastC.c,
        stopLoss: lastC.l - (middle[i] - lower[i]) * 0.15,
        targetHint: { type: "level", price: middle[i] },
        rationale: `Touched the lower Bollinger Band ($${lower[i].toFixed(2)}) and rejected back inside it in a Range regime.`,
        invalidation: `Close below $${lower[i].toFixed(2)} — the range would be breaking down, not holding.`,
        minRR: this.minRR,
      });
    }
    if (lastC.h >= upper[i] && lastC.c < upper[i]) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: upper[i] - (upper[i] - lastC.c) * 0.6,
        entryZoneHigh: upper[i],
        idealEntry: lastC.c,
        stopLoss: lastC.h + (upper[i] - middle[i]) * 0.15,
        targetHint: { type: "level", price: middle[i] },
        rationale: `Touched the upper Bollinger Band ($${upper[i].toFixed(2)}) and rejected back inside it in a Range regime.`,
        invalidation: `Close above $${upper[i].toFixed(2)} — the range would be breaking out, not holding.`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const gapAndGo = {
  id: "gap_and_go",
  name: "Gap and Go",
  description: "Trades continuation of an overnight gap (today's open vs. the prior session's close) on strong relative volume — a very widely used retail opening-session strategy that wasn't covered.",
  market: "us_stocks",
  minCandles: 50, // longest indicator this strategy uses needs at least this many to produce a value at all
  recommendedCandles: 100, // enough for that indicator to be considered "settled" rather than still warming up
  applicableRegime: ["Breakout", "Strong Uptrend", "Strong Downtrend", "Weak Uptrend", "Weak Downtrend"],
  timeframe: "15m",
  minRR: 2,
  entryConditions: "Today's session opened at least 1% away from the prior session's close, and price is continuing in the gap's direction.",
  confirmationConditions: "RVOL >= 1.5x; price is holding on the gap side of today's open, not filling back through it.",
  stopLogic: "Back through today's opening price — the level that defines whether the gap is holding.",
  targetLogic: "ATR-multiple continuation (a fresh gap has no prior intraday structure yet to target).",
  invalidations: "Price fills back through today's open into the gap — the move is failing.",
  evaluate(ctx) {
    if (ctx.market !== "us_stocks") return null;
    const candles = ctx.candles;
    const nyDateKeys = candles.map((c) => localParts(new Date(c.t), "America/New_York").dateKey);
    const lastKey = nyDateKeys[nyDateKeys.length - 1];
    let todayStartIdx = candles.length - 1;
    while (todayStartIdx > 0 && nyDateKeys[todayStartIdx - 1] === lastKey) todayStartIdx--;
    if (todayStartIdx === 0) return null; // no prior session in the fetched window to compare against

    const prevClose = candles[todayStartIdx - 1].c;
    const todayOpen = candles[todayStartIdx].o;
    const gapPct = ((todayOpen - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < 1) return null; // not a meaningful gap

    const i = candles.length - 1;
    const lastC = candles[i];
    const rvol = ctx.indicators.rvol20[i];
    if (rvol === null || rvol < 1.5) return null;
    const atrNow = ctx.indicators.atr14[i] ?? lastC.c * 0.01;

    if (gapPct > 0 && lastC.c > todayOpen) {
      return makeCandidate({
        strategyId: this.id,
        direction: "long",
        entryZoneLow: todayOpen,
        entryZoneHigh: lastC.c,
        idealEntry: Math.max(todayOpen, lastC.c - atrNow * 0.3),
        stopLoss: todayOpen - atrNow * 0.5,
        targetHint: { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: `Gapped up ${gapPct.toFixed(1)}% from the prior close and is holding above the open with RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Price fills back below today's open ($${todayOpen.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    if (gapPct < 0 && lastC.c < todayOpen) {
      return makeCandidate({
        strategyId: this.id,
        direction: "short",
        entryZoneLow: lastC.c,
        entryZoneHigh: todayOpen,
        idealEntry: Math.min(todayOpen, lastC.c + atrNow * 0.3),
        stopLoss: todayOpen + atrNow * 0.5,
        targetHint: { type: "atr_multiple", atrMultiple: 2.5 },
        rationale: `Gapped down ${gapPct.toFixed(1)}% from the prior close and is holding below the open with RVOL ${rvol.toFixed(2)}x.`,
        invalidation: `Price fills back above today's open ($${todayOpen.toFixed(2)}).`,
        minRR: this.minRR,
      });
    }
    return null;
  },
};

export const US_STOCK_STRATEGIES = [openingRangeBreakout, breakoutVolume, breakoutRetest, trendPullback, vwapReclaim, relativeStrengthBreakout, bollingerMeanReversion, gapAndGo];
