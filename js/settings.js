// js/settings.js
import { get, put } from "./db.js";
import { DEFAULT_RISK_SETTINGS } from "./risk.js";
import { DEFAULT_TIMEZONE, deviceTimeZone } from "./timezone.js";

const SETTINGS_KEY = "app_settings";

export function defaultSettings() {
  return {
    key: SETTINGS_KEY,
    risk: { ...DEFAULT_RISK_SETTINGS },
    timeZone: DEFAULT_TIMEZONE,
    useDeviceTimeZone: true,
    // twelvedata: primary key. twelvedataBackup: optional second key — if the
    // primary comes back rate-limited (429), the data layer automatically
    // retries with the backup before falling back to demo data.
    apiKeys: { twelvedata: "", twelvedataBackup: "", finnhub: "", fmp: "", alphavantage: "" },
    dataProviderOverride: {}, // e.g. { us_stocks: "demo" } to force demo mode per market
    testModeTradesPerDay: 2,
    watchlists: null, // null = use DEFAULT_WATCHLISTS
    demoModeAcknowledged: false,
  };
}

export async function loadSettings() {
  const existing = await get("settings", SETTINGS_KEY);
  if (!existing) return defaultSettings();
  const defaults = defaultSettings();
  // Nested merge (not a shallow spread) for object-valued fields, so a
  // setting saved before a new sub-field existed (e.g. an old apiKeys
  // object without twelvedataBackup) still picks up the new default
  // instead of silently losing it to the shallow-overwrite.
  return {
    ...defaults,
    ...existing,
    risk: { ...defaults.risk, ...(existing.risk || {}) },
    apiKeys: { ...defaults.apiKeys, ...(existing.apiKeys || {}) },
    dataProviderOverride: { ...defaults.dataProviderOverride, ...(existing.dataProviderOverride || {}) },
  };
}

export async function saveSettings(settings) {
  await put("settings", { ...settings, key: SETTINGS_KEY });
  return settings;
}

export function effectiveTimeZone(settings) {
  return settings.useDeviceTimeZone ? deviceTimeZone() : settings.timeZone;
}

/** Ordered list of usable Twelve Data keys (primary first, then backup), skipping blanks. */
export function twelveDataKeyList(settings) {
  return [settings.apiKeys.twelvedata, settings.apiKeys.twelvedataBackup].filter((k) => k && k.trim());
}
