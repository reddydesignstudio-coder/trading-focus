import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgainstCandles, computeTradeOutcome } from "../js/tradeResolution.js";

function candle(t, o, h, l, c) {
  return { t, o, h, l, c };
}

test("TP hit first resolves WIN for a long", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: 110 };
  const candles = [candle(1, 101, 105, 99, 104), candle(2, 104, 112, 103, 111)];
  const res = resolveAgainstCandles(trade, candles);
  assert.equal(res.status, "WIN");
});

test("SL hit first resolves LOSS for a long", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: 110 };
  const candles = [candle(1, 99, 100, 94, 96)];
  const res = resolveAgainstCandles(trade, candles);
  assert.equal(res.status, "LOSS");
});

test("neither hit resolves OPEN", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: 110 };
  const candles = [candle(1, 100, 102, 99, 101)];
  const res = resolveAgainstCandles(trade, candles);
  assert.equal(res.status, "OPEN");
});

test("same-candle TP+SL with no finer data is AMBIGUOUS, never guessed", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: 110 };
  const candles = [candle(1, 100, 112, 90, 105)]; // touches both SL(95) and TP(110) in one bar
  const res = resolveAgainstCandles(trade, candles);
  assert.equal(res.status, "AMBIGUOUS");
});

test("same-candle ambiguity resolved via smaller timeframe when available", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: 110 };
  const bigCandle = candle(0, 100, 112, 90, 105);
  const candles = [bigCandle];
  // finer bars show SL was touched before TP within the same big candle's window
  const finer = [
    candle(0, 100, 101, 99, 100),
    candle(100, 100, 100, 94, 95), // SL hit here first
    candle(200, 95, 112, 95, 108), // TP hit after
  ];
  const res = resolveAgainstCandles(trade, candles, { smallerTimeframeCandles: finer });
  assert.equal(res.status, "LOSS");
  assert.equal(res.resolvedVia, "smaller_timeframe");
});

test("short trade resolution uses inverted TP/SL logic", () => {
  const trade = { direction: "short", entryPrice: 100, stopLoss: 105, takeProfit: 90 };
  const candles = [candle(1, 99, 101, 88, 91)]; // low touches TP(90)
  const res = resolveAgainstCandles(trade, candles);
  assert.equal(res.status, "WIN");
});

test("computeTradeOutcome returns correct pnl and R multiple for a WIN", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, positionSize: 4 }; // risk = 5/unit, 4 units => $20 risk
  const resolution = { status: "WIN", exitPrice: 110, resolvedAt: 12345 };
  const outcome = computeTradeOutcome(trade, resolution);
  assert.equal(outcome.pnl, 40); // (110-100)*4
  assert.equal(outcome.rMultiple, 2); // 10 profit / 5 risk = 2R
});

test("computeTradeOutcome returns null pnl/R for OPEN/AMBIGUOUS", () => {
  const trade = { direction: "long", entryPrice: 100, stopLoss: 95, positionSize: 4 };
  const outcome = computeTradeOutcome(trade, { status: "AMBIGUOUS" });
  assert.equal(outcome.pnl, null);
  assert.equal(outcome.rMultiple, null);
});
