// js/structure.js
//
// Market Structure Engine
// --------------------------------------------------------------
// Detects swing highs/lows, classifies them (HH/HL/LH/LL), derives
// support/resistance levels from swing clusters, and flags a Break
// of Structure (BOS) when price closes beyond the most recent
// relevant swing.

/** Fractal-style swing detection: a bar is a swing high/low if it's the extreme of `wing` bars on each side. */
export function findSwings(candles, wing = 3) {
  const swings = [];
  for (let i = wing; i < candles.length - wing; i++) {
    const slice = candles.slice(i - wing, i + wing + 1);
    const isHigh = slice.every((c) => c.h <= candles[i].h) && slice.some((c) => c !== candles[i]);
    const isLow = slice.every((c) => c.l >= candles[i].l) && slice.some((c) => c !== candles[i]);
    if (isHigh) swings.push({ index: i, type: "high", price: candles[i].h, t: candles[i].t });
    if (isLow) swings.push({ index: i, type: "low", price: candles[i].l, t: candles[i].t });
  }
  return swings;
}

/** Labels each swing high as HH/LH relative to the prior swing high, and each swing low as HL/LL. */
export function classifySwings(swings) {
  let lastHigh = null;
  let lastLow = null;
  return swings.map((s) => {
    if (s.type === "high") {
      const label = lastHigh === null ? "H" : s.price > lastHigh.price ? "HH" : "LH";
      lastHigh = s;
      return { ...s, label };
    } else {
      const label = lastLow === null ? "L" : s.price > lastLow.price ? "HL" : "LL";
      lastLow = s;
      return { ...s, label };
    }
  });
}

/** Determines overall trend structure from the most recent labeled swings. */
export function trendFromSwings(classified) {
  const recent = classified.slice(-6);
  const highs = recent.filter((s) => s.type === "high").map((s) => s.label);
  const lows = recent.filter((s) => s.type === "low").map((s) => s.label);
  const higherHighs = highs.filter((l) => l === "HH").length;
  const higherLows = lows.filter((l) => l === "HL").length;
  const lowerHighs = highs.filter((l) => l === "LH").length;
  const lowerLows = lows.filter((l) => l === "LL").length;

  if (higherHighs >= 2 && higherLows >= 1 && lowerLows === 0) return "uptrend";
  if (lowerLows >= 2 && lowerHighs >= 1 && higherHighs === 0) return "downtrend";
  if (higherHighs > 0 && lowerLows > 0) return "mixed";
  return "range";
}

/** Clusters swing prices into support/resistance zones using a tolerance band (% of price). */
export function findSupportResistance(swings, currentPrice, tolerancePct = 0.15) {
  const tol = currentPrice * (tolerancePct / 100);
  const clusters = [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  for (const s of sorted) {
    const cluster = clusters.find((c) => Math.abs(c.price - s.price) <= tol);
    if (cluster) {
      cluster.touches += 1;
      cluster.price = (cluster.price * (cluster.touches - 1) + s.price) / cluster.touches;
      cluster.lastIndex = Math.max(cluster.lastIndex, s.index);
    } else {
      clusters.push({ price: s.price, touches: 1, type: s.type, lastIndex: s.index });
    }
  }
  const levels = clusters
    .filter((c) => c.touches >= 2) // require at least 2 touches to call it a real level
    .map((c) => ({
      price: c.price,
      touches: c.touches,
      side: c.price >= currentPrice ? "resistance" : "support",
    }))
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return levels;
}

/**
 * Break of Structure: true if the latest close breaks beyond the most
 * recent opposite-side swing that defined the prior trend leg.
 */
export function detectBreakOfStructure(candles, classified) {
  if (classified.length < 2) return { bos: false };
  const lastClose = candles[candles.length - 1].c;
  const highs = classified.filter((s) => s.type === "high");
  const lows = classified.filter((s) => s.type === "low");
  const lastSwingHigh = highs[highs.length - 1];
  const lastSwingLow = lows[lows.length - 1];

  if (lastSwingHigh && lastClose > lastSwingHigh.price) {
    return { bos: true, direction: "bullish", level: lastSwingHigh.price };
  }
  if (lastSwingLow && lastClose < lastSwingLow.price) {
    return { bos: true, direction: "bearish", level: lastSwingLow.price };
  }
  return { bos: false };
}

export function analyzeStructure(candles, wing = 3) {
  const swings = findSwings(candles, wing);
  const classified = classifySwings(swings);
  const trend = trendFromSwings(classified);
  const currentPrice = candles[candles.length - 1]?.c;
  const levels = findSupportResistance(swings, currentPrice);
  const bos = detectBreakOfStructure(candles, classified);
  return { swings: classified, trend, levels, bos };
}
