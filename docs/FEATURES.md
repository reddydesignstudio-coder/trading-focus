# Trading Focus — Phase 1: Complete Feature Inventory

Everything built, in one place. 19 strategies, 88 automated tests, $0 cost.

## Core engines

- **Timezone/Session Engine** — DST-safe via the `Intl` API (no hardcoded UTC
  offsets); tracks Sydney, Tokyo, London, US pre-market/regular/after-hours,
  and New York FX sessions; detects the London/New York liquidity overlap.
- **Market Focus Engine** — recommends which market (Stocks/Forex/Crypto) is
  worth checking right now, with a plain reason, based on documented
  session-liquidity patterns.
- **Live Trading-Window Verdict** — a second, more specific layer: for
  whichever market you're viewing, a live **Good / Fair / Weak / Closed**
  read tied to the actual clock (opening hour, midday lull, closing hour,
  London/NY overlap), with a plain-English reason — not a static tip.
- **Market Data Abstraction Layer** — one interface every other module talks
  to; underneath it handles caching, request de-duplication, per-provider
  throttling, exponential-backoff retry, and clean cancellation.
- **Technical Analysis Engine** — EMA (9/20/50), SMA, RSI, MACD, ATR, ADX/DMI,
  session VWAP, RVOL, realized volatility, Bollinger Bands.
- **Market Structure Engine** — swing high/low detection, HH/HL/LH/LL
  classification, support/resistance clustering, break-of-structure detection.
- **Candlestick Engine** — 11 patterns (5 bullish, 5 bearish, 1 continuation),
  used strictly as confirmation signals, never as a standalone trade trigger.
- **Market Regime Engine** — classifies Strong/Weak Uptrend, Strong/Weak
  Downtrend, Range, Breakout, and volatility compression/expansion.
- **Confirmation Engine** — requires 2+ independent confirmation categories
  per setup (structure, trend, volume, VWAP, momentum, S/R, candlestick,
  regime, relative strength); a category is never double-counted.
- **Confidence Engine** — the documented 100-point setup-quality score with a
  visible component breakdown; explicitly labeled "not a win probability."
- **Target Engine** — derives take-profit from real structure/ATR, and
  **caps it to your configured max R:R** rather than displaying an inflated
  number (this was a real bug, found and fixed — see Bug Fixes below).
- **Risk Engine** — position sizing with a hard dollar-risk ceiling that
  confidence can never influence; supports a **primary + backup API key**
  with automatic failover on rate limits.
- **No-Trade Engine** — first-class rejection logic with stacked, specific
  reasons shown per symbol, not just a single vague "no signal."
- **Scanner** — the full `CHECK FOR TRADE` pipeline; returns 0–N qualifying
  setups, never padded to a target count.
- **Paper Trading Engine** — hard separation between signals and trades; Live
  Mode (1 trade/day, locks after WIN/LOSS/AMBIGUOUS) vs. Test Mode (1/2/5/10
  trades/day), fully separate stats; **refuses to execute a Live Mode trade
  on demo data**.
- **Trade Monitor** *(added this session)* — actually checks every OPEN trade
  against fresh prices and resolves it to WIN/LOSS/AMBIGUOUS. This closes a
  real gap: the resolution logic existed and was tested, but nothing had
  ever called it for live trades before — trades used to just stay "OPEN"
  forever even after hitting TP/SL.
- **Trade Resolution Engine** — deterministic TP/SL outcome: TP-first = WIN,
  SL-first = LOSS, same-candle = smaller-timeframe check if available, else
  honest AMBIGUOUS — never guessed.
- **Performance Engine** — one shared calculation engine powering Daily
  Summary, the Performance Dashboard, Strategy Lab, and Backtesting, so the
  numbers can never drift apart between screens.
- **Backtest Engine** — walk-forward simulation with no look-ahead bias,
  in-sample/out-of-sample split, **saved backtest history** you can review
  later.
- **Plain-English Explanation Layer** *(added this session)* — every one of
  the 19 strategies has a dedicated, jargon-free, direction-aware
  explanation of *why* a setup qualified, sitting above the technical detail
  on every signal card.

## The 19 strategies

| Market | Count | Strategies |
|---|---|---|
| US Stocks | 8 | Opening Range Breakout + Volume, Breakout + Volume, Breakout Retest, Trend Pullback, VWAP Reclaim/Rejection, Relative Strength Breakout, **Bollinger Band Mean Reversion**, **Gap and Go** |
| Forex | 5 | London Breakout, London/New York Overlap Momentum, Trend Pullback, Liquidity Sweep + Reversal, Support/Resistance Rejection |
| Crypto | 6 | Breakout + Retest, Trend Pullback, Volatility Compression → Expansion, VWAP Reclaim, Liquidity Sweep Reversal, **EMA 9/20 Momentum Cross** |

(Bold = added in the most recent update, after researching what current 2026
retail strategy guides emphasize that the original 16 didn't cover.)

## Data & providers

- **Crypto** — Binance public API, free, no key, genuinely real-time.
- **US Stocks / Forex** — Twelve Data free tier; always honestly labeled
  **Delayed**, never falsely claimed as Live.
- **Primary + Backup API key** with automatic rotation on rate-limit.
- **Demo Mode** — deterministic offline fallback, clearly labeled everywhere
  it appears, structurally isolated from real trading (Live Mode refuses it).
- Every data status — **Live / Delayed / Stale / Demo / Unavailable** — shown
  plainly, with new-signal generation disabled on Stale/Unavailable data.

## Screens

- **Home** — live H:M:S countdown to US Regular session and Forex New York
  session opening/closing; condensed Market Focus card; account balance,
  today's P&L, today's win %, Live Mode status; a plain "Data Sources — Real
  or Demo?" card so you never have to guess.
- **Scan** — per-market tabs; live Open/Closed status + trading-window
  verdict; Live/Test mode toggle (with a warning when Live Mode meets demo
  data); a collapsible legend explaining every status term; full **Symbols
  Scanned** audit trail — every symbol tagged Qualifying / Rejected (with the
  exact reason) / No Setup Detected / Data Issue, not just the winners.
- **Journal** — every trade ever taken; for OPEN trades: live current price,
  unrealized P&L, "if TP hits" / "if SL hits" dollar amounts, distance to
  TP/SL, and a "typical pace" time estimate (explicitly labeled as a
  volatility-based estimate, never a prediction).
- **Today** — signal funnel, headline stats, full trade list, strategy/market
  breakdowns.
- **Performance** — Today/7d/30d/90d/6mo/1yr/All-Time views, equity curve,
  win/loss streaks, per-strategy and per-market breakdowns.
- **Backtest** — run against real historical data, in-sample vs.
  out-of-sample, save runs for later comparison.
- **Strategy Lab** — factual per-strategy performance; deliberately never
  labels anything "best."
- **Settings** — risk parameters, timezone, primary/backup API keys,
  per-market watchlist editor (add/remove symbols, changes save instantly),
  Test Mode trade cap, export/import.
- **More** menu — consolidated access to Journal/Today/Performance/
  Backtest/Strategy Lab behind a single "More" tab, keeping the bottom nav
  to 4 items.

## Risk & safety guarantees (enforced in code, not just policy)

- Confidence score can never increase dollar risk.
- R:R is always capped to your configured maximum — the target price itself
  gets pulled in, not just flagged.
- Live Mode cannot execute against demo data.
- Missed signals never count as wins or losses.
- Win % shows `N/A`, never `0%`, with zero completed trades.
- Same-candle TP/SL ambiguity is reported honestly, never guessed.

## PWA & branding

- Installable on iPhone/Android/desktop; offline app shell; service worker
  explicitly never caches market data (so a stale cache can never look live).
- Custom "Trade Smart" icon set (192/512/maskable) and a real multi-resolution
  favicon, generated from your uploaded artwork.
- Muted, non-flashy color palette; proper Title Case throughout (no more
  shouting ALL-CAPS UI text).

## Testing

- **88 automated tests**, all passing, covering every engine above — including
  regression tests for the two real bugs found and fixed this session (ADX
  going over 100, R:R silently exceeding its max, and open trades never
  resolving).
- A custom import/export consistency checker runs on every change to catch
  broken module wiring before it ships.

## Documentation (in `docs/`)

`ARCHITECTURE.md`, `DATA_PROVIDERS.md`, `LIMITATIONS.md` (honest, itemized),
`STRATEGIES.md`, `RISK.md`, `STORAGE.md`, `DEPLOYMENT.md`, `PWA.md`,
`PHASE2_IOS.md`, `TEST_RESULTS.md`.

## Explicitly out of scope for Phase 1 (and why)

- **News/AI-reaction trading, order-flow/footprint trading** — both need paid
  data (live news feed, Level 2 order book) with no free equivalent.
- **True real-time (non-delayed) Stocks/Forex data** — possible via Alpaca
  (stocks) or OANDA demo (forex), but both need a separate account signup and
  have unverified CORS behavior for direct browser use — flagged as a future
  option, not silently promised.
- **Cross-device sync, push notifications, hourly background scanning** —
  all genuinely need a cloud database and/or a scheduled backend; scoped and
  discussed, not built, since it's a real architecture change (and the first
  point actual ongoing cost could enter the picture).
