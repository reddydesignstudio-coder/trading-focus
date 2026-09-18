# Strategy Documentation

Every strategy is an independent module (`js/strategies/*.js`) implementing the
same interface: `id, name, description, market, applicableRegime, timeframe,
minRR, entryConditions, confirmationConditions, stopLogic, targetLogic,
invalidations, evaluate(ctx)`. `evaluate()` returns a raw candidate or `null`
— it never itself decides confidence, sizing, or final accept/reject; those
are the confirmation/confidence/target/risk/no-trade engines' jobs.

## US Stocks (6)

| Strategy | Entry | Stop | Target | Min R:R |
|---|---|---|---|---|
| Opening Range Breakout + Volume | Close beyond first-6-bar (≈30min) range with RVOL ≥1.5x | Opposite side of opening range | Structure/2x ATR | 2:1 |
| Breakout + Volume | Close beyond 20-bar range, RVOL ≥1.5x, rising ADX | Beyond the breakout base | Measured move | 2:1 |
| Breakout Retest | Retest of a broken structure level that holds | Just beyond retested level | Next structural level | 2:1 |
| Trend Pullback | Pullback to EMA20 within an established trend | Beyond most recent swing | Prior swing extreme/2x ATR | 2:1 |
| VWAP Reclaim/Rejection | Close reclaims/rejects session VWAP with volume | Opposite extreme of the signal candle | Next S/R level/ATR | 1.5:1 |
| Relative Strength Breakout | Breakout with ≥0.5% return spread vs. SPY over 20 bars | Beyond breakout base | Measured move | 2:1 |

## Forex (5)

| Strategy | Entry | Stop | Target | Min R:R |
|---|---|---|---|---|
| London Breakout | Break of pre-London range at London open | Opposite side of pre-London range | Measured move | 2:1 |
| London/New York Overlap Momentum | Fresh trend continuation during the overlap window | Most recent swing | 2.5x ATR | 2:1 |
| Trend Pullback | Pullback to EMA20 within an FX trend, RSI resetting | Beyond most recent swing | Prior swing extreme/2x ATR | 2:1 |
| Liquidity Sweep + Reversal | Wick sweep beyond a swing extreme, closes back inside | Beyond the sweep wick | Opposite side of range | 1.5:1 |
| Support/Resistance Rejection | Rejection at a ≥2-touch level | Just beyond the level | Opposite side of range | 1.5:1 |

## Crypto (5)

| Strategy | Entry | Stop | Target | Min R:R |
|---|---|---|---|---|
| Breakout + Retest | Retest of a broken level that holds | Beyond retested level | Measured move | 2:1 |
| Trend Pullback | Pullback to EMA20 within a crypto trend, ADX ≥15 | Beyond most recent swing | Prior swing extreme/2x ATR | 2:1 |
| Volatility Compression → Expansion | Strong directional candle out of an ATR-compression regime | Opposite side of compression range | 2x ATR | 2:1 |
| VWAP Reclaim | Close reclaims rolling VWAP with RVOL ≥1.1x | Below reclaim candle low | Next S/R/1.5x ATR | 1.5:1 |
| Liquidity Sweep Reversal | Wick sweep beyond swing extreme, closes back inside | Beyond sweep extreme | Opposite side of range | 1.5:1 |

## Confirmation requirement (applies to every strategy)

Every candidate must clear **at least 2 independent confirmation categories**
out of: structure, trend, volume/RVOL, VWAP, momentum, support/resistance,
candlestick, regime, relative strength. A category is only counted once, and
the strategy's own trigger condition (e.g. "structure" for a breakout
strategy) doesn't by itself satisfy the minimum — the confirmation engine
tracks a `bonusCount` of confirmations beyond the trigger for exactly this
reason. See `js/confirmation.js`.

## Confidence scoring (applies to every strategy)

100-point breakdown, weights configurable in `js/confidence.js`:

| Component | Weight |
|---|---|
| Market Structure | 20 |
| Momentum | 15 |
| Volume | 15 |
| VWAP | 10 |
| Support/Resistance | 15 |
| Candlestick | 10 |
| Relative Strength | 10 |
| Market Regime | 5 |

This is a **setup-quality score**, never a win-probability estimate.

## Multi-timeframe note

Phase 1 strategies primarily reason over a single "trading timeframe" per
market (15m for US stocks, 1h for forex/crypto) enriched with structure/regime
computed over that same series' longer lookback window, rather than fetching
and reconciling three separate HTF/LTF/entry-timeframe series per scan (a
deliberate simplification to stay within free-tier rate limits — see
`docs/LIMITATIONS.md`). Trend-alignment confirmation still checks that the
regime engine's trend read agrees with the trade direction before qualifying.
