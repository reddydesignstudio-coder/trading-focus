// js/regime.js
//
// Market Regime Engine
// --------------------------------------------------------------
// Classifies the current market into one of a fixed set of regimes
// using ADX (trend strength), EMA slope/order (direction), ATR vs.
// its own recent history (volatility expansion/compression), and
// recent range compression (Bollinger-band-width-style proxy via
// ATR/price ratio).

export function classifyRegime(candles, indicators) {
  const n = candles.length;
  const last = n - 1;
  const closes = candles.map((c) => c.c);
  const price = closes[last];

  const adxVal = indicators.adx14.adx[last];
  const plusDI = indicators.adx14.plusDI[last];
  const minusDI = indicators.adx14.minusDI[last];
  const ema20 = indicators.ema20[last];
  const ema50 = indicators.ema50[last];
  const atrVal = indicators.atr14[last];

  // Volatility state: compare current ATR% to its own 20-bar average.
  const atrSeries = indicators.atr14.slice(Math.max(0, last - 20), last).filter((v) => v !== null);
  const atrAvg = atrSeries.length ? atrSeries.reduce((a, b) => a + b, 0) / atrSeries.length : atrVal;
  const atrPctOfPrice = atrVal && price ? (atrVal / price) * 100 : null;
  const volatilityState =
    atrVal && atrAvg ? (atrVal > atrAvg * 1.25 ? "expansion" : atrVal < atrAvg * 0.75 ? "compression" : "normal") : "normal";

  let trendLabel = "Unclear";
  if (adxVal !== null && ema20 !== null && ema50 !== null) {
    const bullishStack = price > ema20 && ema20 > ema50;
    const bearishStack = price < ema20 && ema20 < ema50;
    if (adxVal >= 25 && bullishStack && plusDI > minusDI) trendLabel = "Strong Uptrend";
    else if (adxVal >= 25 && bearishStack && minusDI > plusDI) trendLabel = "Strong Downtrend";
    else if (adxVal >= 15 && bullishStack) trendLabel = "Weak Uptrend";
    else if (adxVal >= 15 && bearishStack) trendLabel = "Weak Downtrend";
    else if (adxVal < 18) trendLabel = "Range";
  }

  // Breakout: strong directional close outside recent N-bar high/low with volume expansion.
  const lookback = 20;
  const recentHigh = Math.max(...candles.slice(Math.max(0, last - lookback), last).map((c) => c.h));
  const recentLow = Math.min(...candles.slice(Math.max(0, last - lookback), last).map((c) => c.l));
  let structureLabel = null;
  if (price > recentHigh) structureLabel = "Breakout";
  else if (price < recentLow) structureLabel = "Breakout"; // breakdown, still "breakout" regime family

  const regime = structureLabel || trendLabel;

  return {
    regime,
    trendLabel,
    volatilityState,
    compression: volatilityState === "compression",
    expansion: volatilityState === "expansion",
    adx: adxVal,
    atrPctOfPrice,
    details: {
      plusDI,
      minusDI,
      ema20,
      ema50,
      recentHigh,
      recentLow,
    },
  };
}

/** Maps a regime to which strategy categories are worth evaluating (used by the scanner to prune work). */
export function regimeToStrategyCategories(regimeResult) {
  const { regime, compression } = regimeResult;
  const categories = new Set();
  if (regime.includes("Uptrend") || regime.includes("Downtrend")) categories.add("trend_pullback");
  if (regime === "Breakout") categories.add("breakout");
  if (regime === "Range") categories.add("range_reversal");
  if (compression) categories.add("compression_expansion");
  categories.add("vwap"); // VWAP strategies are regime-agnostic confirmation-based setups
  return [...categories];
}
