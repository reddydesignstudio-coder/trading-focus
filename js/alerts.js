// js/alerts.js
//
// Alerts Engine
// --------------------------------------------------------------
// Uses the standard Notification API. IMPORTANT, HONEST LIMITATION:
// a browser tab (or even an installed PWA) CANNOT reliably run a
// background scanner that fires notifications while fully closed or
// suspended, especially on iOS Safari/PWA, which restricts
// background execution and does not support the Web Push API for
// home-screen PWAs the way Android/desktop browsers do as of this
// writing. See docs/PWA.md for the full breakdown.
//
// What this module CAN do, honestly:
//  - Fire a notification for an event that happens WHILE the app is
//    open/foregrounded (or briefly backgrounded on platforms that
//    allow it).
//  - Schedule a check via `setTimeout`/`setInterval` while the tab
//    is alive to fire session-open alerts, but this stops if the
//    tab/app is fully closed or (on iOS) the PWA is suspended.
//  - Never claims to guarantee delivery.

import { put, getAll } from "./db.js";
import { uid } from "./utils.js";

export const ALERT_TYPES = [
  "us_premarket",
  "us_open",
  "london_open",
  "newyork_open",
  "london_ny_overlap",
  "tokyo_london_overlap",
  "high_confidence_setup",
  "trade_entered",
  "tp_reached",
  "sl_reached",
  "daily_result",
];

export async function requestPermission() {
  if (!("Notification" in window)) {
    return { supported: false, permission: "unsupported" };
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return { supported: true, permission: Notification.permission };
  }
  const permission = await Notification.requestPermission();
  return { supported: true, permission };
}

export async function fireAlert(type, { title, body, tag } = {}) {
  const record = { id: uid("alert"), type, title, body, createdAt: new Date().toISOString(), delivered: false };
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: tag || type, icon: "/icons/icon-192.png" });
      record.delivered = true;
    } catch (e) {
      record.deliveryError = String(e);
    }
  }
  await put("alerts", record);
  return record;
}

export async function listRecentAlerts(limit = 50) {
  const all = await getAll("alerts");
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

export const PWA_ALERT_LIMITATIONS_NOTE =
  "Browser/PWA notifications only fire reliably while this app is open or recently backgrounded. iOS in particular " +
  "suspends web apps aggressively and does not support always-on background push for home-screen web apps the way " +
  "native apps do. Do not rely on this app to wake you up for a trade — treat alerts as a convenience, not a guarantee.";
