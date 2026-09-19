// js/scanner.js
//
// Market Scanner — "CHECK FOR TRADE"
// --------------------------------------------------------------
// Orchestrates the full pipeline requested in the spec:
//  1. Validate market status        -> marketFocus/timezone
//  2. Validate data quality         -> dataProviders status
//  3. Retrieve data                 -> dataProviders
//  4-12. Indicators/structure/regime/candles/volume/VWAP/momentum/RS
//  13-16. Strategy selection, rules, confirmation, confidence
//  17-22. Entry zone, ideal entry, SL, TP, R:R, position size
//  23. No-trade filters
//  24. Return only qualifying setups (never forced to a target count)

import { computeIndicatorSet } from "./indicators.js";
import { analyzeStructure } from "./structure.js";
import { classifyRegime } from "./regime.js";
import { getMarketData } from "./dataProviders/index.js";
import { strategiesForMarket } from "./strategies/index.js";
import { evaluateConfirmations } from "./confirmation.js";
import { computeConfidence } from "./confidence.js";
import { resolveTarget } from "./targetEngine.js";
import { recalculateTrade, DEFAULT_RISK_SETTINGS } from "./risk.js";
import { runNoTradeFilters } from "./noTrade.js";
import { getSessionStatus } from "./timezone.js";
import { uid } from "./utils.js";
import { explainPlainEnglish } from "./plainEnglish.js";

export const DEFAULT_WATCHLISTS = {
  us_stocks: ["AAPL", "MSFT", "NVDA", "TSLA", "AMD", "AMZN", "META", "GOOGL"],
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"],
  crypto: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
};

export const TIMEFRAME_BY_MARKET = {
  us_stocks: "15m",
  forex: "1h",
  crypto: "1h",
};

function sessionFlagsNow() {
  const status = getSessionStatus(new Date());
  return {
    london: status.active.some((s) => s.id === "london"),
    overlap: status.overlaps.londonNewYork,
    ny: status.active.some((s) => s.id === "newyork_fx" || s.id === "us_regular"),
    tokyo: status.active.some((s) => s.id === "tokyo"),
  };
}

/**
 * Scans one symbol against every strategy registered for `market` and
 * returns 0..N qualifying setups (plus the rejected candidates for
 * transparency, if `includeRejected` is true).
 */
export async function scanSymbol({ symbol, market, riskSettings = DEFAULT_RISK_SETTINGS, apiKeys = {}, forceProviderId, benchmarkCandles = null, includeRejected = true, signal }) {
  const timeframe = TIMEFRAME_BY_MARKET[market];
  const marketData = await getMarketData({ symbol, market, timeframe, limit: 200, apiKeys, forceProviderId, signal });

  if (!marketData.candles || marketData.candles.length < 60) {
    return {
      symbol,
      market,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      strategiesEvaluated: 0,
      qualifying: [],
      rejected: [],
      noCandidateStrategies: [],
      error: marketData.candles?.length ? null : "Insufficient historical data returned for analysis.",
    };
  }

  if (marketData.status === "STALE" || marketData.status === "UNAVAILABLE") {
    return {
      symbol,
      market,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      strategiesEvaluated: 0,
      qualifying: [],
      rejected: [],
      noCandidateStrategies: [],
      error: marketData.status === "STALE" ? "Data is stale — new signal generation disabled." : "Market data unavailable.",
    };
  }

  const candles = marketData.candles;
  const indicators = computeIndicatorSet(candles);
  const structureResult = analyzeStructure(candles);
  const regimeResult = classifyRegime(candles, indicators);

  let relativeStrengthSpread;
  if (benchmarkCandles && benchmarkCandles.length > 20) {
    const lookback = 20;
    const symReturn = (candles[candles.length - 1].c - candles[candles.length - 1 - lookback].c) / candles[candles.length - 1 - lookback].c;
    const benchReturn =
      (benchmarkCandles[benchmarkCandles.length - 1].c - benchmarkCandles[benchmarkCandles.length - 1 - lookback].c) /
      benchmarkCandles[benchmarkCandles.length - 1 - lookback].c;
    relativeStrengthSpread = (symReturn - benchReturn) * 100;
  }

  const ctx = {
    candles,
    indicators,
    structure: structureResult,
    regimeResult,
    price: candles[candles.length - 1].c,
    market,
    symbol,
    sessionFlags: sessionFlagsNow(),
    benchmarkCandles,
    relativeStrengthSpread,
  };

  const strategies = strategiesForMarket(market);
  const qualifying = [];
  const rejected = [];
  const noCandidateStrategies = [];

  for (const strategy of strategies) {
    let candidate;
    try {
      candidate = strategy.evaluate(ctx);
    } catch (e) {
      noCandidateStrategies.push({ strategyName: strategy.name, reason: "Insufficient data for this strategy's calculation." });
      continue;
    }
    if (!candidate) {
      noCandidateStrategies.push({ strategyName: strategy.name, reason: "This strategy's entry condition was not met on the latest candle." });
      continue;
    }

    const triggerCategory = inferTriggerCategory(strategy.id);
    const confirmationResult = evaluateConfirmations(ctx, candidate, triggerCategory);
    const confidenceResult = computeConfidence(ctx, candidate, confirmationResult);

    const atrNow = indicators.atr14[candles.length - 1] ?? ctx.price * 0.01;
    const targetResult = resolveTarget(candidate, candidate.idealEntry, candidate.stopLoss, atrNow, structureResult.levels);

    let sizingResult = null;
    if (!targetResult.rejected) {
      sizingResult = recalculateTrade({
        direction: candidate.direction,
        entryPrice: candidate.idealEntry,
        stopLoss: candidate.stopLoss,
        takeProfit: targetResult.finalTarget,
        settings: riskSettings,
        minRR: candidate.minRR,
      });
    }

    const noTrade = runNoTradeFilters({
      ctx,
      candidate,
      confirmationResult,
      confidenceResult,
      targetResult,
      sizingResult,
      dataStatus: marketData,
    });

    const setup = {
      id: uid("signal"),
      symbol,
      market,
      timeframe,
      generatedAt: new Date().toISOString(),
      direction: candidate.direction,
      strategyId: candidate.strategyId,
      strategyName: strategy.name,
      regime: regimeResult.regime,
      currentPrice: ctx.price,
      entryZone: candidate.entryZone,
      idealEntry: candidate.idealEntry,
      stopLoss: candidate.stopLoss,
      takeProfit: sizingResult?.valid ? sizingResult.takeProfit : targetResult.rejected ? null : targetResult.finalTarget,
      rr: sizingResult?.valid ? sizingResult.rr : targetResult.rejected ? null : targetResult.rr,
      rrCapped: sizingResult?.valid ? !!sizingResult.capped : false,
      structuralTarget: sizingResult?.valid ? sizingResult.structuralTarget : null,
      positionSize: sizingResult?.valid ? sizingResult.units : null,
      dollarRisk: sizingResult?.valid ? sizingResult.dollarRisk : null,
      potentialReward: sizingResult?.valid ? sizingResult.potentialReward : null,
      confidence: confidenceResult,
      confirmations: confirmationResult,
      rationale: candidate.rationale,
      invalidation: candidate.invalidation,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      session: sessionLabelForMarket(market, ctx.sessionFlags),
      rejected: noTrade.rejected,
      rejectionReasons: noTrade.reasons,
    };
    setup.plainEnglish = explainPlainEnglish(setup);

    if (noTrade.rejected) {
      rejected.push(setup);
    } else {
      qualifying.push(setup);
    }
  }

  return {
    symbol,
    market,
    dataStatus: marketData.status,
    isDemo: !!marketData.isDemo,
    fallbackReason: marketData.fallbackReason || null,
    strategiesEvaluated: strategies.length,
    qualifying,
    rejected: includeRejected ? rejected : [],
    rejectedCount: rejected.length,
    noCandidateStrategies: includeRejected ? noCandidateStrategies : [],
  };
}

/**
 * Scans an entire watchlist for a market. Never forces a result count —
 * returns however many symbols/strategies genuinely qualify (0..N).
 */
export async function scanMarket({ market, watchlist, riskSettings, apiKeys, forceProviderId, includeRejected = true, signal }) {
  const symbols = watchlist || DEFAULT_WATCHLISTS[market];
  let benchmarkCandles = null;
  if (market === "us_stocks") {
    try {
      const bench = await getMarketData({ symbol: "SPY", market: "us_stocks", timeframe: TIMEFRAME_BY_MARKET.us_stocks, limit: 200, apiKeys, forceProviderId, signal });
      benchmarkCandles = bench.candles;
    } catch {
      benchmarkCandles = null;
    }
  }

  const results = await Promise.all(
    symbols.map((symbol) => scanSymbol({ symbol, market, riskSettings, apiKeys, forceProviderId, benchmarkCandles, includeRejected, signal }))
  );

  const allQualifying = results.flatMap((r) => r.qualifying);
  allQualifying.sort((a, b) => b.confidence.score - a.confidence.score);

  const anyLive = results.some((r) => r.dataStatus === "LIVE" || r.dataStatus === "DELAYED" || r.dataStatus === "DEMO");
  const anyDemo = results.some((r) => r.isDemo);

  return {
    market,
    scannedAt: new Date().toISOString(),
    symbolsScanned: symbols.length,
    qualifying: allQualifying,
    perSymbol: results,
    isDemo: anyDemo,
    summary: allQualifying.length === 0 ? "NO_QUALIFYING_TRADE" : "QUALIFYING_SETUPS_FOUND",
  };
}

function inferTriggerCategory(strategyId) {
  if (strategyId.includes("breakout") || strategyId.includes("retest") || strategyId.includes("orb")) return "structure";
  if (strategyId.includes("vwap")) return "vwap";
  if (strategyId.includes("pullback")) return "trend";
  if (strategyId.includes("sweep")) return "structure";
  if (strategyId.includes("sr_rejection") || strategyId.includes("rejection")) return "support_resistance";
  if (strategyId.includes("relative_strength")) return "relative_strength";
  if (strategyId.includes("compression")) return "regime";
  if (strategyId.includes("overlap_momentum")) return "trend";
  if (strategyId.includes("bollinger")) return "support_resistance";
  if (strategyId.includes("momentum_cross")) return "trend";
  if (strategyId.includes("gap_and_go")) return "volume";
  return null;
}

function sessionLabelForMarket(market, flags) {
  if (market === "forex") {
    if (flags.overlap) return "London/New York Overlap";
    if (flags.london) return "London";
    if (flags.ny) return "New York";
    if (flags.tokyo) return "Tokyo";
    return "Off-session";
  }
  if (market === "us_stocks") return flags.ny ? "US Regular Session" : "Outside Regular Hours";
  return "24/7";
}
