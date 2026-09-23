# Market Data Providers

Phase 1 targets $0 operating cost. Here's exactly what that means for data.

## US Stocks & Forex — provider fallback chain

Genuine real-time data is a paid feature across this entire industry — no
free API key from any provider unlocks it. What a *chain* of free
providers gets you instead is **redundancy**: if one is rate-limited, the
next configured one is tried automatically, so the app falls back to demo
data far less often. All of the below report their data as `DELAYED`,
never `LIVE`, on the free tier.

Configure as many as you like in **Settings → Data Providers**; the app
tries them in this order:

1. **Finnhub** — free tier: 60 requests/minute (by far the most generous
   rate limit of the four). One real limitation: Finnhub's free-tier keys
   no longer have access to the `/stock/candle` endpoint for US equities —
   that's now a paid-tier feature. The app still tries it; if your key
   doesn't have access, it automatically falls through to the next
   provider rather than failing the scan. Forex candles remain available
   free at the time of writing. Sign up: finnhub.io/register
2. **Twelve Data** — free tier: ~800 requests/day (~8/minute). Supports a
   primary + backup key with automatic failover between them. Sign up:
   twelvedata.com/pricing
3. **Financial Modeling Prep (FMP)** — free tier available; exact rate
   limits aren't consistently published by FMP, so treat it as "some
   headroom" rather than a specific number. Sign up:
   site.financialmodelingprep.com/developer/docs/pricing
4. **Alpha Vantage** — free tier: only **25 requests per day**, by far the
   most restrictive of the four, which is why it's tried last — worth
   having as a last resort, not worth burning through first. Sign up:
   alphavantage.co/support/#api-key

## Crypto — Binance Public REST API

- **Cost:** Free. **Key required:** No.
- **Endpoint used:** `GET https://api.binance.com/api/v3/klines`
- **Status reported:** `LIVE` (candles are typically seconds old) or `STALE` if
  the most recent candle is more than 3 timeframe-periods old.
- **Rate limits:** Binance's public endpoints are IP-weight-limited. The app
  throttles to a minimum 250ms between calls per symbol/timeframe and caches
  results for the timeframe's TTL (20s–30min depending on timeframe) to stay
  well under any reasonable usage.

## Demo Mode

- **Cost:** Free, offline, no network call at all.
- Deterministic (seeded) pseudo-random OHLCV data, clearly labeled `DEMO` in
  every UI surface it touches. Used automatically as a fallback when:
  - No Twelve Data key is configured (stocks/forex), or
  - A provider call fails after retries, or
  - You explicitly force it in Settings.
- **Demo data can never reach Live Mode paper trading or the real
  performance/journal numbers** — every demo-derived signal is tagged
  `isDemo: true` end-to-end, and the app treats that tag as a hard boundary.

## Why not [other free API]?

Free, no-key, intraday-capable, reasonably-reliable market data for **all
three** asset classes (equities, forex, crypto) does not exist as a single
source — that's exactly why the app chains four providers for stocks/forex
instead of relying on one. The abstraction layer (`js/dataProviders/index.js`)
is what makes adding a fifth possible without touching the trading engine at
all — implement `getCandles({symbol, timeframe, limit, apiKey}) →
{candles, status, asOf, source}` and register it in `PROVIDERS`, then add it
to `buildStockForexChain()` at whatever priority its free tier deserves.

## Adding your own provider

```js
// js/dataProviders/myProvider.js
export const myProvider = {
  id: "myprovider",
  name: "My Provider",
  requiresKey: true,
  markets: ["us_stocks"],
  async getCandles({ symbol, timeframe, limit, apiKey, signal }) {
    // fetch, map to { t, o, h, l, c, v }[], return { candles, status, isDemo:false, asOf:new Date(), source:"myprovider" }
  },
};
```
Then add it to `PROVIDERS` and `DEFAULT_PROVIDER_FOR_MARKET` in
`js/dataProviders/index.js`.
