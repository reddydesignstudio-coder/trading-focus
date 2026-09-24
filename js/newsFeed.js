// js/newsFeed.js
//
// Market News
// --------------------------------------------------------------
// Pulls raw, factual news headlines from Finnhub's free news endpoint.
// Deliberately does nothing beyond that — no sentiment scoring, no "this
// headline means buy/sell X," no inferred trade ideas. Headlines are
// shown as-is with their source and time, exactly like a news
// aggregator would, because turning news into trade picks would be a
// market prediction this app is built to never fake.
//
// What IS included: detecting which company a headline is actually
// ABOUT — a factual text match ("this headline mentions Apple" -> AAPL),
// not a judgment about what that headline means for the stock. The
// person still decides what to do with that; this just saves them
// reading every headline to spot the company name themselves.

const BASE_URL = "https://finnhub.io/api/v1";

// Deliberately limited to well-known, unambiguous large-cap names — the
// kind that show up constantly in general market news. Not exhaustive,
// and not meant to be: a false miss just means no tag shown, which is
// safe; the risk to avoid is false/ambiguous matches (e.g. a common
// word coinciding with a lesser-known ticker), not incompleteness.
const KNOWN_COMPANIES = {
  AAPL: ["Apple"],
  MSFT: ["Microsoft"],
  GOOGL: ["Google", "Alphabet"],
  AMZN: ["Amazon"],
  NVDA: ["Nvidia"],
  META: ["Meta Platforms", "Facebook"],
  TSLA: ["Tesla"],
  NFLX: ["Netflix"],
  AMD: ["Advanced Micro Devices", "AMD"],
  INTC: ["Intel"],
  JPM: ["JPMorgan", "JP Morgan"],
  BAC: ["Bank of America"],
  GS: ["Goldman Sachs"],
  WMT: ["Walmart"],
  DIS: ["Walt Disney", "Disney"],
  BA: ["Boeing"],
  V: ["Visa Inc"],
  MA: ["Mastercard"],
  PYPL: ["PayPal"],
  UBER: ["Uber"],
  COIN: ["Coinbase"],
  PLTR: ["Palantir"],
  SNAP: ["Snapchat", "Snap Inc"],
  ORCL: ["Oracle"],
  CRM: ["Salesforce"],
  ADBE: ["Adobe"],
  QCOM: ["Qualcomm"],
  BABA: ["Alibaba"],
  XOM: ["Exxon Mobil", "ExxonMobil"],
  CVX: ["Chevron"],
  PFE: ["Pfizer"],
  KO: ["Coca-Cola", "Coca Cola"],
  PEP: ["PepsiCo", "Pepsi"],
  NKE: ["Nike"],
  MCD: ["McDonald's", "McDonalds"],
  SBUX: ["Starbucks"],
  T: ["AT&T"],
  VZ: ["Verizon"],
  GM: ["General Motors"],
  F: ["Ford Motor", "Ford Motors"],
};

/**
 * Factual only: which known company names appear in this text. Returns
 * tickers, not opinions about direction or significance. A headline can
 * mention a company for any reason (good news, bad news, unrelated
 * context) — this doesn't distinguish, on purpose, since doing so would
 * require the exact kind of judgment this app won't fake.
 */
export function extractMentionedSymbols(text) {
  if (!text) return [];
  const found = new Set();
  for (const [ticker, names] of Object.entries(KNOWN_COMPANIES)) {
    if (names.some((name) => text.toLowerCase().includes(name.toLowerCase()))) {
      found.add(ticker);
    }
  }
  return [...found];
}

function annotateArticles(rawArticles) {
  return rawArticles.map((a) => {
    const fromApi = (a.related || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const fromText = extractMentionedSymbols(`${a.headline} ${a.summary || ""}`);
    const mentionedSymbols = [...new Set([...fromApi, ...fromText])];
    return {
      headline: a.headline,
      source: a.source,
      url: a.url,
      datetime: new Date(a.datetime * 1000),
      mentionedSymbols,
    };
  });
}

export async function fetchMarketNews(apiKey, signal) {
  if (!apiKey) return { articles: [], available: false, reason: "NO_API_KEY" };
  try {
    const res = await fetch(`${BASE_URL}/news?category=general&token=${apiKey}`, { signal });
    if (res.status === 429) return { articles: [], available: false, reason: "RATE_LIMIT" };
    if (!res.ok) return { articles: [], available: false, reason: "PROVIDER_ERROR" };
    const data = await res.json();
    if (!Array.isArray(data)) return { articles: [], available: false, reason: "PROVIDER_ERROR" };
    return { articles: annotateArticles(data.slice(0, 15)), available: true };
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return { articles: [], available: false, reason: "PROVIDER_ERROR" };
  }
}

/**
 * Company-specific news for ONE symbol the person explicitly picked — the
 * safe alternative to having this app decide "these headlines mean trade
 * that stock." This just answers "what's been in the news about the
 * company I'm already looking at," which is factual; it does not attempt
 * to say what that news means for the price, because no one can do that
 * reliably and this app won't pretend otherwise.
 */
export async function fetchCompanyNews(symbol, apiKey, signal) {
  if (!apiKey) return { articles: [], available: false, reason: "NO_API_KEY" };
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400000); // last 7 days
  const fmt = (d) => d.toISOString().slice(0, 10);
  try {
    const res = await fetch(`${BASE_URL}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${apiKey}`, { signal });
    if (res.status === 429) return { articles: [], available: false, reason: "RATE_LIMIT" };
    if (!res.ok) return { articles: [], available: false, reason: "PROVIDER_ERROR" };
    const data = await res.json();
    if (!Array.isArray(data)) return { articles: [], available: false, reason: "PROVIDER_ERROR" };
    return {
      articles: data.slice(0, 8).map((a) => ({
        headline: a.headline,
        source: a.source,
        url: a.url,
        datetime: new Date(a.datetime * 1000),
      })),
      available: true,
    };
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return { articles: [], available: false, reason: "PROVIDER_ERROR" };
  }
}
