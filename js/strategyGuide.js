// js/strategyGuide.js
//
// Strategy Guide — general reference, not signal-specific
// --------------------------------------------------------------
// plainEnglish.js explains a SPECIFIC signal that already fired
// ("here's why THIS setup showed up right now"). This module is
// different: it's a standing reference for each strategy — what it
// generally looks for and why that pattern is thought to matter —
// available whether or not anything has fired. Written for someone
// with no trading background, same spirit as plainEnglish.js.

export const STRATEGY_GUIDE = {
  // ---- US Stocks ----
  orb_volume: {
    when: "In the first several minutes after the market opens, if price breaks above or below the high/low it set in that opening window, together with noticeably heavier-than-normal trading.",
    why: "The opening minutes often set the tone for the day. A break of that early range on strong volume is taken as a sign real buyers or sellers are committing early, not just noise.",
  },
  breakout_volume: {
    when: "When price pushes above a ceiling (or below a floor) it had been stuck at for a while, and trading volume picks up noticeably as it does.",
    why: "A price level holds because buyers and sellers keep disagreeing there. When it finally breaks with real volume behind it, that's read as one side decisively winning — not just a brief poke through.",
  },
  breakout_retest: {
    when: "After a breakout above a level, price dips back down to that same level and holds — instead of falling back through it.",
    why: "A level that used to be a ceiling often becomes a new floor once broken. Watching it get tested and hold is a common way to confirm the breakout was real, rather than acting the instant it happens.",
  },
  trend_pullback_us: {
    when: "The stock is in a clear, established trend, and briefly pulls back toward a key moving average before showing signs of resuming in the trend's original direction.",
    why: "Trends rarely move in a straight line — they pause and pull back along the way. Buying (or selling) those pullbacks, rather than chasing new highs/lows, is a long-standing way to join an existing trend at a better price.",
  },
  vwap_reclaim_rejection: {
    when: "Price dips below the day's volume-weighted average price (VWAP) and pushes back above it, or rallies up to VWAP from below and gets turned back down.",
    why: "VWAP is roughly \"the average price everyone traded at today\" — it's watched closely by larger traders. Reclaiming or losing that line is often read as a shift in who's in control for the rest of the session.",
  },
  relative_strength_breakout: {
    when: "The stock is moving noticeably more (up or down) than the broader market (measured against SPY) while also showing its own breakout pattern.",
    why: "A stock outperforming the whole market during a broad move often has something specific to it driving extra attention — that relative strength is treated as an added piece of evidence, not just the breakout alone.",
  },
  bollinger_mean_reversion_us: {
    when: "Price stretches unusually far from its recent average (outside its normal Bollinger Band range) while the stock isn't in a strong trend, then starts snapping back toward the average.",
    why: "In a genuinely range-bound stock, big stretches away from the average tend to \"rubber-band\" back. This strategy specifically avoids strongly trending stocks, where a stretch might just be the start of a bigger move rather than something to fade.",
  },
  gap_and_go: {
    when: "The stock opens today noticeably higher or lower than yesterday's close, and instead of filling that gap back in, keeps pushing further in the same direction on strong volume.",
    why: "A gap that holds (rather than getting immediately erased) suggests the news or sentiment behind it is strong enough that the crowd isn't rushing to fade it — those tend to keep running longer than gaps that get filled right away.",
  },

  // ---- Forex ----
  london_breakout: {
    when: "Right as the London trading session opens, price breaks out of the range it had been trading in overnight.",
    why: "London is one of the busiest forex trading windows of the day. A breakout right at that open often has real volume and participation behind it, rather than being a quiet overnight drift.",
  },
  london_ny_overlap_momentum: {
    when: "During the few hours where the London and New York sessions overlap — the busiest window in forex — price shows a strong, clear directional push.",
    why: "This overlap sees the highest trading volume of the day. Momentum that shows up here is considered more reliable than the same move during a quieter session.",
  },
  trend_pullback_fx: {
    when: "The pair is in an established trend and pulls back toward a key moving average before showing signs of resuming.",
    why: "Same logic as the stock version: joining an existing trend on a pullback, rather than chasing it, is a long-standing approach to getting a better entry.",
  },
  liquidity_sweep_reversal_fx: {
    when: "Price briefly pushes past a recent high or low — just far enough to trigger other traders' stop-losses — then sharply reverses back the other way.",
    why: "Clusters of stop-losses tend to sit just beyond obvious highs/lows. A quick spike through that level, followed by an immediate reversal, is a recognized pattern of larger players deliberately triggering those stops before reversing.",
  },
  sr_rejection_fx: {
    when: "Price approaches a well-established support or resistance level and shows a clear rejection (a reversal candle or failure to close through it).",
    why: "Levels that have held multiple times in the past tend to attract attention every time price returns to them — a rejection there is one of the more basic, widely-watched patterns in trading.",
  },

  // ---- Crypto ----
  breakout_retest_crypto: {
    when: "Same as the stock version — a breakout above/below a level, followed by a retest of that level that holds.",
    why: "Confirms the breakout wasn't a brief, thin-volume spike (common in crypto) before treating it as real.",
  },
  trend_pullback_crypto: {
    when: "The coin is in an established trend and pulls back toward a key moving average before showing signs of resuming.",
    why: "Same trend-continuation logic as the stock/forex versions, adapted for crypto's generally higher volatility.",
  },
  volatility_compression_expansion: {
    when: "The coin's price range has been unusually tight (low volatility) for a while, then suddenly expands with a strong directional move.",
    why: "Periods of low volatility often precede a bigger move — this strategy waits for the actual expansion to happen, rather than guessing the timing of the squeeze.",
  },
  vwap_reclaim_crypto: {
    when: "Price dips below its recent volume-weighted average price and pushes back above it with noticeably higher trading activity.",
    why: "Similar to the stock VWAP strategy — reclaiming that average-price line, especially with real volume behind it, is read as buyers stepping back in.",
  },
  liquidity_sweep_reversal_crypto: {
    when: "Price briefly spikes past a recent high or low — often exactly where stop-losses and leveraged liquidations cluster — then sharply reverses.",
    why: "Crypto's leverage-heavy markets make this pattern especially common: a fast move that triggers a wave of forced liquidations, followed by a reversal once that pressure is exhausted.",
  },
  ema_momentum_cross_crypto: {
    when: "A short-term moving average (EMA9) crosses above or below a slightly longer one (EMA20), while the ADX indicator confirms the market is actually trending (not choppy).",
    why: "A simple moving-average cross alone gives a lot of false signals in a sideways market — requiring genuine trend strength (via ADX) alongside the cross is meant to filter those out.",
  },
};

/** Returns the guide entry for a strategy ID, or a generic fallback if one's ever missing (never throws, never shows blank). */
export function getStrategyGuide(strategyId) {
  return STRATEGY_GUIDE[strategyId] || { when: "Details for this strategy aren't written up yet.", why: "" };
}
