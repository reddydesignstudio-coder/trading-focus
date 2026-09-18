// js/indicators.js
//
// Technical Analysis Engine
// --------------------------------------------------------------
// Pure functions over OHLCV candle arrays. A "candle" is:
//   { t: <epoch ms>, o, h, l, c, v }
// All functions are side-effect-free and return arrays aligned to
// the input (padded with `null` where a value cannot yet be
// computed) so callers can zip them with the candle array by index.

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // seed with SMA of first `period` values
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    const val = values[i] * k + prev * (1 - k);
    out[i] = val;
    prev = val;
  }
  return out;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out[i] = s / period;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = rsiFromAvg(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAvg(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAvg(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => (emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null));
  // signal = EMA of macdLine, but only over the non-null tail
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signal = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const tail = macdLine.slice(firstValid).map((v) => v);
    const sig = ema(tail, signalPeriod);
    sig.forEach((v, idx) => (signal[firstValid + idx] = v));
  }
  const histogram = closes.map((_, i) => (macdLine[i] !== null && signal[i] !== null ? macdLine[i] - signal[i] : null));
  return { macdLine, signal, histogram };
}

export function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prevClose = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  });
}

export function atr(candles, period = 14) {
  const tr = trueRange(candles);
  return ema(tr, period).map((v, i) => (i < period - 1 ? null : v));
}

/** Average Directional Index (Wilder's DMI/ADX). */
export function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = trueRange(candles);
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].h - candles[i - 1].h;
    const downMove = candles[i - 1].l - candles[i].l;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  const smoothedTR = wilderSmooth(tr, period);
  const smoothedPlusDM = wilderSmooth(plusDM, period);
  const smoothedMinusDM = wilderSmooth(minusDM, period);
  const plusDI = smoothedTR.map((t, i) => (t && smoothedPlusDM[i] !== null ? (100 * smoothedPlusDM[i]) / t : null));
  const minusDI = smoothedTR.map((t, i) => (t && smoothedMinusDM[i] !== null ? (100 * smoothedMinusDM[i]) / t : null));
  const dx = plusDI.map((p, i) =>
    p !== null && minusDI[i] !== null && p + minusDI[i] !== 0 ? (100 * Math.abs(p - minusDI[i])) / (p + minusDI[i]) : null
  );
  // ADX is Wilder's MOVING AVERAGE of DX over `period` — distinct from the
  // sum-style smoothing used for TR/DM above. Averaging (not accumulating)
  // is what keeps ADX bounded to 0-100.
  const adxLine = wilderAverage(dx, period);
  return { adx: adxLine, plusDI, minusDI };
}

/** Wilder's moving average: seeded with a simple average of the first `period` valid values, then smoothed. */
function wilderAverage(values, period) {
  const out = new Array(values.length).fill(null);
  const firstValid = values.findIndex((v) => v !== null);
  if (firstValid === -1 || values.length - firstValid < period) return out;
  const seedEnd = firstValid + period;
  let seed = 0;
  for (let i = firstValid; i < seedEnd; i++) seed += values[i] ?? 0;
  seed /= period;
  out[seedEnd - 1] = seed;
  let prev = seed;
  for (let i = seedEnd; i < values.length; i++) {
    const v = values[i] ?? prev;
    const next = (prev * (period - 1) + v) / period;
    out[i] = next;
    prev = next;
  }
  return out;
}

function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum;
  for (let i = period; i < values.length; i++) {
    out[i] = out[i - 1] - out[i - 1] / period + values[i];
  }
  return out;
}

/** Session VWAP — resets at the start of each session/day boundary provided via `sessionKeys` (parallel array). */
export function sessionVWAP(candles, sessionKeys) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let currentKey = null;
  for (let i = 0; i < candles.length; i++) {
    const key = sessionKeys ? sessionKeys[i] : "all";
    if (key !== currentKey) {
      currentKey = key;
      cumPV = 0;
      cumV = 0;
    }
    const typicalPrice = (candles[i].h + candles[i].l + candles[i].c) / 3;
    cumPV += typicalPrice * candles[i].v;
    cumV += candles[i].v;
    out[i] = cumV > 0 ? cumPV / cumV : candles[i].c;
  }
  return out;
}

/** Relative Volume: current volume vs. average volume for the same bar-of-day over `lookbackDays`. Falls back to a rolling average if bar-of-day alignment isn't available. */
export function rvol(volumes, period = 20) {
  const out = new Array(volumes.length).fill(null);
  for (let i = period; i < volumes.length; i++) {
    const window = volumes.slice(i - period, i);
    const avg = window.reduce((a, b) => a + b, 0) / period;
    out[i] = avg > 0 ? volumes[i] / avg : null;
  }
  return out;
}

/** Simple realized volatility proxy: stdev of % returns over `period`, annualization omitted (intraday relative use only). */
export function realizedVolatility(closes, period = 20) {
  const out = new Array(closes.length).fill(null);
  const returns = closes.map((c, i) => (i === 0 ? null : (c - closes[i - 1]) / closes[i - 1]));
  for (let i = period; i < closes.length; i++) {
    const window = returns.slice(i - period + 1, i + 1).filter((v) => v !== null);
    const m = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - m) ** 2, 0) / window.length;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

/** Bundles all indicators the strategy/confirmation/confidence engines need, aligned by index. */
export function computeIndicatorSet(candles, sessionKeys = null) {
  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => c.v);
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(candles, 14),
    adx14: adx(candles, 14),
    vwap: sessionVWAP(candles, sessionKeys),
    rvol20: rvol(volumes, 20),
    volatility20: realizedVolatility(closes, 20),
  };
}
