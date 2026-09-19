import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, sma, rsi, macd, atr, adx, sessionVWAP, rvol, estimatePaceMs } from "../js/indicators.js";

function makeCandles(closes, high = null, low = null, vols = null) {
  return closes.map((c, i) => ({
    t: i * 900000,
    o: i === 0 ? c : closes[i - 1],
    h: high ? high[i] : c + 0.5,
    l: low ? low[i] : c - 0.5,
    c,
    v: vols ? vols[i] : 1000,
  }));
}

test("sma matches manual average", () => {
  const vals = [1, 2, 3, 4, 5];
  const out = sma(vals, 3);
  assert.equal(out[2], 2); // (1+2+3)/3
  assert.equal(out[4], 4); // (3+4+5)/3
  assert.equal(out[0], null);
});

test("ema seeds with SMA and reacts to trend", () => {
  const vals = Array.from({ length: 30 }, (_, i) => 100 + i); // steady uptrend
  const out = ema(vals, 10);
  assert.equal(out[8], null);
  assert.ok(out[9] !== null);
  // EMA should be below the very latest (rising) value but trending up
  assert.ok(out[29] < vals[29]);
  assert.ok(out[29] > out[20]);
});

test("rsi returns 100 when there are no losses", () => {
  const vals = Array.from({ length: 20 }, (_, i) => 100 + i); // always up
  const out = rsi(vals, 14);
  assert.equal(out[14], 100);
});

test("rsi returns 0 when there are no gains", () => {
  const vals = Array.from({ length: 20 }, (_, i) => 100 - i); // always down
  const out = rsi(vals, 14);
  assert.equal(out[14], 0);
});

test("rsi is bounded between 0 and 100 for mixed data", () => {
  const vals = [100, 102, 101, 105, 103, 108, 107, 110, 106, 112, 111, 115, 109, 118, 120, 117];
  const out = rsi(vals, 14);
  out.filter((v) => v !== null).forEach((v) => {
    assert.ok(v >= 0 && v <= 100);
  });
});

test("macd histogram is the difference between macd line and signal", () => {
  const vals = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2);
  const { macdLine, signal, histogram } = macd(vals);
  for (let i = 0; i < vals.length; i++) {
    if (macdLine[i] !== null && signal[i] !== null) {
      assert.ok(Math.abs(histogram[i] - (macdLine[i] - signal[i])) < 1e-9);
    }
  }
});

test("atr is non-negative and null before period fills", () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i));
  const candles = makeCandles(closes);
  const out = atr(candles, 14);
  assert.equal(out[12], null);
  out.filter((v) => v !== null).forEach((v) => assert.ok(v >= 0));
});

test("adx produces values between 0 and 100 once seeded", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 2);
  const candles = makeCandles(closes);
  const { adx: adxLine } = adx(candles, 14);
  adxLine.filter((v) => v !== null).forEach((v) => assert.ok(v >= 0 && v <= 100));
});

test("sessionVWAP resets at session boundary", () => {
  const closes = [10, 11, 12, 20, 21, 22];
  const vols = [100, 100, 100, 100, 100, 100];
  const candles = makeCandles(closes, null, null, vols);
  const sessionKeys = ["d1", "d1", "d1", "d2", "d2", "d2"];
  const out = sessionVWAP(candles, sessionKeys);
  // second session VWAP should be near 20-22 range, not pulled down by day 1
  assert.ok(out[5] > 19 && out[5] < 23);
});

test("rvol flags volume spikes correctly", () => {
  const vols = Array(25).fill(1000);
  vols[24] = 3000; // 3x spike on the last bar
  const closes = Array(25).fill(50);
  const out = rvol(vols, 20);
  assert.ok(out[24] > 2.5);
});

test("estimatePaceMs converts distance/ATR into a bars-based time estimate", () => {
  // distance 10, ATR 2/bar -> 5 bars; 15m bars -> 5 * 900000ms = 4,500,000ms (1h 15m)
  const result = estimatePaceMs(10, 2, 900000);
  assert.equal(result, 4500000);
});

test("estimatePaceMs returns null when ATR is zero, missing, or distance is unavailable", () => {
  assert.equal(estimatePaceMs(10, 0, 900000), null);
  assert.equal(estimatePaceMs(10, null, 900000), null);
  assert.equal(estimatePaceMs(null, 2, 900000), null);
  assert.equal(estimatePaceMs(10, 2, null), null);
});

test("estimatePaceMs scales linearly with distance", () => {
  const near = estimatePaceMs(5, 1, 3600000);
  const far = estimatePaceMs(20, 1, 3600000);
  assert.equal(far, near * 4);
});
