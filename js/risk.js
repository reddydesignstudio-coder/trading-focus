// js/risk.js
//
// Risk Engine
// --------------------------------------------------------------
// Defaults: $1,000 account, 2% risk/trade, $20 max risk, 1:2 default
// R:R, 1:3 max R:R. Position sizing is purely mathematical — a
// higher confidence score NEVER increases dollar risk. This module
// is also used to recalculate size/risk/reward whenever the user
// selects an actual entry price inside the entry zone.

export const DEFAULT_RISK_SETTINGS = {
  accountBalance: 1000,
  riskPercent: 2,
  maxRiskOverrideUSD: null, // if set, hard-caps risk regardless of % (defaults to riskPercent-derived cap)
  defaultRR: 2,
  maxRR: 3,
};

export function maxDollarRisk(settings = DEFAULT_RISK_SETTINGS) {
  const pctBased = settings.accountBalance * (settings.riskPercent / 100);
  return settings.maxRiskOverrideUSD !== null ? Math.min(pctBased, settings.maxRiskOverrideUSD) : pctBased;
}

/**
 * Computes position size for a given entry/stop pair, asset type, and risk
 * settings. `assetType` affects unit conventions (shares vs. lots vs. coin
 * quantity) — Phase 1 treats all three uniformly as "units" of the
 * instrument since we're not modeling FX lot/pip conventions or futures
 * contract multipliers yet (documented limitation).
 */
export function computePositionSize(entryPrice, stopLoss, settings = DEFAULT_RISK_SETTINGS) {
  const perUnitRisk = Math.abs(entryPrice - stopLoss);
  if (perUnitRisk <= 0) {
    return { valid: false, reason: "Entry and stop-loss cannot be equal." };
  }
  const dollarRisk = maxDollarRisk(settings);
  const units = dollarRisk / perUnitRisk;
  const positionValue = units * entryPrice;

  return {
    valid: true,
    units,
    dollarRisk,
    positionValue,
    perUnitRisk,
  };
}

/** Full recalculation used both at signal-generation time and whenever the user edits the actual entry. */
export function recalculateTrade({ direction, entryPrice, stopLoss, takeProfit, settings = DEFAULT_RISK_SETTINGS, minRR = 1.5 }) {
  const sizing = computePositionSize(entryPrice, stopLoss, settings);
  if (!sizing.valid) return { valid: false, reason: sizing.reason };

  const reward = Math.abs(takeProfit - entryPrice);
  const rr = reward / sizing.perUnitRisk;

  // Directional sanity: stop must be on the correct side of entry, target on the other.
  const directionOk =
    direction === "long" ? stopLoss < entryPrice && takeProfit > entryPrice : stopLoss > entryPrice && takeProfit < entryPrice;

  if (!directionOk) {
    return { valid: false, reason: "Stop-loss / take-profit are not on the correct side of the entry for this direction." };
  }
  if (rr < minRR) {
    return { valid: false, reason: `Resulting R:R (${rr.toFixed(2)}:1) is below the strategy's minimum (${minRR}:1). Trade rejected.` };
  }
  if (rr > settings.maxRR) {
    // Not rejected — but flagged, since target may be unrealistic beyond the configured ceiling.
    return {
      valid: true,
      capped: true,
      note: `R:R (${rr.toFixed(2)}:1) exceeds the configured maximum (${settings.maxRR}:1). Consider tightening the target.`,
      ...sizing,
      rr,
      reward,
      potentialReward: sizing.dollarRisk * rr,
    };
  }

  return {
    valid: true,
    capped: false,
    ...sizing,
    rr,
    reward,
    potentialReward: sizing.dollarRisk * rr,
  };
}
