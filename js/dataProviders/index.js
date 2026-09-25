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
//     tried automatically. If every configured provider fails, the result
//     is a clean UNAVAILABLE status — never a silent substitution of fake
//     data. That automatic demo-data fallback existed early on and was
//     removed on request: seeing fabricated candles without asking for
//     them is confusing, and it was always in tension with this app's
//     core promise to never fabricate data. Demo data still exists as a
//     file (dataProviders/demo.js) purely for the automated test suite's
//     own deterministic fixtures — nothing in the real app ever reaches it.
//
// HONEST NOTE on "real-time preference": every one of these free-tier
// providers (Twelve Data, Finnhub, FMP, Alpha Vantage) delivers DELAYED
// data on its free tier — genuine real-time market data is a paid
// feature industry-wide, not something any free API key unlocks. Adding
// more of them doesn't make data faster; it adds redundancy, so a real
// scan is more likely to succeed rather than come back UNAVAILABLE.
// Crypto (Binance) remains the only genuinely real-time, free source.

import { demoProvider } from "./demo.js";
import { binanceProvider } from "./binance.js";
import { twelveDataProvider } from "./twelveData.js";
import { finnhubProvider } from "./finnhub.js";
import { fmpProvider } from "./fmp.js";
import { alphaVantageProvider } from "./alphaVantage.js";
import { ProviderError } from "./binance.js";
import { assessFreshness, mergeAndStoreCandles, getCachedCandles, getCachedRecord, DEFAULT_MAX_CANDLES, MINIMUM_CANDLES_FOR_READY } from "../candleCache.js";

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
const lastCallAt = new Map(); // bucket -> timestamp
const callLog = new Map(); // bucket -> [timestamps within last 60s]
const totalCallsSession = new Map(); // bucket -> cumulative count since this page load

// Documented free-tier limits, for DISPLAY only (Settings shows "X used this
// session" against these) — not enforced here; enforcement is just the
// throttle/retry/fallback behavior already in place. FMP doesn't
// consistently publish a free-tier number, so it's shown as count-only.
const DOCUMENTED_LIMITS = {
  finnhub: { window: "minute", limit: 60 },
  twelvedata: { window: "day", limit: 800 },
  fmp: { window: null, limit: null },
  alphavantage: { window: "day", limit: 25 },
  binance: { window: null, limit: null },
};

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
  totalCallsSession.set(bucket, (totalCallsSession.get(bucket) || 0) + 1);
}

export function callsInLastMinute(providerId, apiKey) {
  const bucket = throttleKey(providerId, apiKey);
  const now = Date.now();
  return (callLog.get(bucket) || []).filter((t) => now - t < 60000).length;
}

/**
 * Usage snapshot for one provider+key, for display in Settings — "X
 * requests made this session" against the provider's documented free-tier
 * limit (where one is consistently published). This is informational only,
 * reset on page reload; it doesn't track the provider's actual server-side
 * quota (which we have no way to read directly), just what THIS app has
 * sent since it was last loaded.
 */
export function getUsageStats(providerId, apiKey) {
  const bucket = throttleKey(providerId, apiKey);
  const doc = DOCUMENTED_LIMITS[providerId] || {};
  return {
    totalThisSession: totalCallsSession.get(bucket) || 0,
    inLastMinute: callsInLastMinute(providerId, apiKey),
    limitWindow: doc.window || null,
    limitValue: doc.limit || null,
  };
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
  if (err.name === "TimeoutError") return { code: "TIMEOUT", message: "Market data provider took too long to respond. Trying the next option." };
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
      // Hard client-side timeout — without this, a provider that hangs (no
      // response, stuck connection) leaves the whole scan waiting forever
      // with zero feedback, since a bare fetch() has no timeout of its own.
      return await withTimeout(provider.getCandles({ symbol, market, timeframe, limit, apiKey, signal }), REQUEST_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError") throw err;
      if (err.name === "TimeoutError") break; // don't retry a hang against the same provider — move to the next one in the chain immediately
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

const REQUEST_TIMEOUT_MS = 10000; // one provider hanging costs at most this long before the chain moves on — never indefinite

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error("Request timed out");
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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
 * The original live-fetch entry point (chain/retry/timeout/in-memory-TTL
 * cache logic, all unchanged). Not exported directly anymore — the
 * public getMarketData below wraps this with the persistent-cache layer.
 * Options: symbol, market, timeframe, limit, forceProviderId, apiKeys
 * ({twelvedata, twelvedataBackup, finnhub, fmp, alphavantage}), signal
 * (AbortSignal).
 *
 * IMPORTANT: this never silently substitutes demo data when a real
 * source fails — that automatic fallback was removed on request,
 * because seeing fabricated data without asking for it is confusing
 * and sits in real tension with this app's core "never fabricate data"
 * principle. A genuine failure now returns a clean UNAVAILABLE result;
 * the UI is responsible for showing that honestly. Demo data still
 * exists as a file (dataProviders/demo.js) purely so the automated test
 * suite can generate deterministic candles without real network calls —
 * it is only ever reachable by a caller explicitly passing
 * forceProviderId: "demo", which no part of the actual app does.
 */
async function getMarketDataInternal(opts) {
  const { symbol, market, timeframe, limit = 200, forceProviderId, apiKeys = {}, signal } = opts;
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
      cache.set(key, { data: result, fetchedAt: Date.now() });
      return result;
    }

    // Non-chained path: crypto (Binance) or an explicit "demo" override (tests only — never reached by the app itself).
    const result = await callProviderWithRetry({ providerId, apiKey: undefined, symbol, market, timeframe, limit, signal });
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
    return []; // no configured provider could search — an empty result, not a fabricated one
  }
  const providerId = DEFAULT_PROVIDER_FOR_MARKET[market];
  try {
    return await PROVIDERS[providerId].searchSymbols(query, market);
  } catch {
    return [];
  }
}

export { PROVIDERS, buildStockForexChain };

/**
 * Public entry point. Adds a LAZY, on-scan persistent-cache layer on top
 * of the unchanged live-fetch logic above: before touching the network,
 * check whether IndexedDB already has fresh-enough candles (readiness is
 * assessed the same way a proactive/scheduled system would, just
 * triggered by an actual call instead of a clock). If so, serve from
 * disk — zero network calls, works across page reloads, unlike the old
 * in-memory-only cache. If not, fall through to the real fetch exactly
 * as before, then merge the result into the persistent store so the
 * NEXT call — even after a reload — has a longer, more complete history
 * to work with, not just whatever the last `limit` happened to be.
 *
 * Demo data is never persisted (it's synthetic and would corrupt a real
 * cache). Pass `forceRefresh: true` to skip the cache check entirely
 * (e.g. a person explicitly asking for the very latest read).
 */
export async function getMarketData(opts) {
  const { symbol, market, timeframe, limit = 200, forceRefresh = false, forceProviderId } = opts;
  const usePersistentCache = !forceRefresh && forceProviderId !== "demo";

  if (usePersistentCache) {
    try {
      const freshness = await assessFreshness(symbol, market, timeframe, Math.min(limit, MINIMUM_CANDLES_FOR_READY));
      if (freshness.status === "READY") {
        const record = await getCachedRecord(symbol, market, timeframe);
        if (record?.candles?.length) {
          return {
            candles: record.candles,
            status: record.dataStatus || "DELAYED",
            isDemo: false,
            asOf: new Date(record.lastUpdated),
            source: record.source,
            symbol,
            market,
            timeframe,
            fromPersistentCache: true,
          };
        }
      }
    } catch (e) {
      console.warn("Persistent candle cache read failed, falling through to live fetch:", e.message);
    }
  }

  const result = await getMarketDataInternal(opts);

  if (usePersistentCache && !result.isDemo && result.candles?.length) {
    try {
      await mergeAndStoreCandles(symbol, market, timeframe, result.candles, DEFAULT_MAX_CANDLES, { dataStatus: result.status, source: result.source });
      const merged = await getCachedCandles(symbol, market, timeframe);
      if (merged.length > result.candles.length) {
        return { ...result, candles: merged }; // hand back the longer, accumulated history, not just this fetch's slice
      }
    } catch (e) {
      console.warn("Persistent candle cache write failed (live result still returned normally):", e.message);
    }
  }

  return result;
}
