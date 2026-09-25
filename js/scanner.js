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
import { startScanLog } from "./scanLogger.js";
import { getEffectiveThresholds } from "./strategyThresholds.js";

export const DEFAULT_WATCHLISTS = {
  us_stocks: ["AAPL", "MSFT", "NVDA", "TSLA", "AMD", "AMZN", "META", "GOOGL"],
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "XAUUSD"],
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
export async function scanSymbol({ symbol, market, riskSettings = DEFAULT_RISK_SETTINGS, apiKeys = {}, forceProviderId, benchmarkCandles = null, includeRejected = true, signal, log = null, settings = {} }) {
  const timeframe = TIMEFRAME_BY_MARKET[market];
  log?.entry("info", symbol, "Starting scan");

  let marketData;
  try {
    marketData = await getMarketData({ symbol, market, timeframe, limit: 200, apiKeys, forceProviderId, signal });
  } catch (e) {
    // A genuinely unexpected failure fetching data for THIS symbol must
    // never take the rest of the watchlist down with it — this is the
    // per-symbol isolation boundary. scanMarket's Promise.all only stays
    // safe because every path through this function returns a normal
    // result object instead of letting an exception propagate.
    log?.entry("error", symbol, "Data fetch threw an unexpected error", { message: e.message, name: e.name });
    return {
      symbol,
      market,
      dataStatus: "UNAVAILABLE",
      isDemo: false,
      lastCandleTime: null,
      source: null,
      strategiesEvaluated: 0,
      qualifying: [],
      rejected: [],
      noCandidateStrategies: [],
      error: "Unexpected error fetching market data for this symbol.",
    };
  }

  const lastCandleTime = marketData.candles?.length ? new Date(marketData.candles[marketData.candles.length - 1].t).toISOString() : null;
  log?.entry("info", symbol, `Candle fetch complete — source: ${marketData.source || "unknown"}`, {
    candleCount: marketData.candles?.length || 0,
    status: marketData.status,
    source: marketData.source || null,
    fromPersistentCache: !!marketData.fromPersistentCache,
    lastCandleTime,
  });

  if (!marketData.candles || marketData.candles.length < 60) {
    log?.entry("warn", symbol, "Insufficient candles for analysis", { candleCount: marketData.candles?.length || 0 });
    return {
      symbol,
      market,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      lastCandleTime,
      source: marketData.source || null,
      strategiesEvaluated: 0,
      qualifying: [],
      rejected: [],
      noCandidateStrategies: [],
      error: marketData.candles?.length ? null : "Insufficient historical data returned for analysis.",
    };
  }

  if (marketData.status === "STALE" || marketData.status === "UNAVAILABLE") {
    log?.entry("warn", symbol, "Data not fresh enough to scan", { status: marketData.status });
    return {
      symbol,
      market,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      lastCandleTime,
      source: marketData.source || null,
      strategiesEvaluated: 0,
      qualifying: [],
      rejected: [],
      noCandidateStrategies: [],
      error: marketData.status === "STALE" ? "Data is stale — new signal generation disabled." : "Market data unavailable.",
    };
  }

  try {
    const candles = marketData.candles;
    const indicators = computeIndicatorSet(candles);
    const structureResult = analyzeStructure(candles);
    const regimeResult = classifyRegime(candles, indicators);
    log?.entry("info", symbol, "Indicators and regime computed", { regime: regimeResult.regime });

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
    const strategyDataQuality = []; // one entry per strategy: required/recommended/fetched/status — shown in the UI and the scan log

    log?.entry("info", symbol, `Fetching ${timeframe} candles — fetched ${candles.length}`, { timeframe, fetched: candles.length });

    for (const strategy of strategies) {
      const minCandles = strategy.minCandles || 60;
      const recommendedCandles = strategy.recommendedCandles || minCandles;

      if (candles.length < minCandles) {
        log?.entry(
          "warn",
          symbol,
          `Fetching ${timeframe} candles for "${strategy.name}" (required ${minCandles}, fetched ${candles.length}, source: ${marketData.source || "unknown"}) — DISABLED, not enough history`,
          { timeframe, required: minCandles, recommended: recommendedCandles, fetched: candles.length, source: marketData.source || null, status: "DISABLED" }
        );
        noCandidateStrategies.push({ strategyName: strategy.name, reason: `Disabled — needs at least ${minCandles} candles, only ${candles.length} available.` });
        strategyDataQuality.push({ strategyName: strategy.name, timeframe, required: minCandles, recommended: recommendedCandles, fetched: candles.length, source: marketData.source || null, status: "DISABLED" });
        continue;
      }
      const dataQualityForStrategy = candles.length >= recommendedCandles ? "GOOD" : "LIMITED";
      log?.entry(
        "info",
        symbol,
        `Fetching ${timeframe} candles for "${strategy.name}" (required ${minCandles}, recommended ${recommendedCandles}, fetched ${candles.length}, source: ${marketData.source || "unknown"}) — ${dataQualityForStrategy}`,
        { timeframe, required: minCandles, recommended: recommendedCandles, fetched: candles.length, source: marketData.source || null, status: dataQualityForStrategy }
      );
      strategyDataQuality.push({ strategyName: strategy.name, timeframe, required: minCandles, recommended: recommendedCandles, fetched: candles.length, source: marketData.source || null, status: dataQualityForStrategy });

      let candidate;
      try {
        const thresholds = getEffectiveThresholds(strategy, settings);
        candidate = strategy.evaluate(ctx, thresholds);
      } catch (e) {
        log?.entry("warn", symbol, `Strategy "${strategy.name}" threw during evaluation`, { message: e.message });
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
        dataQuality: dataQualityForStrategy, // GOOD/LIMITED, tied to THIS strategy's own candle requirement — kept separate from confidence, never blended into it
        candlesRequired: minCandles,
        candlesFetched: candles.length,
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

    log?.entry("info", symbol, "Scan complete", { qualifying: qualifying.length, rejected: rejected.length });

    return {
      symbol,
      market,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      fallbackReason: marketData.fallbackReason || null,
      lastCandleTime,
      source: marketData.source || null,
      strategiesEvaluated: strategies.length,
      qualifying,
      rejected: includeRejected ? rejected : [],
      rejectedCount: rejected.length,
      noCandidateStrategies: includeRejected ? noCandidateStrategies : [],
      strategyDataQuality,
    };
  } catch (e) {
    // Same isolation principle as the fetch try/catch above, covering
    // indicators/regime/structure/context-building — anything that could
    // throw before or between individual strategies' own try/catch.
    log?.entry("error", symbol, "Unexpected error during analysis", { message: e.message, name: e.name, stack: e.stack });
    return {
      symbol,
      market,
      dataStatus: marketData.status,
      isDemo: !!marketData.isDemo,
      lastCandleTime,
      source: marketData.source || null,
      strategiesEvaluated: 0,
      qualifying: [],
      rejected: [],
      noCandidateStrategies: [],
      error: "Unexpected error analyzing this symbol — see the scan log for detail.",
    };
  }
}

/**
 * Scans an entire watchlist for a market. Never forces a result count —
 * returns however many symbols/strategies genuinely qualify (0..N).
 */
export async function scanMarket({ market, watchlist, riskSettings, apiKeys, forceProviderId, includeRejected = true, signal, log = null, settings = {} }) {
  const symbols = watchlist || DEFAULT_WATCHLISTS[market];
  const scanLog = log || startScanLog(market);
  scanLog.entry("info", null, `Scan started for ${symbols.length} symbol(s)`, { symbols });

  let benchmarkCandles = null;
  if (market === "us_stocks") {
    try {
      const bench = await getMarketData({ symbol: "SPY", market: "us_stocks", timeframe: TIMEFRAME_BY_MARKET.us_stocks, limit: 200, apiKeys, forceProviderId, signal });
      benchmarkCandles = bench.candles;
      scanLog.entry("info", null, "Benchmark (SPY) fetched for relative strength", { candleCount: bench.candles?.length || 0 });
    } catch (e) {
      benchmarkCandles = null;
      scanLog.entry("warn", null, "Benchmark (SPY) fetch failed — relative-strength strategies will be skipped, everything else continues normally", { message: e.message });
    }
  }

  const results = await Promise.all(
    symbols.map((symbol) => scanSymbol({ symbol, market, riskSettings, apiKeys, forceProviderId, benchmarkCandles, includeRejected, signal, log: scanLog, settings }))
  );

  const allQualifying = results.flatMap((r) => r.qualifying);
  allQualifying.sort((a, b) => b.confidence.score - a.confidence.score);

  const anyLive = results.some((r) => r.dataStatus === "LIVE" || r.dataStatus === "DELAYED" || r.dataStatus === "DEMO");
  const anyDemo = results.some((r) => r.isDemo);
  const { errorCount, symbolsWithErrors } = scanLog.errorSummary();
  scanLog.entry("info", null, "Scan finished", { symbolsScanned: symbols.length, qualifying: allQualifying.length, errorCount, symbolsWithErrors });

  return {
    market,
    scannedAt: new Date().toISOString(),
    symbolsScanned: symbols.length,
    qualifying: allQualifying,
    perSymbol: results,
    isDemo: anyDemo,
    summary: allQualifying.length === 0 ? "NO_QUALIFYING_TRADE" : "QUALIFYING_SETUPS_FOUND",
    log: scanLog,
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

/**
 * "Notable Activity" — a deliberately lightweight, purely FACTUAL scan:
 * which watchlist symbols currently show elevated relative volume or sit
 * in a Breakout regime, right now. This is NOT a trade recommendation and
 * runs no strategy/confirmation/confidence logic at all — it's the same
 * kind of observation a "top movers" ticker on any market site would show.
 * Only fires on explicit user request (a button tap on Home), never
 * automatically, to respect free-tier rate limits.
 */
export async function scanNotableActivity({ market, watchlist, apiKeys, forceProviderId, signal }) {
  const timeframe = TIMEFRAME_BY_MARKET[market];
  const results = await Promise.all(
    watchlist.map(async (symbol) => {
      try {
        const data = await getMarketData({ symbol, market, timeframe, limit: 60, apiKeys, forceProviderId, signal });
        if (!data.candles || data.candles.length < 30) return null;
        const indicators = computeIndicatorSet(data.candles);
        const regimeResult = classifyRegime(data.candles, indicators);
        const rvol = indicators.rvol20[indicators.rvol20.length - 1];
        const notable = (rvol !== null && rvol >= 1.5) || regimeResult.regime === "Breakout";
        if (!notable) return null;
        return {
          symbol,
          rvol,
          regime: regimeResult.regime,
          currentPrice: data.candles[data.candles.length - 1].c,
          isDemo: !!data.isDemo,
          dataStatus: data.status,
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean).sort((a, b) => (b.rvol || 0) - (a.rvol || 0));
}
