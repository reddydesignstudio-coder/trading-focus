// js/strategies/index.js
import { US_STOCK_STRATEGIES } from "./usStocks.js";
import { FOREX_STRATEGIES } from "./forex.js";
import { CRYPTO_STRATEGIES } from "./crypto.js";

export const ALL_STRATEGIES = [...US_STOCK_STRATEGIES, ...FOREX_STRATEGIES, ...CRYPTO_STRATEGIES];

export function strategiesForMarket(market) {
  return ALL_STRATEGIES.filter((s) => s.market === market);
}

export function getStrategyById(id) {
  return ALL_STRATEGIES.find((s) => s.id === id) || null;
}

export { US_STOCK_STRATEGIES, FOREX_STRATEGIES, CRYPTO_STRATEGIES };
