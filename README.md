# Trading Focus — Phase 1

A zero-cost, client-side, mobile-first PWA for day-trading **analysis and paper trading**.
It is a decision-support and practice tool — **not** a broker, not an execution
system, and not a guarantee of profit. See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

## What Phase 1 actually does

1. Reads your device's local time (default zone: `Asia/Kolkata`) and tells you which
   market session is active right now, using a real IANA-timezone engine (DST-safe).
2. Recommends which market (US Stocks / Forex / Crypto) is most worth checking right
   now, based on documented session-liquidity patterns — **a suitability estimate,
   never a profit prediction**.
3. On demand (`CHECK FOR TRADE`), pulls real market data, runs 19 independent
   strategy modules through a shared indicator/structure/regime/confirmation/
   confidence/risk pipeline, and shows you only the setups that genuinely qualify —
   **0 to N, never padded to a target count**.
4. Lets you paper-trade a qualifying setup (Live Mode: 1 trade/day, locks after
   win/loss; Test Mode: 1/2/5/10 trades/day), tracks it to resolution, and journals
   everything.
5. Gives you a Daily Summary, a multi-window Performance Dashboard, a Strategy Lab,
   and a historical Backtester — all powered by one shared performance-calculation
   engine so the numbers are consistent everywhere.
6. Runs entirely in your browser. All data lives in IndexedDB on your device. There
   is no backend, no paid API, no paid hosting.

## Quickstart (local development)

No build step. It's plain ES modules + vanilla JS.

```bash
cd trading-app
npm run serve      # python3 -m http.server 8080
# open http://localhost:8080 in your browser (or your phone, on the same network)
```

Or just open `index.html` via any static file server (`npx serve`, VS Code Live
Server, etc.) — it must be served over HTTP(S), not `file://`, for ES modules and
the service worker to work correctly.

## Running the tests

```bash
npm test
# node --test tests/    (56 tests covering indicators, risk, trade resolution,
#                         performance, confidence, confirmation, target engine,
#                         timezone/DST, and an end-to-end scanner smoke test)
```

## Project structure

```
trading-app/
├── index.html               # App shell
├── manifest.json             # PWA manifest
├── service-worker.js         # Shell-only caching (never caches market data)
├── css/styles.css
├── icons/                    # PWA icons
├── js/
│   ├── app.js                 # Bootstrap + router + nav
│   ├── db.js                  # IndexedDB storage engine (versioned schema)
│   ├── settings.js            # Settings load/save
│   ├── timezone.js            # DST-safe session/timezone engine
│   ├── marketFocus.js         # Market Focus Engine
│   ├── indicators.js          # EMA/RSI/MACD/ADX/ATR/VWAP/RVOL
│   ├── structure.js           # Swings, HH/HL/LH/LL, S/R, break of structure
│   ├── candlestick.js         # Candlestick pattern detectors (confirmation-only)
│   ├── regime.js               # Market regime classification
│   ├── strategies/             # 19 independent strategy modules (8 US / 5 FX / 6 crypto)
│   ├── confirmation.js         # Independent-confirmation counting (min 2)
│   ├── confidence.js           # 100-point setup-quality scoring
│   ├── targetEngine.js         # Structure/ATR-aware target resolution
│   ├── risk.js                 # Position sizing, hard dollar-risk ceiling
│   ├── noTrade.js              # First-class rejection logic
│   ├── scanner.js              # CHECK FOR TRADE orchestration
│   ├── paperTrading.js         # Signal-vs-trade separation, Live/Test mode rules
│   ├── tradeResolution.js      # Deterministic TP/SL resolution
│   ├── performance.js          # Shared performance-metrics engine
│   ├── dailySummary.js         # Daily Summary (uses performance.js)
│   ├── backtest.js             # Walk-forward backtester, no look-ahead
│   ├── strategyLab.js          # Per-strategy factual performance
│   ├── alerts.js               # Notification API wrapper
│   ├── exportImport.js         # JSON/CSV export, JSON import
│   ├── dataProviders/          # Market-data abstraction layer
│   │   ├── index.js             # Cache/dedupe/throttle/retry/cancel orchestration
│   │   ├── binance.js           # Crypto, free, no key
│   │   ├── twelveData.js        # Stocks/FX, free tier, user-supplied key
│   │   └── demo.js              # Deterministic offline demo data
│   └── ui/                     # Vanilla-DOM view renderers + components
├── tests/                      # node:test unit + integration tests
└── docs/                       # This documentation set
```

## Documentation index

- [`FEATURES.md`](docs/FEATURES.md) — complete feature inventory (start here for "what's actually built")
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, data flow, module map
- [`DATA_PROVIDERS.md`](docs/DATA_PROVIDERS.md) — providers used, how to get a free key
- [`LIMITATIONS.md`](docs/LIMITATIONS.md) — honest, itemized free-data/browser limitations
- [`STRATEGIES.md`](docs/STRATEGIES.md) — all 19 strategies, rules, confirmations
- [`RISK.md`](docs/RISK.md) — risk/position-sizing/confidence documentation
- [`STORAGE.md`](docs/STORAGE.md) — IndexedDB schema, versioning, export/import
- [`FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md) — step-by-step guide to enable cross-device cloud sync
- [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) — free static hosting instructions
- [`PWA.md`](docs/PWA.md) — install instructions + notification limitations
- [`PHASE2_IOS.md`](docs/PHASE2_IOS.md) — native iOS migration plan

## Important

This tool does not, and will never, guarantee profits, a specific win rate,
real-time data, delivered notifications, or accurate market predictions. It is
a transparent analysis and paper-trading practice tool. Read
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) before using it to inform any real
trading decision.
