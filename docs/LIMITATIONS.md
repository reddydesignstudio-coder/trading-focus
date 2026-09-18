# Known Limitations (Phase 1)

Read this before using the app to inform any real trading decision. Nothing
here is hidden or softened — this is the honest list.

## Data

- **No free, no-key, guaranteed-real-time data source exists for all three
  asset classes.** Crypto (Binance) is effectively live. US stocks and forex
  (Twelve Data free tier) are always labeled `DELAYED`, even if your specific
  account happens to have better entitlement — the app can't verify that
  client-side, so it doesn't claim it.
- **No market-holiday calendar.** The session engine uses weekday + trading-
  hours logic only. On an exchange holiday, the app may show a session as
  "active" when the exchange is actually closed. Always cross-check before
  trading around holidays.
- **No news/economic-calendar feed.** "Event/news risk" as a no-trade filter
  is not implemented in Phase 1 — there is no reliable free, no-key source for
  it. This is a real gap; be aware of scheduled news around your trades.
- **Free-tier rate limits are real.** Twelve Data's free tier (~8 req/min,
  800/day) can be exhausted by scanning large watchlists repeatedly. The app
  caches and throttles to help, but a "Market data provider limit reached"
  message can still happen.
- **Relative-strength strategies need a benchmark series** (SPY for US
  stocks). If that fetch fails, relative-strength strategies simply produce no
  candidates for that scan rather than guessing.

## Trading engine

- **Confidence is a setup-quality score, not a win probability.** An 85/100
  setup is not "85% likely to win." Nothing in this app claims otherwise.
- **Backtests model one open position at a time** (no portfolio-level
  concurrency), and treat sessions as always-active by default, so
  session-gated strategies (e.g. London Breakout) can trigger outside their
  real session window in a backtest. They also don't model slippage, fees, or
  partial fills. Backtest results are a rough guide, not a promise.
- **No automated strategy optimizer.** The in-sample/out-of-sample split in
  the Backtester is a data partition for you to compare, not an auto-tuner.
- **Candlestick patterns are confirmation-only,** by design, and can never
  independently create a trade candidate.
- **Position sizing treats FX lots and crypto quantities uniformly as "units"**
  — Phase 1 does not model standard/mini/micro lot conventions or futures
  contract multipliers. Treat position size as a unit count of the instrument,
  not a broker-specific lot size.

## Notifications / PWA

- **iOS aggressively suspends backgrounded web apps.** This app cannot wake
  itself up to scan the market or fire a notification while fully closed or
  suspended, especially on iOS. See `docs/PWA.md` for the full breakdown.
  Treat alerts as a convenience when the app is open, never as a guarantee.

## Storage

- **All data is local to one browser/device.** There is no cloud sync in
  Phase 1. Use Settings → Export JSON regularly if you want a backup, and
  before switching devices or clearing browser data.

## General

This is an analysis and paper-trading practice tool. It does not execute real
trades, does not connect to a broker, and does not guarantee profits, a
specific win rate, real-time data, delivered notifications, or accurate market
predictions.
