// js/targetEngine.js
//
// Target Engine
// --------------------------------------------------------------
// Converts a strategy's raw `targetHint` (structural level, measured
// move, or ATR multiple) into a concrete take-profit price, then
// validates that the resulting R:R meets the strategy's minimum.
// If nearby structure caps the realistic move below the minimum
// R:R, the engine REJECTS rather than forcing a target through
// resistance/support (per requirement #21 — no-trade over a forced
// unrealistic target).

export function resolveTarget(candidate, entryPrice, stopLoss, atr, structureLevels) {
  const direction = candidate.direction;
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return { rejected: true, reason: "Stop distance is zero or invalid." };

  let rawTarget;
  const hint = candidate.targetHint || { type: "atr_multiple", atrMultiple: 2 };

  if (hint.type === "level" || hint.type === "measured_move") {
    rawTarget = hint.price;
  } else {
    rawTarget = direction === "long" ? entryPrice + atr * (hint.atrMultiple || 2) : entryPrice - atr * (hint.atrMultiple || 2);
  }

  // Check for nearer structure that would realistically cap the move before rawTarget.
  const opposingLevels = structureLevels.filter((l) => (direction === "long" ? l.side === "resistance" : l.side === "support"));
  const cappingLevel = opposingLevels
    .filter((l) => (direction === "long" ? l.price > entryPrice && l.price < rawTarget : l.price < entryPrice && l.price > rawTarget))
    .sort((a, b) => Math.abs(a.price - entryPrice) - Math.abs(b.price - entryPrice))[0];

  const finalTarget = cappingLevel ? cappingLevel.price : rawTarget;
  const reward = Math.abs(finalTarget - entryPrice);
  const rr = reward / risk;

  if (rr < candidate.minRR) {
    return {
      rejected: true,
      reason: `Realistic target (capped by ${cappingLevel ? "nearby structure at " + cappingLevel.price.toFixed(4) : "strategy target logic"}) only achieves ${rr.toFixed(
        2
      )}:1 R:R, below the ${candidate.minRR}:1 minimum for this strategy.`,
      rr,
      finalTarget,
    };
  }

  return {
    rejected: false,
    finalTarget,
    rr,
    risk,
    reward,
    cappedByStructure: !!cappingLevel,
  };
}
