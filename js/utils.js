// js/utils.js
// Small dependency-free helpers shared across the app.

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function fmtUSD(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function fmtPct(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(decimals)}%`;
}

export function todayKey(date = new Date(), timeZone = "Asia/Kolkata") {
  // Returns YYYY-MM-DD for the given IANA timezone, DST-safe via Intl.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

export function mean(arr) {
  return arr.length ? sum(arr) / arr.length : 0;
}

export function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = mean(arr.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

// Simple event bus so modules can stay decoupled from the UI layer.
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event).delete(cb);
  }
  emit(event, payload) {
    (this.listeners.get(event) || []).forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[EventBus] listener error for "${event}"`, e);
      }
    });
  }
}

export const bus = new EventBus();
