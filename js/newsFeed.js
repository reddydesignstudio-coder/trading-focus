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
