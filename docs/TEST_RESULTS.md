# Test Results

Run with: `npm test` (`node --test tests/*.test.js`), Node v22.

```
tests 56
pass 56
fail 0
cancelled 0
skipped 0
```

## Coverage by suite

| File | Focus |
|---|---|
| `tests/indicators.test.js` | EMA, SMA, RSI (bounds + edge cases: all-up/all-down), MACD histogram identity, ATR non-negativity, ADX bounded 0-100, session VWAP reset, RVOL spike detection |
| `tests/risk.test.js` | Max dollar risk (% and override), position sizing math, R:R rejection below minimum, confidence-independence of risk sizing, max-R:R capping (flagged not silently exceeded), wrong-side stop/target rejection |
| `tests/tradeResolution.test.js` | WIN/LOSS/OPEN determinism, same-candle AMBIGUOUS (never guessed), smaller-timeframe disambiguation, short-trade inverted logic, P&L/R-multiple computation |
| `tests/performance.test.js` | Win % is `N/A` (not `0%`) with zero completed trades, win % excludes open/ambiguous, net P&L / ending balance, profit factor, expectancy, max drawdown from equity curve, missed signals never count as W/L, per-strategy breakdown excludes open trades |
| `tests/confidence.test.js` | Weights sum to 100, score never exceeds max, breakdown sums to total, label tiers |
| `tests/confirmation.test.js` | Minimum-2 enforcement, category de-duplication, zero-evidence candidate fails |
| `tests/targetEngine.test.js` | Direct level target, structure-capping, rejection instead of forcing unrealistic R:R, ATR-multiple fallback, zero-stop-distance rejection |
| `tests/timezone.test.js` | DST correctness for New York (EST/EDT) and London (GMT/BST) via `Intl`, weekday session gating, London/NY overlap detection, dead-of-night no-active-session case |
| `tests/scanner.integration.test.js` | End-to-end `CHECK FOR TRADE` pipeline against demo data for all 3 markets — verifies no throws, well-formed qualifying setups (valid entry zone, confidence 0-100, ≥2 confirmations, R:R ≥1 or null), and that a zero-qualifying result is handled without forcing a count |

## Notable bug caught and fixed during testing

The initial ADX implementation reused the same "Wilder sum-style smoothing"
function used for TR/+DM/-DM to also smooth DX into ADX. That produces
unbounded values (ADX going above 100) because ADX must be a **moving
average** of DX, not an accumulating sum. Fixed by adding a dedicated
`wilderAverage()` function (seeded simple average, then Wilder-smoothed
average) — confirmed by `tests/indicators.test.js`'s
`"adx produces values between 0 and 100 once seeded"` test, which failed
before the fix and passes after.

## Manual / structural verification also performed

- `node --check` on every `.js` file in `js/` — all pass (no syntax errors).
- All `<script src>` / `<link href>` references in `index.html` verified to
  point at files that exist in the repo.
- Full acceptance-test chain (see `README.md` / `docs/ARCHITECTURE.md` data
  flow diagram) exercised via `tests/scanner.integration.test.js` end-to-end
  against demo data, covering: session/time read → market focus → scan →
  indicators/structure/regime → strategy evaluation → confirmation →
  confidence → entry zone/target → risk/sizing → no-trade filtering →
  qualifying-setup output. The remaining links (paper trade → monitor →
  resolve → journal → daily summary → performance) are exercised by the
  paper-trading, trade-resolution, and performance unit tests and are wired
  together in `js/ui/views.js`; they require a browser (IndexedDB) to run
  live, so were verified by code review + the underlying unit tests rather
  than a browser-automation test in this environment (no headless browser
  available in the sandboxed build environment).
