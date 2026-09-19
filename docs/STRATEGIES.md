# Strategy Documentation

Every strategy is an independent module (`js/strategies/*.js`) implementing the
same interface: `id, name, description, market, applicableRegime, timeframe,
minRR, entryConditions, confirmationConditions, stopLogic, targetLogic,
invalidations, evaluate(ctx)`. `evaluate()` returns a raw candidate or `null`
— it never itself decides confidence, sizing, or final accept/reject; those
are the confirmation/confidence/target/risk/no-trade engines' jobs.

## US Stocks (8)

| Strategy | Entry | Stop | Target | Min R:R |
|---|---|---|---|---|
| Opening Range Breakout + Volume | Close beyond first-6-bar (≈30min) range with RVOL ≥1.5x | Opposite side of opening range | Structure/2x ATR | 2:1 |
| Breakout + Volume | Close beyond 20-bar range, RVOL ≥1.5x, rising ADX | Beyond the breakout base | Measured move | 2:1 |
| Breakout Retest | Retest of a broken structure level that holds | Just beyond retested level | Next structural level | 2:1 |
| Trend Pullback | Pullback to EMA20 within an established trend | Beyond most recent swing | Prior swing extreme/2x ATR | 2:1 |
| VWAP Reclaim/Rejection | Close reclaims/rejects session VWAP with volume | Opposite extreme of the signal candle | Next S/R level/ATR | 1.5:1 |
| Relative Strength Breakout | Breakout with ≥0.5% return spread vs. SPY over 20 bars | Beyond breakout base | Measured move | 2:1 |
| Bollinger Band Mean Reversion | Touches/pierces the outer 20,2 Bollinger Band while regime is Range | Just beyond the touched band | Middle band (20-SMA) | 1.5:1 |
| Gap and Go | Session opens ≥1% from prior close and holds on RVOL ≥1.5x | Back through today's open | 2.5x ATR | 2:1 |

## Forex (5)

| Strategy | Entry | Stop | Target | Min R:R |
|---|---|---|---|---|
| London Breakout | Break of pre-London range at London open | Opposite side of pre-London range | Measured move | 2:1 |
| London/New York Overlap Momentum | Fresh trend continuation during the overlap window | Most recent swing | 2.5x ATR | 2:1 |
| Trend Pullback | Pullback to EMA20 within an FX trend, RSI resetting | Beyond most recent swing | Prior swing extreme/2x ATR | 2:1 |
| Liquidity Sweep + Reversal | Wick sweep beyond a swing extreme, closes back inside | Beyond the sweep wick | Opposite side of range | 1.5:1 |
| Support/Resistance Rejection | Rejection at a ≥2-touch level | Just beyond the level | Opposite side of range | 1.5:1 |

## Crypto (6)

| Strategy | Entry | Stop | Target | Min R:R |
|---|---|---|---|---|
| Breakout + Retest | Retest of a broken level that holds | Beyond retested level | Measured move | 2:1 |
| Trend Pullback | Pullback to EMA20 within a crypto trend, ADX ≥15 | Beyond most recent swing | Prior swing extreme/2x ATR | 2:1 |
| Volatility Compression → Expansion | Strong directional candle out of an ATR-compression regime | Opposite side of compression range | 2x ATR | 2:1 |
| VWAP Reclaim | Close reclaims rolling VWAP with RVOL ≥1.1x | Below reclaim candle low | Next S/R/1.5x ATR | 1.5:1 |
| Liquidity Sweep Reversal | Wick sweep beyond swing extreme, closes back inside | Beyond sweep extreme | Opposite side of range | 1.5:1 |
| EMA 9/20 Momentum Cross | EMA9 crosses EMA20 with ADX ≥20 | Most recent swing | 2.5x ATR | 2:1 |

### Why these three were added (Sept 2026 update)

A review of current (2026) retail day-trading strategy coverage found three
widely-used categories the original 16 strategies didn't cover:

- **Bollinger Band Mean Reversion** — explicitly one of the most common
  reversal/range setups in current trading guides, and the app previously had
  range-fade coverage for forex/crypto (Liquidity Sweep, S/R Rejection) but
  nothing for US stocks specifically built around bands.
- **Gap and Go** — one of the most widely used opening-session stock
  strategies; the app had opening-range and breakout coverage but nothing
  keyed off the actual overnight gap.
- **EMA 9/20 Momentum Cross** — a very common fast-momentum trigger,
  especially suited to crypto's pace, that the existing EMA20/50 pullback
  strategies didn't cover (a crossover trigger is a different signal than a
  pullback-to-level trigger).

**Not added, and why:** news/AI-reaction trading and order-flow/footprint
trading are both prominent in current 2026 discussion, but neither is
feasible within this app's zero-cost, no-account architecture — the first
needs a live news feed, the second needs Level 2 order-book data. Both are
paid data products with no free equivalent; faking either would violate the
project's "never fabricate market data" rule. See `docs/LIMITATIONS.md`.

All three new strategies read from the exact same `ctx` object (candles,
indicators, structure, regime) the scanner already builds once per symbol —
adding them required zero additional data fetches, per the architecture
described below.

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

## How much historical data each screen actually uses

| Context | Candles fetched | Approx. real time covered |
|---|---|---|
| Live scan (`CHECK FOR TRADE`) | 200 | Stocks (15m bars, regular session only): ~7–8 trading days. Forex/crypto (1h bars, continuous): ~8 days. |
| Journal live-price / pace estimate | 30 | Just enough for a 14-period ATR reading — this fetch is for "what's the price and typical pace right now," not for strategy decisions. |
| Backtest | 500 | Roughly 2.5x the live-scan window — deliberately deeper so a backtest isn't limited to the same short lookback a live scan uses. |

Within that fetched window, individual calculations look back much less far:

| Calculation | Bars used |
|---|---|
| EMA20 / EMA50 | 20 / 50 |
| RSI14, ATR14, ADX14 (Wilder-smoothed) | 14 (warms up over the first ~14–28 bars) |
| RVOL, realized volatility | 20-bar rolling window |
| Swing/structure detection (`findSwings`) | 3-bar fractal (a bar must be the extreme of 3 bars on each side) |
| Opening Range Breakout (US stocks) | First 6 bars of the fetched window |
| Breakout + Volume, Relative Strength Breakout, Breakout+Retest (crypto) | Prior 20 bars |
| London Breakout (pre-London range proxy) | Prior 16 bars (~4h of 15m bars) |
| Volatility Compression → Expansion (crypto) | Prior 12 bars |
| Trend Pullback, Liquidity Sweep, S/R Rejection strategies | Most-recent swing only (from the 3-bar fractal detection above), not a fixed bar count |

One thing worth being upfront about: earlier builds also computed a 200-period EMA, but since the live scanner only ever fetches exactly 200 candles, that indicator could never have more than a single valid data point — it was never actually usable, and nothing read it. It's been removed as dead weight; if longer-term trend context is wanted later, the right fix is fetching more candles *and* adding it back, together.

## Multi-timeframe note

Phase 1 strategies primarily reason over a single "trading timeframe" per
market (15m for US stocks, 1h for forex/crypto) enriched with structure/regime
computed over that same series' longer lookback window, rather than fetching
and reconciling three separate HTF/LTF/entry-timeframe series per scan (a
deliberate simplification to stay within free-tier rate limits — see
`docs/LIMITATIONS.md`). Trend-alignment confirmation still checks that the
regime engine's trend read agrees with the trade direction before qualifying.
