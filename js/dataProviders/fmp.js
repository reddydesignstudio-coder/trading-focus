// js/dataProviders/fmp.js
//
// Financial Modeling Prep (FMP) REST API — used for US STOCKS and FOREX.
// Free tier requires an API key. Like every other free-tier provider in
// this app, its data is reported as DELAYED, never LIVE — genuine
// real-time market data is a paid feature across this entire industry,
// not something any free API key unlocks. Added purely for redundancy
// (another provider in the fallback chain means fewer demo-mode
// fallbacks), not for speed.

const BASE_URL = "https://financialmodelingprep.com/api/v3";

const INTERVAL_MAP = { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1hour", "4h": "4hour", "1d": "1day" };

export const fmpProvider = {
  id: "fmp",
  name: "Financial Modeling Prep",
  requiresKey: true,
  keyLabel: "FMP API Key",
  signupUrl: "https://site.financialmodelingprep.com/developer/docs/pricing",
  markets: ["us_stocks", "forex"],

  async getCandles({ symbol, market, timeframe, limit = 200, apiKey, signal }) {
    if (!apiKey) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "fmp", reason: "NO_API_KEY" };
    }
    const interval = INTERVAL_MAP[timeframe] || "15min";
    // FMP forex pairs use a "EURUSD" style symbol on the same historical-chart endpoint as equities.
    const url = `${BASE_URL}/historical-chart/${interval}/${encodeURIComponent(symbol)}?apikey=${apiKey}`;
    const res = await fetch(url, { signal });
    if (res.status === 429) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "fmp", reason: "RATE_LIMIT" };
    }
    if (!res.ok) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "fmp", reason: "PROVIDER_ERROR" };
    }
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "fmp", reason: "PROVIDER_ERROR", rawMessage: data?.["Error Message"] };
    }
    // FMP returns newest-first — reverse to oldest-first, matching every other provider's contract.
    const candles = data
      .slice(0, limit)
      .map((row) => ({
        t: new Date(row.date.replace(" ", "T")).getTime(),
        o: row.open,
        h: row.high,
        l: row.low,
        c: row.close,
        v: row.volume,
      }))
      .filter((c) => Number.isFinite(c.t))
      .sort((a, b) => a.t - b.t);

    return {
      candles,
      status: "DELAYED",
      isDemo: false,
      asOf: new Date(),
      source: "fmp",
      symbol,
      market,
      timeframe,
    };
  },

  async searchSymbols(query, apiKey, signal) {
    if (!apiKey || !query) return [];
    const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}&limit=10&apikey=${apiKey}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map((d) => ({ symbol: d.symbol, name: d.name }));
  },
};
