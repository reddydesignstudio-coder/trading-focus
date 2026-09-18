// js/dataProviders/binance.js
//
// Binance public market-data REST API — used for CRYPTO only.
// No API key required for public market data endpoints, so there
// is no secret to protect. Subject to Binance's public rate limits
// (weight-based; we stay well under them via the shared throttle in
// dataProviders/index.js). Klines are near-real-time (typically a
// few seconds of latency) — reported to the app as "LIVE" data,
// distinct from delayed-quote providers.

const BASE_URL = "https://api.binance.com/api/v3";

const INTERVAL_MAP = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };

export const binanceProvider = {
  id: "binance",
  name: "Binance Public API",
  requiresKey: false,
  markets: ["crypto"],

  async getCandles({ symbol, timeframe, limit = 200, signal }) {
    const interval = INTERVAL_MAP[timeframe] || "15m";
    const url = `${BASE_URL}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new ProviderError(res.status, `Binance responded with HTTP ${res.status}`);
    }
    const raw = await res.json();
    const candles = raw.map((k) => ({
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[5]),
    }));
    const lastCandleAge = Date.now() - candles[candles.length - 1]?.t;
    const staleThresholdMs = timeframeToMs(timeframe) * 3;
    return {
      candles,
      status: lastCandleAge > staleThresholdMs ? "STALE" : "LIVE",
      isDemo: false,
      asOf: new Date(),
      source: "binance",
      symbol,
      market: "crypto",
      timeframe,
    };
  },

  async searchSymbols(query) {
    // Static well-known list to avoid an extra exchangeInfo call on every keystroke.
    const known = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "MATICUSDT"];
    return known.filter((s) => s.toLowerCase().includes((query || "").toLowerCase())).map((s) => ({ symbol: s, name: s }));
  },
};

export class ProviderError extends Error {
  constructor(httpStatus, message) {
    super(message);
    this.httpStatus = httpStatus;
    this.name = "ProviderError";
  }
}

function timeframeToMs(tf) {
  const map = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
  return map[tf] || 900000;
}
