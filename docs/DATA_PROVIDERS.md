# Market Data Providers

Phase 1 targets $0 operating cost. Here's exactly what that means for data.

## Crypto — Binance Public REST API

- **Cost:** Free. **Key required:** No.
- **Endpoint used:** `GET https://api.binance.com/api/v3/klines`
- **Status reported:** `LIVE` (candles are typically seconds old) or `STALE` if
  the most recent candle is more than 3 timeframe-periods old.
- **Rate limits:** Binance's public endpoints are IP-weight-limited. The app
  throttles to a minimum 250ms between calls per symbol/timeframe and caches
  results for the timeframe's TTL (20s–30min depending on timeframe) to stay
  well under any reasonable usage.

## US Stocks & Forex — Twelve Data

- **Cost:** Free tier. **Key required:** Yes — you supply your own.
- Sign up at https://twelvedata.com/pricing for a free API key, then paste it
  into **Settings → Data Providers** in the app. The key is stored **only** in
  your browser's IndexedDB — it is never present in this app's source code and
  never sent anywhere except directly to `api.twelvedata.com` from your own
  browser.
- **Status reported:** Always `DELAYED`. Free-tier real-time entitlement isn't
  verifiable client-side, so the app deliberately never claims `LIVE` for this
  provider, even if your specific key happens to have real-time access.
- **Rate limits (free tier, subject to change by Twelve Data):** roughly
  8 requests/minute, 800/day. The app throttles to ~7.5s between calls and
  caches aggressively (15m bars cached 90s, 1h bars cached 5min) to make a
  full watchlist scan fit inside that budget.

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
source. The abstraction layer (`js/dataProviders/index.js`) is exactly what
lets you add a different provider (Alpha Vantage, Finnhub, Polygon's free
tier, IEX Cloud, etc.) later without touching the trading engine — implement
`getCandles({symbol, timeframe, limit}) → {candles, status, asOf, source}` and
register it in `PROVIDERS`.

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
