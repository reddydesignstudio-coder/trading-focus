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

const BASE_URL = "https://finnhub.io/api/v1";

export async function fetchMarketNews(apiKey, signal) {
  if (!apiKey) return { articles: [], available: false, reason: "NO_API_KEY" };
  try {
    const res = await fetch(`${BASE_URL}/news?category=general&token=${apiKey}`, { signal });
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
