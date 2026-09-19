// js/marketFocus.js
//
// Market Focus Engine
// --------------------------------------------------------------
// Combines the session engine with static, documented liquidity/
// volatility heuristics per session to recommend which market is
// most suitable to *analyze* right now. This is a suitability
// recommendation, NOT a profitability or price prediction.

import { getSessionStatus, localParts, formatClock } from "./timezone.js";

// Documented liquidity/volatility character of each active-session combination.
// These are well-established, widely-documented market microstructure facts
// (e.g. London/NY overlap = highest FX liquidity) — not derived from live data.
const CONTEXT_RULES = [
  {
    test: (s) => s.overlaps.londonNewYork,
    market: "forex",
    liquidity: "Very High",
    volatility: "High",
    reason:
      "London and New York sessions are both open — this overlap is historically the highest-liquidity, highest-volatility window for major FX pairs.",
    strategies: ["London/New York Overlap Momentum", "Liquidity Sweep + Reversal", "Trend Pullback"],
  },
  {
    test: (s) => s.active.some((a) => a.id === "london") && !s.overlaps.londonNewYork,
    market: "forex",
    liquidity: "High",
    volatility: "Medium-High",
    reason: "London session is active. European liquidity is strong and the London Breakout window is in play.",
    strategies: ["London Breakout", "Support/Resistance Rejection"],
  },
  {
    test: (s) => s.active.some((a) => a.id === "us_premarket"),
    market: "us_stocks",
    liquidity: "Low-Medium",
    volatility: "Medium",
    reason: "US pre-market session. Volume is thin versus regular hours — useful for context, riskier for entries.",
    strategies: ["Relative Strength Breakout"],
  },
  {
    test: (s) => s.active.some((a) => a.id === "us_regular"),
    market: "us_stocks",
    liquidity: "Very High",
    volatility: "High (first hour), Medium (mid-day)",
    reason: "US regular session is open — the deepest liquidity window for US equities.",
    strategies: ["Opening Range Breakout + Volume", "Breakout + Volume", "Breakout Retest", "Trend Pullback", "VWAP Reclaim/Rejection"],
  },
  {
    test: (s) => s.active.some((a) => a.id === "us_afterhours"),
    market: "us_stocks",
    liquidity: "Low",
    volatility: "Variable (news-driven)",
    reason: "US after-hours: thin liquidity, wider spreads. Only news-driven moves tend to be tradable.",
    strategies: [],
  },
  {
    test: (s) => s.active.some((a) => a.id === "tokyo") && !s.active.some((a) => a.id === "london"),
    market: "forex",
    liquidity: "Medium",
    volatility: "Low-Medium",
    reason: "Tokyo session active on its own — moderate liquidity, JPY crosses most active.",
    strategies: ["Support/Resistance Rejection"],
  },
];

const CRYPTO_ALWAYS = {
  market: "crypto",
  liquidity: "Continuous (24/7), varies with global session overlap",
  volatility: "Continuous, historically elevated during US/EU overlap",
  reason: "Crypto markets never close. Liquidity is generally best during US/EU trading hours overlap.",
  strategies: ["Breakout + Retest", "Trend Pullback", "Volatility Compression → Expansion", "VWAP Reclaim", "Liquidity Sweep Reversal"],
};

export function computeMarketFocus(now = new Date(), timeZone) {
  const status = getSessionStatus(now);
  const matched = CONTEXT_RULES.filter((r) => r.test(status));

  // Rank candidates: equities regular session > FX overlap > FX single session > crypto (crypto is always
  // "available" but ranked below an actively strong session since it has no unique open/close edge).
  const candidates = [];
  matched.forEach((m) =>
    candidates.push({
      market: m.market,
      liquidity: m.liquidity,
      volatility: m.volatility,
      reason: m.reason,
      strategies: m.strategies,
      score: m.market === "us_stocks" && m.liquidity === "Very High" ? 100 : m.liquidity === "Very High" ? 95 : m.liquidity === "High" ? 80 : 50,
    })
  );
  candidates.push({ ...CRYPTO_ALWAYS, score: 60 });

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];

  const nextUp = status.upcoming[0];
  const nextLabel = nextUp
    ? `${nextUp.session.label} in ${formatMinutes(nextUp.minutesUntilOpen)}`
    : "No upcoming session found in the next 8 days";

  return {
    now,
    localClock: formatClock(now, timeZone),
    timeZone,
    activeSessions: status.active.map((s) => s.label),
    focus: {
      market: top.market,
      reason: top.reason,
      liquidity: top.liquidity,
      volatility: top.volatility,
      recommendedStrategies: top.strategies,
      status: top.strategies.length > 0 ? "SUITABLE" : "LOW_ACTIVITY",
      recommendedAction:
        top.strategies.length > 0
          ? `Run CHECK FOR TRADE on ${labelForMarket(top.market)} — conditions match ${top.strategies.length} available strategy setup type(s).`
          : `Conditions are thin right now. Consider waiting for ${nextLabel}, or check crypto which trades continuously.`,
    },
    nextSession: nextUp
      ? { label: nextUp.session.label, market: nextUp.session.market, minutesUntilOpen: nextUp.minutesUntilOpen }
      : null,
    allCandidates: candidates,
    disclaimer:
      "This is a session-liquidity suitability estimate based on documented market hours, not a prediction of profitable price movement.",
  };
}

function labelForMarket(m) {
  return { us_stocks: "US Stocks", forex: "Forex", crypto: "Crypto" }[m] || m;
}

function formatMinutes(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/**
 * Assesses how favorable the CURRENT moment is to trade a given market,
 * based on well-documented, time-of-day liquidity/volatility patterns
 * (opening-hour volume, the midday lull, the closing-hour pickup, the
 * London/New York overlap, etc). This is a liquidity/volatility-character
 * read for the present instant — never a prediction of where price will go.
 * Returns { verdict: "Good"|"Fair"|"Weak"|"Closed", reason }.
 */
export function assessTradingWindow(market, now = new Date()) {
  if (market === "us_stocks") {
    const p = localParts(now, "America/New_York");
    if (![1, 2, 3, 4, 5].includes(p.weekday)) {
      return { verdict: "Closed", reason: "It's the weekend — US markets are closed." };
    }
    const m = p.minutesOfDay;
    if (m < 4 * 60) return { verdict: "Closed", reason: "Outside pre-market and regular trading hours." };
    if (m < 9 * 60 + 30)
      return { verdict: "Fair", reason: "Pre-market — thin liquidity and wider spreads. Mainly relevant if there's a news catalyst." };
    if (m < 10 * 60 + 30)
      return { verdict: "Good", reason: "Opening hour — typically the highest volume and volatility of the US trading day." };
    if (m < 11 * 60 + 30)
      return { verdict: "Fair", reason: "Volume is usually still elevated here, but starting to fade from the open." };
    if (m < 14 * 60)
      return { verdict: "Weak", reason: "Midday lull — volume and volatility typically bottom out around here; more prone to choppy, directionless moves." };
    if (m < 15 * 60)
      return { verdict: "Fair", reason: "Early afternoon — volume is usually starting to pick back up ahead of the close." };
    if (m < 16 * 60)
      return { verdict: "Good", reason: "Final hour before the close — volume typically picks back up as positions get squared for the day." };
    if (m < 20 * 60) return { verdict: "Fair", reason: "After-hours — thin liquidity, wider spreads. Mainly relevant for news reactions." };
    return { verdict: "Closed", reason: "Outside all US trading hours." };
  }

  if (market === "forex") {
    const status = getSessionStatus(now);
    const nyActive = status.active.some((s) => s.id === "newyork_fx");
    const londonActive = status.active.some((s) => s.id === "london");
    const tokyoActive = status.active.some((s) => s.id === "tokyo");
    if (status.overlaps.londonNewYork)
      return { verdict: "Good", reason: "London/New York overlap — historically the highest-liquidity, highest-volatility window for major pairs." };
    if (londonActive) return { verdict: "Fair", reason: "London is open, but New York hasn't joined yet — solid liquidity, not yet at its daily peak." };
    if (nyActive) return { verdict: "Fair", reason: "New York session with London already closed — liquidity is typically lower than during the overlap." };
    if (tokyoActive) return { verdict: "Weak", reason: "Tokyo session only — thinner liquidity outside JPY crosses." };
    return { verdict: "Weak", reason: "Outside the major FX sessions — liquidity is typically thin right now." };
  }

  if (market === "crypto") {
    const status = getSessionStatus(now);
    if (status.overlaps.londonNewYork)
      return { verdict: "Good", reason: "US/EU trading hours overlap — crypto activity is typically elevated during this window too." };
    if (status.active.some((s) => ["london", "newyork_fx", "us_regular"].includes(s.id)))
      return { verdict: "Fair", reason: "A major equity/FX session is active — crypto activity tends to be a bit above its quietest hours." };
    return { verdict: "Weak", reason: "Outside US/EU trading hours — crypto liquidity is typically thinner and more prone to erratic moves overnight." };
  }

  return { verdict: "Fair", reason: "" };
}
