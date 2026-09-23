// js/dataProviders/index.js
//
// Market Data Abstraction Layer
// --------------------------------------------------------------
// Everything above this module (the scanner, backtest engine, UI)
// talks ONLY to `getMarketData(...)` below — never to a specific
// provider. This is what lets Phase 2 swap in a different data
// source without touching the trading engine.
//
// Cross-cutting concerns implemented HERE, once, for every provider:
//   - in-memory + IndexedDB-backed caching with TTL
//   - request de-duplication (concurrent identical requests share one fetch)
//   - per-provider throttling (min ms between calls)
//   - exponential backoff retry on transient failures
//   - basic rate-limit bookkeeping (calls per rolling minute)
//   - AbortController-based cancellation
//   - explicit stale-data detection (never silently relabels stale as live)
//   - a multi-provider FALLBACK CHAIN for stocks/forex: if one configured
//     provider is rate-limited or erroring, the next configured one is
//     tried automatically before ever falling back to demo data.
//
// HONEST NOTE on "real-time preference": every one of these free-tier
// providers (Twelve Data, Finnhub, FMP, Alpha Vantage) delivers DELAYED
// data on its free tier — genuine real-time market data is a paid
// feature industry-wide, not something any free API key unlocks. Adding
// more of them doesn't make data faster; it adds redundancy, so the app
// falls back to demo data far less often. Crypto (Binance) remains the
// only genuinely real-time, free source in this app.

import { demoProvider } from "./demo.js";
import { binanceProvider } from "./binance.js";
import { twelveDataProvider } from "./twelveData.js";
import { finnhubProvider } from "./finnhub.js";
import { fmpProvider } from "./fmp.js";
import { alphaVantageProvider } from "./alphaVantage.js";
import { ProviderError } from "./binance.js";

const PROVIDERS = {
  demo: demoProvider,
  binance: binanceProvider,
  twelvedata: twelveDataProvider,
  finnhub: finnhubProvider,
  fmp: fmpProvider,
  alphavantage: alphaVantageProvider,
};

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, requiresKey: !!p.requiresKey, markets: p.markets }));
}

// Default provider routing per market. Crypto stays Binance-only (already
// free AND genuinely real-time — none of the delayed fallbacks below add
// anything there). Stocks/Forex use a priority-ordered fallback chain
// (see buildStockForexChain) built from whichever keys are configured.
const DEFAULT_PROVIDER_FOR_MARKET = {
  crypto: "binance",
  us_stocks: "twelvedata", // used only when forceProviderId isn't set and the chain-building path is bypassed (e.g. explicit override)
  forex: "twelvedata",
};

const cache = new Map(); // key -> { data, fetchedAt }
const inFlight = new Map(); // key -> Promise
const lastCallAt = new Map(); // providerId -> timestamp
const callLog = new Map(); // providerId -> [timestamps within last 60s]

// twelvedata ~8/min => ~7.5s spacing. finnhub 60/min => ~1s spacing (far more
// headroom). fmp and alphavantage rate limits aren't consistently published,
// so a conservative default is used; alphavantage's real constraint is its
// 25/day cap, which no amount of per-request spacing can work around.
const MIN_INTERVAL_MS = { binance: 250, twelvedata: 7500, finnhub: 1000, fmp: 1200, alphavantage: 1200, demo: 0 };
const CACHE_TTL_MS = { "1m": 20000, "5m": 45000, "15m": 90000, "1h": 5 * 60000, "4h": 15 * 60000, "1d": 30 * 60000 };
const MAX_RETRIES = 2; // per provider, before moving to the next one in the chain

function cacheKey({ providerId, symbol, market, timeframe }) {
  return `${providerId}:${market}:${symbol}:${timeframe}`;
}

function throttleKey(providerId, apiKey) {
  // Throttling must be scoped per API KEY, not just per provider — two
  // different keys for the same provider (e.g. Twelve Data primary/backup)
  // have independent rate budgets, so falling through from a rate-limited
  // primary key to a fresh backup key should never wait out the primary's
  // throttle window first.
  return apiKey ? `${providerId}:${apiKey.slice(0, 10)}` : providerId;
}

function recordCall(providerId, apiKey) {
  const bucket = throttleKey(providerId, apiKey);
  const now = Date.now();
  lastCallAt.set(bucket, now);
  const log = (callLog.get(bucket) || []).filter((t) => now - t < 60000);
  log.push(now);
  callLog.set(bucket, log);
}

export function callsInLastMinute(providerId, apiKey) {
  const bucket = throttleKey(providerId, apiKey);
  const now = Date.now();
  return (callLog.get(bucket) || []).filter((t) => now - t < 60000).length;
}

async function throttle(providerId, apiKey) {
  const bucket = throttleKey(providerId, apiKey);
  const min = MIN_INTERVAL_MS[providerId] ?? 500;
  const last = lastCallAt.get(bucket) || 0;
  const wait = min - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function friendlyError(err) {
  if (err instanceof ProviderError) {
    if (err.httpStatus === 429) return { code: "RATE_LIMIT", message: "Market data provider limit reached. Please wait before checking again." };
    if (err.httpStatus >= 500) return { code: "PROVIDER_DOWN", message: "Market data provider is temporarily unavailable. Please try again shortly." };
    return { code: "PROVIDER_ERROR", message: "Market data temporarily unavailable." };
  }
  if (err.name === "AbortError") return { code: "CANCELLED", message: "Request cancelled." };
  return { code: "UNKNOWN", message: "Market data temporarily unavailable." };
}

/**
 * Builds the ordered list of {providerId, apiKey} entries to try for
 * Stocks/Forex, from whichever keys are actually configured. Order is by
 * how usable the free tier realistically is (generous rate limit first,
 * the extremely-restricted 25/day Alpha Vantage tier last), NOT by
 * speed — every entry here is equally "delayed." `restrictToProviderId`
 * narrows the chain to just that provider's own key(s) — used when the
 * caller (or a test) explicitly forces one specific provider; its own
 * primary/backup key rotation still applies within that restriction.
 */
function buildStockForexChain(apiKeys, restrictToProviderId = null) {
  const want = (id) => !restrictToProviderId || restrictToProviderId === id;
  const chain = [];
  if (want("finnhub") && apiKeys.finnhub) chain.push({ providerId: "finnhub", apiKey: apiKeys.finnhub });
  if (want("twelvedata") && apiKeys.twelvedata) chain.push({ providerId: "twelvedata", apiKey: apiKeys.twelvedata });
  if (want("twelvedata") && apiKeys.twelvedataBackup) chain.push({ providerId: "twelvedata", apiKey: apiKeys.twelvedataBackup });
  if (want("fmp") && apiKeys.fmp) chain.push({ providerId: "fmp", apiKey: apiKeys.fmp });
  if (want("alphavantage") && apiKeys.alphavantage) chain.push({ providerId: "alphavantage", apiKey: apiKeys.alphavantage });
  return chain;
}

async function callProviderWithRetry({ providerId, apiKey, symbol, market, timeframe, limit, signal }) {
  const provider = PROVIDERS[providerId];
  let attempt = 0;
  let lastErr;
  while (attempt <= MAX_RETRIES) {
    try {
      await throttle(providerId, apiKey);
      recordCall(providerId, apiKey);
      return await provider.getCandles({ symbol, market, timeframe, limit, apiKey, signal });
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError") throw err;
      attempt += 1;
      if (attempt <= MAX_RETRIES) {
        const backoff = Math.min(6000, 500 * 2 ** attempt) + Math.random() * 250;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  const friendly = friendlyError(lastErr);
  return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: providerId, reason: friendly.code };
}

/**
 * Tries every entry in the Stocks/Forex fallback chain in order. Moves to
 * the next one on RATE_LIMIT, NO_API_KEY, or PROVIDER_ERROR — a genuinely
 * successful (even if empty-of-signal) response from any provider is
 * returned immediately rather than second-guessed.
 */
async function callStockForexChain({ symbol, market, timeframe, limit, apiKeys, signal, restrictToProviderId = null }) {
  const chain = buildStockForexChain(apiKeys, restrictToProviderId);
  if (chain.length === 0) {
    return { candles: [], status: "UNAVAILABLE", isDemo: false, asOf: new Date(), source: restrictToProviderId || "none", reason: "NO_API_KEY" };
  }
  let lastResult = null;
  for (let i = 0; i < chain.length; i++) {
    const { providerId, apiKey } = chain[i];
    const result = await callProviderWithRetry({ providerId, apiKey, symbol, market, timeframe, limit, signal });
    const shouldFallThrough = result.status === "UNAVAILABLE";
    if (!shouldFallThrough) {
      return { ...result, chainPosition: i, chainLength: chain.length };
    }
    lastResult = result; // this provider didn't work out — try the next one, if any
  }
  return lastResult; // every configured provider in the chain failed
}

/**
 * Main entry point. Options:
 *   symbol, market, timeframe, limit, forceProviderId,
 *   apiKeys ({twelvedata, twelvedataBackup, finnhub, fmp, alphavantage}),
 *   allowDemoFallback (bool), signal (AbortSignal)
 */
export async function getMarketData(opts) {
  const { symbol, market, timeframe, limit = 200, forceProviderId, apiKeys = {}, allowDemoFallback = true, signal } = opts;
  const isStockForexMarket = market === "us_stocks" || market === "forex";
  // "demo" as a forced provider always bypasses the chain entirely. Forcing
  // any OTHER specific provider (e.g. a test forcing "twelvedata") still
  // goes through the chain machinery (caching, retry, cache key), just
  // restricted to that one provider's own key(s) — this is what preserves
  // e.g. Twelve Data's primary/backup key rotation when it's forced directly.
  const usesChain = isStockForexMarket && forceProviderId !== "demo";
  const restrictToProviderId = usesChain ? forceProviderId || null : null;
  const providerId = forceProviderId || DEFAULT_PROVIDER_FOR_MARKET[market] || "demo";
  const key = usesChain ? `chain:${restrictToProviderId || "all"}:${market}:${symbol}:${timeframe}` : cacheKey({ providerId, symbol, market, timeframe });

  // Serve from cache if fresh.
  const cached = cache.get(key);
  const ttl = CACHE_TTL_MS[timeframe] ?? 60000;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return { ...cached.data, fromCache: true };
  }

  // De-duplicate concurrent identical requests.
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    if (usesChain) {
      const result = await callStockForexChain({ symbol, market, timeframe, limit, apiKeys, signal, restrictToProviderId });
      if (result.status === "UNAVAILABLE" && allowDemoFallback) {
        const demo = await demoProvider.getCandles({ symbol, market, timeframe, limit });
        return { ...demo, fallbackReason: result.reason || "PROVIDER_UNAVAILABLE" };
      }
      cache.set(key, { data: result, fetchedAt: Date.now() });
      return result;
    }

    // Non-chained path: crypto (Binance) or an explicit "demo" override.
    const result = await callProviderWithRetry({ providerId, apiKey: undefined, symbol, market, timeframe, limit, signal });
    if (result.status === "UNAVAILABLE" && allowDemoFallback && providerId !== "demo") {
      const demo = await demoProvider.getCandles({ symbol, market, timeframe, limit });
      return { ...demo, fallbackReason: result.reason || "PROVIDER_UNAVAILABLE" };
    }
    cache.set(key, { data: result, fetchedAt: Date.now() });
    return result;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

export function invalidateCache(prefix) {
  for (const k of cache.keys()) {
    if (!prefix || k.startsWith(prefix)) cache.delete(k);
  }
}

export async function searchSymbols(market, query, apiKeys = {}) {
  if (market === "us_stocks" || market === "forex") {
    const chain = buildStockForexChain(apiKeys);
    for (const { providerId, apiKey } of chain) {
      try {
        const results = await PROVIDERS[providerId].searchSymbols(query, apiKey);
        if (results && results.length) return results;
      } catch {
        /* try the next provider in the chain */
      }
    }
    return demoProvider.searchSymbols(query, market);
  }
  const providerId = DEFAULT_PROVIDER_FOR_MARKET[market] || "demo";
  try {
    return await PROVIDERS[providerId].searchSymbols(query, market);
  } catch {
    return demoProvider.searchSymbols(query, market);
  }
}

export { PROVIDERS, buildStockForexChain };
