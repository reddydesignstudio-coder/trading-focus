// js/dataProviders/finnhub.js
//
// Finnhub REST API — used for US STOCKS and FOREX.
// Free tier requires an API key. HONEST LIMITATIONS (verified, not
// assumed):
//  - Free-tier data is delayed (reported by Finnhub users as roughly
//    15-20 minutes) — never reported to the app as LIVE.
//  - As of Finnhub's current free-tier terms, the `/stock/candle`
//    endpoint (US equities OHLCV) has been moved to paid tiers and
//    returns an error on free keys. This provider still tries it —
//    if your key doesn't have access, the shared abstraction layer
//    in dataProviders/index.js automatically falls through to the
//    next configured provider rather than failing the scan outright.
//  - Forex candles remain available on the free tier at the time of
//    writing.
//  - Rate limit: 60 requests/minute on the free tier — much more
//    generous than Twelve Data's free tier, which is the main reason
//    to add it: fewer demo-mode fallbacks, not faster data.

const BASE_URL = "https://finnhub.io/api/v1";

const RESOLUTION_MAP = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const TIMEFRAME_SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

function toFinnhubSymbol(symbol, market) {
  if (market === "forex") {
    // Finnhub forex symbols look like "OANDA:EUR_USD" — accept a plain "EURUSD" and convert.
    if (symbol.includes(":")) return symbol;
    const base = symbol.slice(0, 3);
    const quote = symbol.slice(3, 6);
    return `OANDA:${base}_${quote}`;
  }
  return symbol;
}

export const finnhubProvider = {
  id: "finnhub",
  name: "Finnhub",
  requiresKey: true,
  keyLabel: "Finnhub API Key",
  signupUrl: "https://finnhub.io/register",
  markets: ["us_stocks", "forex"],

  async getCandles({ symbol, market, timeframe, limit = 200, apiKey, signal }) {
    if (!apiKey) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "finnhub", reason: "NO_API_KEY" };
    }
    const resolution = RESOLUTION_MAP[timeframe] || "15";
    const seconds = TIMEFRAME_SECONDS[timeframe] || 900;
    const to = Math.floor(Date.now() / 1000);
    const from = to - seconds * limit;
    const finnhubSymbol = toFinnhubSymbol(symbol, market);
    const url = `${BASE_URL}/stock/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`;
    const endpoint = market === "forex" ? `${BASE_URL}/forex/candle?symbol=${encodeURIComponent(finnhubSymbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}` : url;

    const res = await fetch(endpoint, { signal });
    if (res.status === 429) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "finnhub", reason: "RATE_LIMIT" };
    }
    if (res.status === 403 || res.status === 401) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "finnhub", reason: "PROVIDER_ERROR", rawMessage: "This endpoint isn't included in your Finnhub free-tier key." };
    }
    if (!res.ok) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "finnhub", reason: "PROVIDER_ERROR" };
    }
    const data = await res.json();
    if (data.s !== "ok" || !Array.isArray(data.t) || !data.t.length) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "finnhub", reason: "PROVIDER_ERROR", rawMessage: data.s };
    }
    const candles = data.t.map((t, i) => ({
      t: t * 1000,
      o: data.o[i],
      h: data.h[i],
      l: data.l[i],
      c: data.c[i],
      v: data.v[i],
    }));

    return {
      candles,
      status: "DELAYED", // free-tier entitlement isn't verifiable client-side — always reported as delayed, never LIVE.
      isDemo: false,
      asOf: new Date(),
      source: "finnhub",
      symbol,
      market,
      timeframe,
    };
  },

  async searchSymbols(query, apiKey, signal) {
    if (!apiKey || !query) return [];
    const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&token=${apiKey}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    return (data.result || []).slice(0, 10).map((d) => ({ symbol: d.symbol, name: d.description }));
  },
};
