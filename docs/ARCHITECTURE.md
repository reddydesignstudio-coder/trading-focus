# Architecture

## Design principles

1. **Zero cost.** Static frontend only. No backend server, no paid database, no
   paid APIs. Everything that needs to persist lives in the browser's IndexedDB.
2. **Provider-agnostic data layer.** Nothing above `js/dataProviders/index.js`
   knows which provider it's talking to. Swapping or adding a provider means
   writing one new file in `dataProviders/` and registering it — the scanner,
   backtester, and UI never change.
3. **One performance engine.** `js/performance.js` is the only place win %,
   profit factor, expectancy, drawdown, etc. are calculated. Daily Summary,
   the Performance Dashboard, Strategy Lab, and the Backtester all call it with
   different trade subsets. This guarantees the numbers can never drift apart.
4. **Signals are not trades.** The scanner produces `signal` records. Only
   `paperTrading.js#executeTrade` creates a `trade` record that affects account
   performance. This separation is enforced structurally (different IndexedDB
   stores, different fields) not just by convention.
5. **No forced outputs.** The scanner returns however many qualifying setups
   actually clear every filter — including zero. The no-trade engine
   (`noTrade.js`) is a first-class module, not an afterthought.
6. **Honest data-status reporting.** Every data fetch returns one of
   `LIVE | DELAYED | STALE | UNAVAILABLE | DEMO`. The UI always shows this
   status. Stale/unavailable data disables new signal generation for that
   scan.

## High-level data flow ("CHECK FOR TRADE")

```
User taps CHECK FOR TRADE
        │
        ▼
scanner.scanMarket(market, watchlist)
        │
        ├─► dataProviders.getMarketData() ── cache/dedupe/throttle/retry ──► provider (Binance / Twelve Data / Demo)
        │        returns { candles, status, isDemo, asOf }
        │
        ├─► if status is STALE/UNAVAILABLE → return with error, no signals generated
        │
        ├─► indicators.computeIndicatorSet(candles)        (EMA/RSI/MACD/ADX/ATR/VWAP/RVOL)
        ├─► structure.analyzeStructure(candles)             (swings, HH/HL/LH/LL, S/R, BOS)
        ├─► regime.classifyRegime(candles, indicators)      (trend/range/breakout/compression)
        │
        ▼
  for each strategy applicable to this market:
        strategy.evaluate(ctx) → candidate | null
        │
        ├─► confirmation.evaluateConfirmations(ctx, candidate)   (≥2 independent sources required)
        ├─► confidence.computeConfidence(ctx, candidate, confirmations)   (0-100 setup-quality score)
        ├─► targetEngine.resolveTarget(candidate, ...)      (structure/ATR-aware; rejects if R:R unrealistic)
        ├─► risk.recalculateTrade(...)                       (position size, hard $ risk ceiling)
        ├─► noTrade.runNoTradeFilters(...)                    (stacked rejection reasons)
        │
        ▼
  qualifying setups only → sorted by confidence → returned to UI
        │
        ▼
User taps PAPER TRADE → paperTrading.executeTrade() → trade record in IndexedDB
        │
        ▼
(later) tradeResolution.resolveAgainstCandles() → WIN | LOSS | OPEN | AMBIGUOUS
        │
        ▼
performance.computePerformance() ← powers Daily Summary / Performance / Strategy Lab
```

## Module responsibilities (quick reference)

| Module | Responsibility |
|---|---|
| `timezone.js` | DST-safe local time & session windows via `Intl` |
| `marketFocus.js` | Which market/session to check right now, and why |
| `dataProviders/*` | Fetch, cache, throttle, retry, and label market data |
| `indicators.js` | Pure indicator math |
| `structure.js` | Swing/structure/S/R detection |
| `candlestick.js` | Candlestick pattern detection (confirmation-only) |
| `regime.js` | Market regime classification |
| `strategies/*` | 16 independent strategy rule sets |
| `confirmation.js` | Independent-confirmation counting |
| `confidence.js` | 100-point setup-quality score |
| `targetEngine.js` | Structure/ATR-aware TP resolution |
| `risk.js` | Position sizing, hard risk ceiling |
| `noTrade.js` | Rejection logic |
| `scanner.js` | Orchestrates the above into qualifying setups |
| `paperTrading.js` | Signal→trade conversion, Live/Test mode rules |
| `tradeResolution.js` | Deterministic TP/SL outcome resolution |
| `performance.js` | Shared metrics engine |
| `dailySummary.js`, `strategyLab.js`, `backtest.js` | Consumers of `performance.js` |
| `db.js` | IndexedDB storage |
| `alerts.js` | Notification API wrapper |
| `exportImport.js` | Backup/restore |
| `ui/*` | Vanilla-DOM rendering, no framework |

## Why no framework / build step?

Zero-cost static hosting (GitHub Pages, Cloudflare Pages, Netlify/Vercel free
tier) serves plain files with no build pipeline required. Native ES modules
(`<script type="module">`) give us real `import`/`export` module boundaries
without a bundler. This keeps the dependency surface (and therefore the
long-term maintenance and security burden) at zero.
