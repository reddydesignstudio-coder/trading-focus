# Risk Management Documentation

## Defaults

| Setting | Default |
|---|---|
| Account Balance | $1,000 |
| Risk per Trade | 2% |
| Maximum Risk | $20 |
| Default R:R | 1:2 |
| Maximum R:R | 1:3 |

All configurable in **Settings**, persisted in IndexedDB.

## Position sizing formula

```
dollarRisk = min(accountBalance × riskPercent, maxRiskOverrideUSD ?? Infinity)
perUnitRisk = |entryPrice − stopLoss|
positionSize (units) = dollarRisk / perUnitRisk
potentialReward = dollarRisk × R:R
```

This is implemented once, in `js/risk.js#computePositionSize` /
`recalculateTrade`, and used identically by the scanner, the trade-confirmation
modal (when you pick an actual entry inside the entry zone), and the
backtester — one formula, everywhere.

## Confidence never changes risk

`recalculateTrade()` and `computePositionSize()` take **no confidence
parameter at all**. A 95/100 setup and a 65/100 setup with the same
entry/stop risk exactly the same dollar amount. This is enforced structurally,
not just by convention — see `tests/risk.test.js` for a test that documents
this directly.

## R:R enforcement

- A candidate is **rejected** if its realistic R:R (after the target engine
  caps the target at the nearest opposing structure) falls below the
  strategy's own minimum R:R (1.5:1 or 2:1 depending on strategy — never
  below 1.5:1).
- A candidate is **flagged but not rejected** if its R:R exceeds the
  configured maximum (default 1:3) — the UI shows a note suggesting the
  target may be unrealistic, but doesn't block the trade, since a very
  favorable structural target isn't inherently wrong.

## Actual entry selection

When you tap **Paper Trade**, you can adjust the actual entry price within (or
near) the signal's entry zone. Every change **immediately recalls**
`recalculateTrade()`, which:
1. Recomputes position size from the new entry/stop distance.
2. Recomputes dollar risk (still capped at the account's max).
3. Recomputes potential reward and R:R.
4. **Rejects** the trade outright if the new entry puts stop/target on the
   wrong side of price for the direction, or if resulting R:R falls below the
   strategy's minimum.

## Why this matters

The spec-level failure mode this guards against is "the setup looked
great so I risked more." The risk engine has no code path that can increase
dollar risk in response to setup quality — sizing is a pure function of
account balance, risk %, entry, and stop.
