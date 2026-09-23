// js/dataProviders/alphaVantage.js
//
// Alpha Vantage REST API — used for US STOCKS and FOREX.
// Free tier requires an API key. HONEST LIMITATIONS: free-tier data is
// 15-minute delayed (real-time requires a paid plan starting at
// $49.99/month), and the free tier is capped at roughly 25 requests
// PER DAY — far more restrictive than every other provider in this
// app. For that reason it's placed LAST in the provider fallback
// chain (dataProviders/index.js): worth having as a last resort, not
// worth burning through first.

const BASE_URL = "https://www.alphavantage.co/query";

const INTERVAL_MAP = { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "60min" };

export const alphaVantageProvider = {
  id: "alphavantage",
  name: "Alpha Vantage",
  requiresKey: true,
  keyLabel: "Alpha Vantage API Key",
  signupUrl: "https://www.alphavantage.co/support/#api-key",
  markets: ["us_stocks", "forex"],

  async getCandles({ symbol, market, timeframe, limit = 200, apiKey, signal }) {
    if (!apiKey) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "alphavantage", reason: "NO_API_KEY" };
    }
    const interval = INTERVAL_MAP[timeframe] || "15min";
    let url;
    let seriesKey;
    if (market === "forex") {
      const from = symbol.slice(0, 3);
      const to = symbol.slice(3, 6);
      url = `${BASE_URL}?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=${interval}&outputsize=compact&apikey=${apiKey}`;
      seriesKey = `Time Series FX (${interval})`;
    } else {
      url = `${BASE_URL}?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=compact&apikey=${apiKey}`;
      seriesKey = `Time Series (${interval})`;
    }

    const res = await fetch(url, { signal });
    const data = await res.json();

    if (data.Note || data.Information) {
      // Alpha Vantage returns HTTP 200 even when rate-limited — the limit is signalled in the body.
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "alphavantage", reason: "RATE_LIMIT" };
    }
    const series = data[seriesKey];
    if (!series) {
      return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: "alphavantage", reason: "PROVIDER_ERROR", rawMessage: data["Error Message"] };
    }

    const candles = Object.entries(series)
      .map(([datetime, row]) => ({
        t: new Date(datetime.replace(" ", "T")).getTime(),
        o: parseFloat(row["1. open"]),
        h: parseFloat(row["2. high"]),
        l: parseFloat(row["3. low"]),
        c: parseFloat(row["4. close"]),
        v: parseFloat(row["5. volume"] || 0),
      }))
      .sort((a, b) => a.t - b.t)
      .slice(-limit);

    return {
      candles,
      status: "DELAYED",
      isDemo: false,
      asOf: new Date(),
      source: "alphavantage",
      symbol,
      market,
      timeframe,
    };
  },

  async searchSymbols(query, apiKey, signal) {
    if (!apiKey || !query) return [];
    const url = `${BASE_URL}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${apiKey}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    return (data.bestMatches || []).slice(0, 10).map((d) => ({ symbol: d["1. symbol"], name: d["2. name"] }));
  },
};
