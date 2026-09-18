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
    apiKeys: { twelvedata: "" },
    dataProviderOverride: {}, // e.g. { us_stocks: "demo" } to force demo mode per market
    testModeTradesPerDay: 2,
    watchlists: null, // null = use DEFAULT_WATCHLISTS
    demoModeAcknowledged: false,
  };
}

export async function loadSettings() {
  const existing = await get("settings", SETTINGS_KEY);
  return existing ? { ...defaultSettings(), ...existing } : defaultSettings();
}

export async function saveSettings(settings) {
  await put("settings", { ...settings, key: SETTINGS_KEY });
  return settings;
}

export function effectiveTimeZone(settings) {
  return settings.useDeviceTimeZone ? deviceTimeZone() : settings.timeZone;
}
