// js/tradeResolution.js
//
// Trade Resolution Engine
// --------------------------------------------------------------
// Deterministic, never-guess resolution:
//   TP touched first  -> WIN
//   SL touched first  -> LOSS
//   Neither touched   -> OPEN
//   Both in same candle, and a smaller-timeframe series is available
//     -> resolve using that smaller timeframe
//   Both in same candle, no finer data available
//     -> AMBIGUOUS (never guessed)

export function resolveAgainstCandles(trade, candles, { smallerTimeframeCandles = null } = {}) {
  const { direction, entryPrice, stopLoss, takeProfit } = trade;

  for (const candle of candles) {
    const hitTP = direction === "long" ? candle.h >= takeProfit : candle.l <= takeProfit;
    const hitSL = direction === "long" ? candle.l <= stopLoss : candle.h >= stopLoss;

    if (hitTP && hitSL) {
      if (smallerTimeframeCandles && smallerTimeframeCandles.length) {
        const finer = smallerTimeframeCandles.filter((c) => c.t >= candle.t && c.t < candle.t + candleDurationGuess(candles));
        const fineResult = resolveAgainstCandles(trade, finer);
        if (fineResult.status !== "AMBIGUOUS" && fineResult.status !== "OPEN") {
          return { ...fineResult, resolvedVia: "smaller_timeframe", ambiguousBar: candle };
        }
      }
      return { status: "AMBIGUOUS", resolvedAt: candle.t, reason: "TP and SL both fell within the same candle's range and no finer timeframe data was available to establish sequence.", candle };
    }
    if (hitTP) {
      return { status: "WIN", resolvedAt: candle.t, exitPrice: takeProfit, candle };
    }
    if (hitSL) {
      return { status: "LOSS", resolvedAt: candle.t, exitPrice: stopLoss, candle };
    }
  }

  return { status: "OPEN" };
}

function candleDurationGuess(candles) {
  if (candles.length < 2) return 900000; // default 15m
  return candles[1].t - candles[0].t;
}

/** Computes realized P&L / R once a trade is resolved. */
export function computeTradeOutcome(trade, resolution) {
  if (resolution.status === "OPEN" || resolution.status === "AMBIGUOUS") {
    return { pnl: null, rMultiple: null, status: resolution.status };
  }
  const { direction, entryPrice, stopLoss, positionSize } = trade;
  const risk = Math.abs(entryPrice - stopLoss);
  const exitPrice = resolution.exitPrice;
  const priceDelta = direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  const pnl = priceDelta * positionSize;
  const rMultiple = risk > 0 ? priceDelta / risk : 0;
  return { pnl, rMultiple, status: resolution.status, exitPrice, resolvedAt: resolution.resolvedAt };
}
