// js/dataProviders/twelveData.js
//
// Twelve Data REST API — used for US STOCKS and FOREX.
// Free tier requires an API key. SECURITY: the key is never
// hardcoded in source. It is entered by the user in Settings and
// stored only in the browser's IndexedDB (settings store), read at
// call time. Anyone deploying this app supplies their OWN free key.
//
// Free-tier limitations (documented, not hidden from the user):
//  - ~8 requests/minute, 800/day (subject to change by the provider)
//  - Intraday data on the free tier may be end-of-day delayed for
//    some symbol classes; treat as DELAYED unless the user's plan
//    entitles real-time data. We never claim LIVE for this provider.

const BASE_URL = "https://api.twelvedata.com";

const INTERVAL_MAP = { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day" };

/**
 * Twelve Data requires forex (and crypto, on their platform) symbols in
 * BASE/QUOTE slash format — "EUR/USD", not "EURUSD" — per their own
 * documentation. This app's internal symbol format is always the plain
 * 6-character form (matching every other provider), so it needs
 * converting here, at the one place that actually needs it, rather than
 * changing the shared internal format everywhere.
 */
export function toTwelveDataSymbol(symbol, market) {
  if (market !== "forex" || symbol.includes("/")) return symbol;
  return `${symbol.slice(0, 3)}/${symbol.slice(3, 6)}`;
}

export const twelveDataProvider = {
  id: "twelvedata",
  name: "Twelve Data",
  requiresKey: true,
  keyLabel: "Twelve Data API Key",
  signupUrl: "https://twelvedata.com/pricing",
  markets: ["us_stocks", "forex"],

  async getCandles({ symbol, market, timeframe, limit = 200, apiKey, signal }) {
    if (!apiKey) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "twelvedata", reason: "NO_API_KEY" };
    }
    const interval = INTERVAL_MAP[timeframe] || "15min";
    const tdSymbol = toTwelveDataSymbol(symbol, market);
    const url = `${BASE_URL}/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${limit}&apikey=${apiKey}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    if (data.status === "error" || !data.values) {
      const code = data.code || res.status;
      return {
        candles: [],
        status: "UNAVAILABLE",
        isDemo: false,
        asOf: new Date(),
        source: "twelvedata",
        reason: code === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR",
        rawMessage: data.message,
      };
    }
    const candles = data.values
      .map((v) => ({
        t: new Date(v.datetime.replace(" ", "T")).getTime(),
        o: parseFloat(v.open),
        h: parseFloat(v.high),
        l: parseFloat(v.low),
        c: parseFloat(v.close),
        v: parseFloat(v.volume || 0),
      }))
      .sort((a, b) => a.t - b.t);

    return {
      candles,
      status: "DELAYED", // Free-tier entitlement is not verifiable client-side — always reported as delayed, never LIVE.
      isDemo: false,
      asOf: new Date(),
      source: "twelvedata",
      symbol,
      market: market || (symbol.includes("/") ? "forex" : "us_stocks"),
      timeframe,
    };
  },

  async searchSymbols(query, apiKey, signal) {
    if (!apiKey || !query) return [];
    const url = `${BASE_URL}/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${apiKey}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    return (data.data || []).slice(0, 10).map((d) => ({ symbol: d.symbol, name: d.instrument_name }));
  },
};
