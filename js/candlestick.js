// js/candlestick.js
//
// Candlestick Engine
// --------------------------------------------------------------
// IMPORTANT: these patterns are CONFIRMATION signals only. The
// scanner/strategy engine must never open a trade from a
// candlestick pattern alone (see confirmation.js / strategies/*).

function body(c) {
  return Math.abs(c.c - c.o);
}
function range(c) {
  return c.h - c.l || 1e-9;
}
function upperWick(c) {
  return c.h - Math.max(c.o, c.c);
}
function lowerWick(c) {
  return Math.min(c.o, c.c) - c.l;
}
function isBullish(c) {
  return c.c > c.o;
}
function isBearish(c) {
  return c.c < c.o;
}

const detectors = {
  bullishEngulfing: (candles, i) => {
    if (i < 1) return false;
    const [a, b] = [candles[i - 1], candles[i]];
    return isBearish(a) && isBullish(b) && b.c >= a.o && b.o <= a.c && body(b) > body(a);
  },
  bearishEngulfing: (candles, i) => {
    if (i < 1) return false;
    const [a, b] = [candles[i - 1], candles[i]];
    return isBullish(a) && isBearish(b) && b.o >= a.c && b.c <= a.o && body(b) > body(a);
  },
  hammer: (candles, i) => {
    const c = candles[i];
    return lowerWick(c) >= body(c) * 2 && upperWick(c) <= body(c) * 0.6 && body(c) / range(c) < 0.4;
  },
  bullishPinBar: (candles, i) => {
    const c = candles[i];
    return lowerWick(c) >= range(c) * 0.55 && upperWick(c) <= range(c) * 0.2;
  },
  shootingStar: (candles, i) => {
    const c = candles[i];
    return upperWick(c) >= body(c) * 2 && lowerWick(c) <= body(c) * 0.6 && body(c) / range(c) < 0.4;
  },
  bearishPinBar: (candles, i) => {
    const c = candles[i];
    return upperWick(c) >= range(c) * 0.55 && lowerWick(c) <= range(c) * 0.2;
  },
  morningStar: (candles, i) => {
    if (i < 2) return false;
    const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
    return isBearish(a) && body(b) / range(b) < 0.3 && isBullish(c) && c.c > (a.o + a.c) / 2;
  },
  eveningStar: (candles, i) => {
    if (i < 2) return false;
    const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
    return isBullish(a) && body(b) / range(b) < 0.3 && isBearish(c) && c.c < (a.o + a.c) / 2;
  },
  piercingPattern: (candles, i) => {
    if (i < 1) return false;
    const [a, b] = [candles[i - 1], candles[i]];
    return isBearish(a) && isBullish(b) && b.o < a.l && b.c > (a.o + a.c) / 2 && b.c < a.o;
  },
  darkCloudCover: (candles, i) => {
    if (i < 1) return false;
    const [a, b] = [candles[i - 1], candles[i]];
    return isBullish(a) && isBearish(b) && b.o > a.h && b.c < (a.o + a.c) / 2 && b.c > a.o;
  },
  insideBar: (candles, i) => {
    if (i < 1) return false;
    const [a, b] = [candles[i - 1], candles[i]];
    return b.h <= a.h && b.l >= a.l;
  },
};

const BULLISH = ["bullishEngulfing", "hammer", "morningStar", "piercingPattern", "bullishPinBar"];
const BEARISH = ["bearishEngulfing", "shootingStar", "eveningStar", "darkCloudCover", "bearishPinBar"];
const CONTINUATION = ["insideBar"];

/** Returns all patterns detected at the last candle index. */
export function detectPatternsAt(candles, i = candles.length - 1) {
  const found = [];
  for (const [name, fn] of Object.entries(detectors)) {
    try {
      if (fn(candles, i)) {
        found.push({
          name,
          category: BULLISH.includes(name) ? "bullish" : BEARISH.includes(name) ? "bearish" : "continuation",
        });
      }
    } catch {
      /* insufficient history for this detector — skip */
    }
  }
  return found;
}

export const PATTERN_LIST = { bullish: BULLISH, bearish: BEARISH, continuation: CONTINUATION };
