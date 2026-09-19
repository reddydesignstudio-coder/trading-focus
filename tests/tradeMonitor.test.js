import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeIndexedDB } from "./helpers/fakeIndexedDB.js";
import { _resetForTests, put, getAll } from "../js/db.js";
import { checkAndResolveOpenTrades } from "../js/paperTrading.js";

function fakeState() {
  return { settings: { apiKeys: {}, dataProviderOverride: {} } };
}

function binanceKlines(closes) {
  // [openTime, open, high, low, close, volume, ...] — matches binance.js's expected shape
  return closes.map((c, i) => [
    Date.UTC(2026, 0, 1) + i * 3600000,
    String(c.o),
    String(c.h),
    String(c.l),
    String(c.c),
    "1000",
  ]);
}

function stubFetch(klines) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => klines,
  });
  return () => {
    globalThis.fetch = original;
  };
}

test("an OPEN trade whose price has since hit TP is resolved to WIN, not left OPEN forever", async () => {
  installFakeIndexedDB();
  _resetForTests();

  const trade = {
    id: "trade_1",
    signalId: "sig_1",
    mode: "test",
    dateKey: "2026-01-01",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
    symbol: "BTCUSDT",
    market: "crypto",
    direction: "long",
    strategyName: "Trend Pullback",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    positionSize: 4, // risk = 5/unit * 4 = $20
    dollarRisk: 20,
    potentialReward: 40,
    status: "OPEN",
    pnl: null,
    rMultiple: null,
    resolvedAt: null,
  };
  await put("trades", trade);

  // Candles after entry: price climbs and clears TP (110) on the 3rd bar, never touching SL.
  const klines = binanceKlines([
    { o: 100, h: 103, l: 99, c: 102 },
    { o: 102, h: 107, l: 101, c: 106 },
    { o: 106, h: 112, l: 105, c: 111 }, // high 112 clears TP of 110
  ]);
  const restoreFetch = stubFetch(klines);

  try {
    const result = await checkAndResolveOpenTrades(fakeState());
    assert.equal(result.checked, 1);
    assert.equal(result.resolved, 1);

    const trades = await getAll("trades");
    const updated = trades.find((t) => t.id === "trade_1");
    assert.equal(updated.status, "WIN");
    assert.equal(updated.pnl, 40); // (110-100) * 4
    assert.equal(updated.rMultiple, 2);
    assert.ok(updated.resolvedAt);
  } finally {
    restoreFetch();
  }
});

test("an OPEN trade whose price has since hit SL is resolved to LOSS", async () => {
  installFakeIndexedDB();
  _resetForTests();

  const trade = {
    id: "trade_2",
    mode: "test",
    dateKey: "2026-01-01",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
    symbol: "ETHUSDT",
    market: "crypto",
    direction: "long",
    strategyName: "Trend Pullback",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    positionSize: 4,
    dollarRisk: 20,
    potentialReward: 40,
    status: "OPEN",
    pnl: null,
    rMultiple: null,
    resolvedAt: null,
  };
  await put("trades", trade);

  const klines = binanceKlines([
    { o: 100, h: 101, l: 98, c: 99 },
    { o: 99, h: 100, l: 94, c: 95 }, // low 94 breaches SL of 95
  ]);
  const restoreFetch = stubFetch(klines);

  try {
    const result = await checkAndResolveOpenTrades(fakeState());
    assert.equal(result.resolved, 1);
    const trades = await getAll("trades");
    const updated = trades.find((t) => t.id === "trade_2");
    assert.equal(updated.status, "LOSS");
    assert.equal(updated.pnl, -20); // (100-95) risk realized in full: (95-100)*4
  } finally {
    restoreFetch();
  }
});

test("a genuinely still-open trade (neither TP nor SL touched) is left OPEN, not guessed", async () => {
  installFakeIndexedDB();
  _resetForTests();

  const trade = {
    id: "trade_3",
    mode: "test",
    dateKey: "2026-01-01",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
    symbol: "SOLUSDT",
    market: "crypto",
    direction: "long",
    strategyName: "Trend Pullback",
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    positionSize: 4,
    dollarRisk: 20,
    potentialReward: 40,
    status: "OPEN",
    pnl: null,
    rMultiple: null,
    resolvedAt: null,
  };
  await put("trades", trade);

  const klines = binanceKlines([
    { o: 100, h: 103, l: 99, c: 101 },
    { o: 101, h: 104, l: 100, c: 102 }, // drifting up, nowhere near TP(110) or SL(95)
  ]);
  const restoreFetch = stubFetch(klines);

  try {
    const result = await checkAndResolveOpenTrades(fakeState());
    assert.equal(result.resolved, 0);
    const trades = await getAll("trades");
    const updated = trades.find((t) => t.id === "trade_3");
    assert.equal(updated.status, "OPEN");
    assert.equal(updated.pnl, null);
  } finally {
    restoreFetch();
  }
});
