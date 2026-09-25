// js/strategyThresholds.js
//
// Configurable Strategy Thresholds
// --------------------------------------------------------------
// Every strategy declares its own tunable parameters as
// `defaultThresholds` (e.g. { rvolMin: 1.5 }) — sensible defaults that
// match the strategy's original hardcoded behavior exactly, so nothing
// changes for anyone until they explicitly tweak something in Settings.
//
// A person's own overrides live in settings.strategyThresholds, keyed
// by strategy id — and because that's part of `settings`, it already
// syncs across devices for free via the existing Cloud Sync mechanism,
// no new storage plumbing needed.
//
// getEffectiveThresholds() is the one place that combines "the
// strategy's defaults" with "whatever this person has changed" — every
// strategy's evaluate() function receives the MERGED result, never
// reads settings directly itself.

/**
 * Merges a strategy's own default thresholds with any user override
 * stored in settings.strategyThresholds[strategy.id]. Never mutates
 * either input. A partial override (e.g. only rvolMin set) still keeps
 * every other default untouched.
 */
export function getEffectiveThresholds(strategy, settings) {
  const defaults = strategy.defaultThresholds || {};
  const override = settings?.strategyThresholds?.[strategy.id] || {};
  return { ...defaults, ...override };
}

/**
 * True if this strategy actually has any tunable thresholds at all —
 * used by the Settings UI to decide whether to show a strategy in the
 * editable list (a strategy with no defaultThresholds simply has
 * nothing to tune yet, and shouldn't show an empty, confusing section).
 */
export function hasTunableThresholds(strategy) {
  return !!(strategy.defaultThresholds && Object.keys(strategy.defaultThresholds).length);
}
