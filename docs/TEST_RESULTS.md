# Test Results

Run with: `npm test` (`node --test tests/*.test.js`), Node v22.

```
tests 93
pass 93
fail 0
cancelled 0
skipped 0
```

## Coverage by suite

| File | Focus |
|---|---|
| `indicators.test.js` | EMA, SMA, RSI, MACD, ATR, ADX, session VWAP, RVOL, and the pace-estimate helper |
| `risk.test.js` | Position sizing, R:R rejection below minimum, target-capping at max R:R, confidence-independence of sizing |
| `tradeResolution.test.js` | WIN/LOSS/OPEN determinism, same-candle AMBIGUOUS (never guessed), smaller-timeframe disambiguation |
| `tradeMonitor.test.js` | End-to-end: an OPEN trade whose price has since hit TP/SL actually gets resolved (regression test for the live paper-trading resolution bug) |
| `performance.test.js` | Win % is `N/A` with zero completed trades, profit factor, expectancy, drawdown, per-strategy breakdown |
| `confidence.test.js` | 100-point weight total, score bounds, breakdown-sums-to-total, label tiers |
| `confirmation.test.js` | Minimum-2 enforcement, category de-duplication, Range-regime credit |
| `targetEngine.test.js` | Structure-capped targets, rejection instead of forcing unrealistic R:R |
| `timezone.test.js` | DST correctness (NY, London), session gating, overlap detection |
| `marketFocus.test.js` | The live "Good/Fair/Weak/Closed" trading-window verdict across all three markets and times of day |
| `dataProviderRotation.test.js` | Automatic fallback from a rate-limited primary Twelve Data key to the backup key, then to demo data if both are limited |
| `newStrategies.test.js` | Trigger-condition correctness for Bollinger Mean Reversion, Gap and Go, and EMA 9/20 Momentum Cross |
| `plainEnglish.test.js` | Every registered strategy (all 19) has a real, jargon-free, direction-aware plain-English explanation — not the generic fallback |
| `pinLock.test.js` | PIN setup stores a hash (never the plain PIN), correct/incorrect verification, overwriting an existing PIN |
| `paperTrading.test.js` | Live Mode refuses to execute a trade sourced from demo data |
| `scanner.integration.test.js` | End-to-end `CHECK FOR TRADE` pipeline against demo data for all 3 markets — well-formed qualifying setups, zero-qualifying handled without forcing a count |

## Notable things caught during testing (kept here as a running record)

- **ADX unbounded above 100** — an early implementation reused sum-style
  Wilder smoothing (meant for TR/±DM) to also smooth DX into ADX. Fixed with
  a dedicated `wilderAverage()`; caught by `indicators.test.js`.
- **R:R silently exceeding the configured maximum** — `recalculateTrade()`
  flagged an over-max R:R but never actually pulled the take-profit in, so a
  structural target 7-8x the risk away could display as "1:7.48" even with a
  1:3 max configured. Fixed to actually cap the take-profit price; caught by
  `risk.test.js`.
- **Open trades never resolving** — the trade-resolution engine
  (`tradeResolution.js`) was fully correct and tested, but was only ever
  wired into the Backtester — nothing checked live paper trades against
  fresh prices, so a trade that had genuinely hit TP/SL just stayed "OPEN"
  forever. Fixed with `checkAndResolveOpenTrades()`, wired into Home,
  Journal, and Today; caught (and now regression-tested) by
  `tradeMonitor.test.js`.
- **Range regime never earning "regime" confirmation credit** — found while
  adding Bollinger Mean Reversion: `checkRegime()` only credited
  trend/breakout regimes, so every existing range-fade strategy (Liquidity
  Sweep, S/R Rejection) was already silently losing a confirmation category
  it should have gotten. Fixed for all range-fade strategies at once.
- **The PIN lock would have destroyed the app on unlock** — the first draft
  rendered the lock screen into the same `#app` container that holds the
  header/content/nav structure `app.js` depends on; clearing it for the PIN
  screen and clearing it again on unlock would have deleted those elements
  permanently, leaving the app blank after a successful unlock. Fixed by
  giving the PIN screen its own overlay appended to `<body>`, entirely
  separate from `#app`'s internal structure. Caught by tracing the DOM
  structure before shipping, not by a failing test — a good reminder that
  structural/rendering bugs like this need a manual trace, since they don't
  show up in logic-level unit tests.

## Manual / structural verification also performed

- `node --check` on every `.js` file — no syntax errors.
- A custom import/export consistency script verifies every named import
  actually matches a named export in its target file, across the whole
  codebase, on every change.
- Full acceptance-test chain exercised end-to-end against demo data via
  `scanner.integration.test.js`; the paper-trade → monitor → resolve →
  journal → daily summary → performance chain is covered by the
  paper-trading, trade-monitor, and performance unit tests together.
