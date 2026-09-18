// js/dataProviders/demo.js
//
// DEMO MODE data provider.
// --------------------------------------------------------------
// Generates DETERMINISTIC (seeded) pseudo-random OHLCV candles so
// the UI can be exercised end-to-end without a network connection.
// This is explicitly and permanently isolated from the real-data
// path: every candle set returned here carries `isDemo: true` and
// `status: "DEMO"`, and the app must never let a DEMO result feed
// Live Mode paper trading or the real performance/journal stores.

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export const demoProvider = {
  id: "demo",
  name: "Demo Data (offline, deterministic)",
  requiresKey: false,
  markets: ["us_stocks", "forex", "crypto"],

  async getCandles({ symbol, market, timeframe, limit = 200 }) {
    const seed = seedFromString(`${symbol}|${market}|${timeframe}`);
    const rand = mulberry32(seed);
    const basePrice = market === "forex" ? 1 + rand() * 0.5 : market === "crypto" ? 100 + rand() * 40000 : 20 + rand() * 400;
    const tfMs = timeframeToMs(timeframe);
    const now = Date.now();
    const candles = [];
    let price = basePrice;
    let trendBias = rand() > 0.5 ? 1 : -1;
    for (let i = limit - 1; i >= 0; i--) {
      const t = now - i * tfMs;
      const vol = basePrice * (0.003 + rand() * 0.006);
      const drift = trendBias * vol * 0.15 * (rand() > 0.85 ? -1 : 1); // occasional counter-trend bar
      const o = price;
      const c = Math.max(0.0001, o + drift + (rand() - 0.5) * vol);
      const h = Math.max(o, c) + rand() * vol * 0.6;
      const l = Math.min(o, c) - rand() * vol * 0.6;
      const v = Math.round(1000 + rand() * 9000);
      candles.push({ t, o, h, l, c, v });
      price = c;
      if (i % 40 === 0) trendBias = rand() > 0.5 ? 1 : -1;
    }
    return {
      candles,
      status: "DEMO",
      isDemo: true,
      asOf: new Date(),
      source: "demo",
      symbol,
      market,
      timeframe,
    };
  },

  async searchSymbols(query, market) {
    const catalog = {
      us_stocks: ["AAPL", "MSFT", "NVDA", "TSLA", "AMD", "AMZN", "META", "GOOGL", "SPY", "QQQ"],
      forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "NZDUSD", "EURGBP"],
      crypto: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT"],
    };
    const list = catalog[market] || [];
    return list.filter((s) => s.toLowerCase().includes((query || "").toLowerCase())).map((s) => ({ symbol: s, name: s }));
  },
};

function timeframeToMs(tf) {
  const map = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
  return map[tf] || 900000;
}
