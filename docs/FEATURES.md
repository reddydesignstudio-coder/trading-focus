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
- **6-digit PIN lock** — set up once on first launch, required to unlock the
  app on every subsequent open. A local screen lock only (SHA-256 hash
  stored, never the plain PIN, no account or server involved) — deters
  casual access to your device, not real encryption of the underlying data.

## Trade log & balance tracking

- **Account Balance on Home is now live** — computed from your actual Live
  Mode trade history (starting balance + realized P&L), not a static copy
  of the Settings value. Tap it to open a paginated (10-at-a-time), filterable
  (Live/Test/All, date range) list of every trade ever recorded.
- **Reusable Trade Log Browser** — one filterable, paginated trade-list
  component used consistently in the Balance drill-down, Journal, and
  Backtest results, so browsing trades feels and works the same everywhere.
- **Backtest now shows individual trades**, not just aggregate stats — a
  compact one-line list per trade (entry, holding time, result, P&L, R),
  filterable by In-Sample/Out-of-Sample. Saved backtests persist the full
  trade list, not just summary numbers, so past runs stay fully reviewable.
- **Centralized, non-blocking trade resolution** — checking open trades
  against fresh prices now happens in exactly one place (not duplicated
  across Home/Journal/Today), runs in the background so pages render
  instantly instead of waiting on it, and silently refreshes the current
  screen if something actually resolved — this fixed both a real slowness
  issue and a real inconsistency (a trade could look resolved on one screen
  and still "open" on another, since each screen was checking independently
  and out of sync).

## A new verification layer: actually running the UI, not just checking its syntax

Every prior round of fixes only ever confirmed the code was syntactically
valid (`node --check`) and that pure logic modules behaved correctly
(`node --test` against indicators, risk, performance, etc.) — but no
check ever actually EXECUTED the page-building functions in
`js/ui/views.js` the way a real browser does. That gap let two genuine,
user-facing bugs ship silently. Both were found the moment a real
runtime check was finally added.

`tests/helpers/fakeDom.js` is a deliberately minimal fake browser
(`document`, `window`, `localStorage`) — just enough surface area to
actually call `renderHome`, `renderSettings`, `renderScan`, and every
other screen and see whether they throw. `tests/viewsSmoke.test.js`
does exactly that, including the specific scenario that had never been
tested before: a completely fresh, never-configured settings object —
i.e., opening the app in a brand-new browser.

**Bugs this caught immediately:**
- **Settings page blank on any browser with an empty API key field** —
  `usageLine()` returned `null` for an empty key, and `appendChild(null)`
  throws in a real browser exactly like it does in the fake one, aborting
  the whole render. Every brand-new browser has zero saved keys, so this
  fired on the very first field, every time. This is the actual
  explanation for "Settings doesn't load in a different browser" — not
  authentication, since this app doesn't have any login requirement to
  begin with.
- **Home rendering everything twice** — found via manual tracing after
  the smoke test confirmed `renderHome` itself was NOT the problem (it
  ran cleanly and fast in isolation). Firebase's `onAuthStateChanged`
  fires once immediately upon subscription with whatever the current
  auth state already is; that immediate, harmless callback was
  registered before the real initial `setTab()` call and raced with it,
  so both renders' async pieces landed in the same container at once.

Note: `tests/viewsSmoke.test.js` must currently be run as its own
command (`node --test tests/viewsSmoke.test.js`), separate from the
rest of the suite — running it together with every other file via a
single glob causes Node's test runner itself to hang for an
undiagnosed reason unrelated to the app's own code (confirmed via
process-handle inspection: no dangling network sockets, no leaked
timers). Both commands are green.

## Twelve Data forex symbol format — a real, pre-existing bug

Twelve Data's API requires forex symbols in `BASE/QUOTE` slash format
(`EUR/USD`), not this app's internal plain format (`EURUSD`) — confirmed
against Twelve Data's own documentation. The provider was sending the
unslashed form directly, which meant Twelve Data likely never correctly
resolved a SINGLE forex request this entire build, regardless of which
pair, silently falling through to the next provider or demo data instead
every time. Fixed with a small, tested conversion function applied only
where it's needed (Twelve Data specifically — every other provider
already expected the plain format).

## XAUUSD (Gold)

Added to the default Forex watchlist. Works through the exact same
pipeline as every other forex pair — position sizing, target/stop
calculations, and the forex strategies all already work in relative
percentage or raw price-difference terms rather than assuming a
currency-pair-typical price magnitude, so gold's much higher price level
(~$2,000+) needed no special-casing anywhere except the symbol-format fix
above. If your watchlist was already saved before this update, add
XAUUSD manually via Settings → Watchlists — existing customizations are
never silently overwritten by a new default.

## Trade numbers

Journal, the Account Balance ledger, and every Backtest result now show
a `#N` trade number, assigned by true chronological order (oldest = #1)
independent of how the list is currently sorted or filtered — so "trade
#12" always refers to the same trade. Display-only (not stored on the
trade record), via a small tested function in `performance.js`.

## Fixed the real cause of "Check for Trade does nothing"

- **The service worker was serving the app cache-first** — once a browser
  cached the JS on its first visit, every reload kept serving that same
  old copy, only updating the cache quietly in the background for next
  time, with the same cache name never being cleared of stale entries.
  This meant a real fix shipped to GitHub could sit there indefinitely
  without ever actually reaching a browser that had already visited once.
  Switched to network-first (falls back to cache only when genuinely
  offline) and bumped the cache version to purge the old one. **Needs one
  hard refresh or app close/reopen after redeploying** for the new
  service worker to take over; after that it always pulls fresh code.
- Fixed the "Demo Mode" notice only checking the Twelve Data key and
  ignoring Finnhub/FMP/Alpha Vantage.

## PIN lock — removed entirely

Deleted `pinLock.js`, its tests, the Settings section, and the boot-time
lock screen. The app no longer has any lock-screen concept.

## Account Balance — now a ledger, in its own tab

- Moved out of a popup entirely — it's now **More → Account Balance**, a
  proper page, not an overlay.
- Rendered as a chronological ledger: opening balance, then one row per
  closed Live Mode trade in the order it closed, each showing that
  trade's own running balance right after it (e.g. $1000 → win → $1060 →
  loss → $1040). Test Mode trades are deliberately excluded — it's a
  separate practice balance that shouldn't mix into this number.
- The running-balance math (`buildAccountLedger` in `performance.js`) is
  a small, pure, fully unit-tested function — exactly the kind of
  arithmetic that's easy to get subtly wrong (ordering, sign, null P&L).

## Backtest — All Markets / All Symbols

- Market dropdown now has an "All Markets" option; Symbol dropdown has
  an "All Symbols" option (auto-selected and locked when "All Markets" is
  chosen, since picking one specific symbol without knowing which
  market it belongs to doesn't make sense).
- Running a multi-symbol backtest fires one independent backtest per
  symbol (every strategy for that symbol's market, same as a single-
  symbol run), then combines every resulting trade into one merged
  In-Sample/Out-of-Sample view and one trade list.
- Honest caveat shown whenever more than one symbol is combined: this
  merges independent single-symbol timelines into one chronological
  view — it is NOT a real multi-symbol portfolio simulation with shared
  capital constraints, and says so directly in the results.

## Market Pulse — "Symbols in the News," refined after feedback

Rather than declining the request outright, this now surfaces which
companies are actually NAMED in current headlines — a "Symbols in the
News" strip, ranked by how many headlines mention each one, with a
one-tap **+ Add to Watchlist** button per symbol. What it still won't
do: say what a headline means for the price, or rank symbols by
predicted opportunity — only by how often they're named, which is a
plain count, not a judgment call. Detection combines Finnhub's own
`related` field (when present) with a small, deliberately conservative
company-name→ticker list checked against the headline and summary text
— a false miss is fine (no tag shown), a false/ambiguous match is what's
avoided. Fully unit tested, including a test asserting the output is
nothing but ticker strings — never a direction, sentiment, or
recommendation field attached.

## Market Pulse — the news feature, done honestly

This app will not tell you "this headline means trade that stock" —
connecting news to a price direction is a market prediction nobody can
make reliably, and faking it would be actively misleading, not just
unhelpful. What it does instead:
- **General headlines** (Finnhub) — shown exactly as reported, no
  analysis attached.
- **News about a symbol you pick** — you choose the symbol from your
  watchlist, the app shows recent headlines specifically about that
  company (Finnhub's company-news endpoint). This is the honest version
  of "what's being said about a stock" — factual, symbol-scoped, with
  no invented connection to what the price will do.
- **Notable Activity** (unchanged from before) — a button-triggered,
  purely factual scan for elevated volume or a breakout regime in your
  watchlist, explicitly labeled "not a trade recommendation," with no
  direction/entry/confidence ever attached.

## Home page, Account Balance, and Performance additions

- **Fixed the real "Scan hangs forever" bug** — there was genuinely no
  timeout anywhere in the data layer, so a slow/unresponsive provider
  could leave a scan waiting indefinitely with zero feedback. Added a
  hard 10-second timeout per provider attempt that skips straight to the
  next provider in the chain (no wasted retries against a hung
  connection).
- **Fixed a real race condition in Reset Trade Data + Cloud Sync** —
  deletions used to fire-and-forget to Firestore; if the page reloaded
  right after a reset, an in-flight cloud deletion could get cut off,
  and the very next sync from another device would silently restore the
  "deleted" trades. `db.js` now properly awaits each cloud deletion
  before the reset flow continues, and the reset no longer forces a full
  page reload (which would've also meant re-entering your PIN
  unnecessarily) — it just returns you to Home once everything is
  actually gone, both locally and in the cloud.
- **Account Balance is inline, not a popup** — tapping it expands a
  Closed Trades section directly on the Home page (scrolls to it), showing
  only closed trades (never open ones) with the exact date/time each one
  closed, filterable by Live/Test/date range, paginated 10 at a time.
- **Session Results on the Performance Dashboard** — a new table (using
  the same `breakdownBySession` data that was already being computed,
  just not displayed there before) showing win % by trading session,
  sorted highest-win%-first among sessions with at least 3 completed
  trades — this is the direct answer to "which window do I actually win
  more in."
- **Live Mode trades/day is now configurable** (1/2/5) in Settings, with
  a note that this loosens the original one-trade-per-day discipline
  guardrail — still fully enforced, just against whichever number is
  chosen.
- **"Data Sources" card removed from Home** per request; real-vs-demo
  status remains visible via badges on every Scan result and signal card.
- **Market Pulse on Home** — two new, deliberately separate things:
  - **News headlines** (Finnhub, if a key is configured) — shown exactly
    as reported, no sentiment scoring, no "this means buy/sell X."
  - **Notable Activity** (button-triggered, not automatic) — a purely
    factual, non-strategy scan of your current-focus market's watchlist
    for elevated relative volume or a Breakout regime, explicitly labeled
    "not a trade recommendation." No direction, entry, stop, target, or
    confidence score is ever attached to these — that's deliberate and
    tested, to keep this from ever reading as a stock pick.
- **API usage tracking** — Settings now shows "X requests made this
  session" next to each provider key, against its documented free-tier
  limit where one exists.
- **Bottom nav has a bit of color now** — each tab gets an icon and its
  own muted accent color when active, without going back to the flashy
  palette from earlier.

## Latest additions (data providers, Journal, Backtest, Reset)

- **Multi-provider fallback chain for Stocks/Forex** — Finnhub, Twelve Data
  (primary+backup), FMP, and Alpha Vantage, tried automatically in order of
  how usable each free tier actually is. Every one of them is delayed on
  the free tier — none unlocks real-time data — but having four means the
  app falls back to demo mode far less often. Throttling is scoped per
  API key, not just per provider, so switching from a rate-limited key to
  a working one never means waiting out the first key's cooldown.
- **The "still shows OPEN after price passed TP" bug — found and fixed.**
  The Journal's live price display was refreshing on its own schedule,
  independently of the actual trade-resolution engine, so the two could
  disagree. Now every price refresh resolves trades first, from that same
  fresh data.
- **Journal now shows** the exact date/time each trade opened, and the
  last actual candlestick pattern detected on that symbol (factual,
  backward-looking — not a prediction of what forms next, which isn't
  something this app will ever fake).
- **Backtest redesigned**: symbol is now a dropdown that dynamically
  follows your current watchlist for whichever market is selected — no
  more typing a symbol by hand. It now always tests every strategy for
  that market automatically; manual strategy picking is gone. Results
  show as a simplified one-line-per-trade list: Symbol, Entry, Time
  Taken, Strategy, Confidence, Amount, Win/Loss.
- **Reset Trade Data** (Settings) — erases every open and closed paper
  trade plus signal history, with a typed "RESET" confirmation. Deletes
  records one at a time (not a bulk clear) specifically so each deletion
  also mirrors out to Firestore if Cloud Sync is on — a bulk clear would
  only wipe the local copy, and the next sync from another device would
  silently restore everything. Watchlists/symbols, risk settings, API
  keys, and saved backtests are untouched.

## Cloud Sync (Firebase) — optional

- Sync trades, journal, backtests, and settings across iPhone, desktop, and
  any other device signed into the same Google account — built on Firebase
  Auth (Google Sign-In) + Firestore, entirely opt-in.
- **Zero cost when unused**: the Firebase SDK is lazy-loaded only once you
  actually paste a config into Settings — nobody who doesn't want this pays
  for it in load time.
- **PIN stays local on purpose** — it's a per-device lock, not part of your
  account, so it never syncs.
- Real-time: a trade closed on your desktop appears on your iPhone within
  seconds, no manual refresh.
- Manual "Push This Device's Data" / "Pull Latest From Cloud" buttons for
  the first-time setup (getting an existing history onto a fresh device, or
  vice versa).
- **Honest caveat:** this is the one feature I can't fully test myself — it
  needs a real Firebase project with real credentials, which only you can
  create. See `docs/FIREBASE_SETUP.md` for the exact steps. The underlying
  sync mechanics (the hook that mirrors local writes outward, and the
  loop-prevention logic that stops incoming sync writes from re-triggering
  themselves) are unit tested; the live network behavior against a real
  Firebase project is not, and needs your own verification.

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
- **Push notifications, hourly background scanning** — genuinely need a
  scheduled backend (or Firebase Cloud Functions on the paid Blaze plan);
  scoped and discussed, not built, since it's a separate architecture
  decision from cross-device sync (which IS now built — see above) and the
  first point actual ongoing cost could enter the picture.
