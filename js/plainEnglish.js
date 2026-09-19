// js/plainEnglish.js
//
// Plain-English Explanation Layer
// --------------------------------------------------------------
// Every strategy's technical `rationale` field (in js/strategies/*.js)
// stays as-is for anyone who wants the specifics (EMA20, RVOL, ADX, etc).
// This module SUPPLEMENTS that with a short, jargon-free explanation of
// why the setup showed up, written for someone with no trading
// background. It's a translation layer, not a new judgment — it explains
// the same trigger the strategy already found, in plain words.

const TEMPLATES = {
  orb_volume: (s) =>
    s.direction === "long"
      ? `In the first few minutes after the market opened, ${s.symbol} broke above the high point it set right at the open — with much heavier trading than normal. That combination (a fresh high plus a rush of volume) often means real buying interest is showing up early in the day.`
      : `In the first few minutes after the market opened, ${s.symbol} broke below the low point it set right at the open — with much heavier trading than normal. That combination (a fresh low plus a rush of volume) often means real selling pressure is showing up early in the day.`,

  breakout_volume: (s) =>
    s.direction === "long"
      ? `${s.symbol} pushed above a price ceiling it had been stuck under for a while, and trading volume picked up noticeably as it did — a sign the move has real buying behind it, not just a brief spike.`
      : `${s.symbol} broke below a price floor it had been holding above for a while, with volume picking up as it fell — a sign real selling pressure is behind the move.`,

  breakout_retest: (s) =>
    s.direction === "long"
      ? `${s.symbol} broke above a price level, then dipped back down to test that same level — and it held. When an old ceiling gets retested and holds as a new floor, that's often taken as confirmation the breakout is real, not a fake-out.`
      : `${s.symbol} broke below a price level, then bounced back up to test that same level — and it held as resistance. When an old floor gets retested and holds as a new ceiling, that's often taken as confirmation the breakdown is real.`,

  trend_pullback_us: trendPullbackText,
  trend_pullback_fx: trendPullbackText,
  trend_pullback_crypto: trendPullbackText,

  vwap_reclaim_rejection: (s) =>
    s.direction === "long"
      ? `${s.symbol} had dipped below the average price everyone's traded at today, then pushed back above it. Reclaiming that "fair value" line is often read as buyers regaining control for the session.`
      : `${s.symbol} rallied up to the average price everyone's traded at today, then got turned back below it. Getting rejected at that "fair value" line is often read as sellers regaining control for the session.`,
  vwap_reclaim_crypto: (s) =>
    `${s.symbol} had dipped below the average price it's been trading at recently, then pushed back above it with noticeably higher trading activity — often read as buyers stepping back in.`,

  relative_strength_breakout: (s) =>
    s.direction === "long"
      ? `${s.symbol} isn't just going up — it's going up noticeably faster than the broader market right now. Stocks that outperform during a broad move are often the ones getting extra attention.`
      : `${s.symbol} isn't just going down — it's falling noticeably faster than the broader market right now, a sign it may be out of favor relative to its peers.`,

  bollinger_mean_reversion_us: (s) =>
    s.direction === "long"
      ? `${s.symbol} stretched unusually far below its recent average price — farther than it typically does — and then snapped back. Big stretches away from the average often "rubber-band" back toward it, especially when the stock isn't in a strong trend either way.`
      : `${s.symbol} stretched unusually far above its recent average price and then snapped back down. Big stretches away from the average often "rubber-band" back toward it, especially when the stock isn't in a strong trend either way.`,

  gap_and_go: (s) =>
    s.direction === "long"
      ? `${s.symbol} opened today noticeably higher than where it closed yesterday, and instead of fading back down, it's continuing to push higher on strong volume. Stocks that hold their opening jump, rather than filling it back in, often keep running in that direction.`
      : `${s.symbol} opened today noticeably lower than where it closed yesterday, and instead of bouncing back, it's continuing to push lower on strong volume. Stocks that hold their opening drop, rather than filling it back in, often keep running in that direction.`,

  london_breakout: (s) =>
    s.direction === "long"
      ? `Right as the London trading session opened, this pair broke above the range it had traded in overnight. The London open is one of the busiest times of day for currency trading, and breakouts right at that open often carry real follow-through.`
      : `Right as the London trading session opened, this pair broke below the range it had traded in overnight. The London open is one of the busiest times of day for currency trading, and breakdowns right at that open often carry real follow-through.`,

  london_ny_overlap_momentum: (s) =>
    s.direction === "long"
      ? `This pair is trending upward, and it's doing so during the hour or two when both the London and New York trading desks are active at once — historically the busiest, most liquid stretch of the day for currencies. Moves during this overlap tend to be taken more seriously.`
      : `This pair is trending downward, and it's doing so during the hour or two when both the London and New York trading desks are active at once — historically the busiest, most liquid stretch of the day for currencies. Moves during this overlap tend to be taken more seriously.`,

  liquidity_sweep_reversal_fx: liquiditySweepText,
  liquidity_sweep_reversal_crypto: liquiditySweepText,

  sr_rejection_fx: (s) =>
    s.direction === "long"
      ? `Price fell into a level that's acted like a floor multiple times before, and bounced off it again. A level that keeps holding tends to be trusted more each time it does.`
      : `Price rallied into a level that's acted like a ceiling multiple times before, and got turned back down from it again. A level that keeps rejecting price tends to be trusted more each time it holds.`,

  breakout_retest_crypto: (s) =>
    s.direction === "long"
      ? `${s.symbol} broke above a price level, then dipped back down to test it — and it held. When an old ceiling gets retested and holds as a new floor, that's often taken as confirmation the breakout is real.`
      : `${s.symbol} broke below a price level, then bounced back up to test it — and it held as resistance. When an old floor gets retested and holds as a new ceiling, that's often taken as confirmation the breakdown is real.`,

  volatility_compression_expansion: (s) =>
    s.direction === "long"
      ? `${s.symbol} had been trading in an unusually tight, quiet range — the calm before a likely move — and it just broke out of that tightness to the upside with real force. Quiet, squeezed-in price action often precedes a sharp move once it finally breaks.`
      : `${s.symbol} had been trading in an unusually tight, quiet range — the calm before a likely move — and it just broke down out of that tightness with real force. Quiet, squeezed-in price action often precedes a sharp move once it finally breaks.`,

  ema_momentum_cross_crypto: (s) =>
    s.direction === "long"
      ? `A fast-moving average of ${s.symbol}'s recent price just crossed above a slower-moving one, and a trend-strength check confirms this isn't just noise. This kind of crossover is one of the oldest, simplest ways traders spot a shift in short-term momentum.`
      : `A fast-moving average of ${s.symbol}'s recent price just crossed below a slower-moving one, and a trend-strength check confirms this isn't just noise. This kind of crossover is one of the oldest, simplest ways traders spot a shift in short-term momentum.`,
};

function trendPullbackText(s) {
  return s.direction === "long"
    ? `${s.symbol} has been climbing steadily, and it just pulled back to a trend line it's bounced off before. Buying dips within an uptrend, right at a level that's held before, is one of the more traditional, lower-drama ways to join a trend.`
    : `${s.symbol} has been falling steadily, and it just rallied back up to a trend line it's been rejected from before. Selling bounces within a downtrend, right at a level that's held before, is one of the more traditional, lower-drama ways to join a trend.`;
}

function liquiditySweepText(s) {
  return s.direction === "long"
    ? `Price briefly spiked below a recent low — often a sign that stop-loss orders got triggered — and then immediately reversed back up. This kind of quick fake-out below a level, followed by a snap-back, is a classic sign the initial move was just clearing out weak positions rather than a real breakdown.`
    : `Price briefly spiked above a recent high — often a sign that stop-loss orders got triggered — and then immediately reversed back down. This kind of quick fake-out above a level, followed by a snap-back, is a classic sign the initial move was just clearing out weak positions rather than a real breakout.`;
}

function genericExplain(s) {
  const verb = s.direction === "long" ? "an upward" : "a downward";
  return `${s.symbol} is showing a pattern that has historically favored ${verb} move, and it cleared this app's confirmation and risk checks.`;
}

/** Translates a fully-built signal (has symbol, direction, strategyId) into a jargon-free explanation. */
export function explainPlainEnglish(signal) {
  const template = TEMPLATES[signal.strategyId];
  if (!template) return genericExplain(signal);
  return template(signal);
}
