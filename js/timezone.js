// js/timezone.js
//
// Timezone / Session Engine
// --------------------------------------------------------------
// Uses the browser's built-in Intl.DateTimeFormat with an IANA
// timeZone id for every conversion. This is DST-safe by
// construction: the IANA tz database (which browsers ship and
// keep current) already encodes every region's DST transition
// rules, so "America/New_York" is -05:00 in January and -04:00
// in July automatically. We never hardcode a UTC offset.
//
// Default local timezone: Asia/Kolkata (IST, no DST).
// The app also reads the *device's* timezone via
// Intl.DateTimeFormat().resolvedOptions().timeZone and lets the
// user choose which one drives the "local time" shown on Home.

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Returns {hour, minute, weekday(0=Sun..6=Sat), dateKey} for `date` as seen in `timeZone`. */
export function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {
    hour,
    minute: parseInt(get("minute"), 10),
    second: parseInt(get("second"), 10),
    weekday: weekdayMap[get("weekday")],
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: hour * 60 + parseInt(get("minute"), 10),
  };
}

export function formatClock(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

// ---- Session definitions --------------------------------------------
// Each session is defined in ITS OWN local timezone (regular hours),
// so DST in that region is handled automatically by Intl.
// Weekday numbers: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

export const SESSIONS = [
  {
    id: "sydney",
    label: "Sydney (FX)",
    market: "forex",
    timeZone: "Australia/Sydney",
    openMin: 8 * 60, // 8:00 AM local
    closeMin: 17 * 60, // 5:00 PM local
    days: [1, 2, 3, 4, 5],
  },
  {
    id: "tokyo",
    label: "Tokyo (FX)",
    market: "forex",
    timeZone: "Asia/Tokyo",
    openMin: 9 * 60,
    closeMin: 18 * 60,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: "london",
    label: "London (FX)",
    market: "forex",
    timeZone: "Europe/London",
    openMin: 8 * 60,
    closeMin: 16 * 60 + 30,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: "us_premarket",
    label: "US Pre-Market",
    market: "us_stocks",
    timeZone: "America/New_York",
    openMin: 4 * 60,
    closeMin: 9 * 60 + 30,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: "us_regular",
    label: "US Regular Session",
    market: "us_stocks",
    timeZone: "America/New_York",
    openMin: 9 * 60 + 30,
    closeMin: 16 * 60,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: "us_afterhours",
    label: "US After-Hours",
    market: "us_stocks",
    timeZone: "America/New_York",
    openMin: 16 * 60,
    closeMin: 20 * 60,
    days: [1, 2, 3, 4, 5],
  },
  {
    id: "newyork_fx",
    label: "New York (FX)",
    market: "forex",
    timeZone: "America/New_York",
    openMin: 8 * 60,
    closeMin: 17 * 60,
    days: [1, 2, 3, 4, 5],
  },
];

/**
 * Converts a wall-clock time (Y-M-D HH:MM) *as read in `timeZone`* into the
 * correct UTC-backed Date. Needed because "9:30 AM in New York" is a
 * different UTC instant depending on whether EST or EDT is in effect that
 * day — this resolves it via two rounds of Intl round-tripping rather than
 * a hardcoded offset, so it's DST-correct automatically.
 */
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, timeZone);
    const [gy, gm, gd] = p.dateKey.split("-").map(Number);
    const dayDrift = Math.round((Date.UTC(gy, gm - 1, gd) - Date.UTC(year, month - 1, day)) / 86400000);
    const wantedMinutes = hour * 60 + minute;
    const gotMinutes = p.hour * 60 + p.minute + dayDrift * 1440;
    const diff = wantedMinutes - gotMinutes;
    guess = new Date(guess.getTime() + diff * 60000);
  }
  return guess;
}

function dateTimeForSessionField(session, referenceDate, minutesField) {
  const p = localParts(referenceDate, session.timeZone);
  const [y, m, d] = p.dateKey.split("-").map(Number);
  const hour = Math.floor(session[minutesField] / 60);
  const minute = session[minutesField] % 60;
  return zonedTimeToUtc(y, m, d, hour, minute, session.timeZone);
}

/** Next UTC instant (strictly after `now`) at which `session` opens, searching up to 8 days ahead. */
export function nextSessionOpenDate(session, now) {
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86400000);
    const p = localParts(probe, session.timeZone);
    if (!session.days.includes(p.weekday)) continue;
    const openDt = dateTimeForSessionField(session, probe, "openMin");
    if (openDt > now) return openDt;
  }
  return null;
}

/** UTC instant at which the CURRENTLY active `session` closes today (call only when active). */
export function sessionCloseDate(session, now) {
  return dateTimeForSessionField(session, now, "closeMin");
}

export function isSessionActive(session, now) {
  const p = localParts(now, session.timeZone);
  if (!session.days.includes(p.weekday)) return false;
  if (session.openMin <= session.closeMin) {
    return p.minutesOfDay >= session.openMin && p.minutesOfDay < session.closeMin;
  }
  // overnight session (wraps past midnight) — not used currently but supported
  return p.minutesOfDay >= session.openMin || p.minutesOfDay < session.closeMin;
}

/** Minutes from `now` until a session's next open, searching up to 8 days ahead. */
function minutesUntilNextOpen(session, now) {
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86400000);
    const p = localParts(probe, session.timeZone);
    if (!session.days.includes(p.weekday)) continue;
    const openTodayMinutesFromNow =
      dayOffset === 0 ? session.openMin - p.minutesOfDay : session.openMin + (1440 - p.minutesOfDay) + (dayOffset - 1) * 1440;
    if (dayOffset === 0 && p.minutesOfDay >= session.openMin) continue; // already past today's open
    if (openTodayMinutesFromNow > 0) return openTodayMinutesFromNow;
  }
  return null;
}

/**
 * Crypto trades 24/7 — there is no exchange session to gate it, but we still
 * report "liquidity windows" (overlap of major FX/equity sessions tends to
 * correlate with higher crypto volume too) for the Market Focus Engine.
 */
export function getSessionStatus(now = new Date()) {
  const active = SESSIONS.filter((s) => isSessionActive(s, now));
  const upcoming = SESSIONS.map((s) => ({
    session: s,
    minutesUntilOpen: isSessionActive(s, now) ? 0 : minutesUntilNextOpen(s, now),
  }))
    .filter((x) => x.minutesUntilOpen !== null)
    .sort((a, b) => a.minutesUntilOpen - b.minutesUntilOpen);

  const londonActive = active.some((s) => s.id === "london");
  const nyActive = active.some((s) => s.id === "newyork_fx" || s.id === "us_regular");
  const tokyoActive = active.some((s) => s.id === "tokyo");

  return {
    now,
    active,
    upcoming,
    overlaps: {
      londonNewYork: londonActive && nyActive,
      tokyoLondon: tokyoActive && londonActive,
    },
  };
}

/**
 * Full session board for the UI: every tracked session, whether it's active
 * right now, and — critically — the open/close instant converted into
 * WHATEVER timezone the user wants displayed (their device zone by default),
 * plus minutes remaining for a live countdown. This is what powers the
 * "Active / Inactive, opens in Xh Ym" display on Home.
 */
export function computeSessionBoard(now = new Date(), displayTimeZone = DEFAULT_TIMEZONE) {
  return SESSIONS.map((session) => {
    const active = isSessionActive(session, now);
    if (active) {
      const closesAt = sessionCloseDate(session, now);
      return {
        id: session.id,
        label: session.label,
        market: session.market,
        active: true,
        closesAt,
        localCloseTime: formatClock(closesAt, displayTimeZone),
        minutesUntilClose: Math.max(0, Math.round((closesAt - now) / 60000)),
      };
    }
    const opensAt = nextSessionOpenDate(session, now);
    return {
      id: session.id,
      label: session.label,
      market: session.market,
      active: false,
      opensAt,
      localOpenTime: opensAt ? formatClock(opensAt, displayTimeZone) : null,
      minutesUntilOpen: opensAt ? Math.max(0, Math.round((opensAt - now) / 60000)) : null,
    };
  });
}

/** Groups the session board by market and adds a simple market-level active flag (crypto is always active). */
export function computeMarketBoard(now = new Date(), displayTimeZone = DEFAULT_TIMEZONE) {
  const board = computeSessionBoard(now, displayTimeZone);
  const byMarket = { us_stocks: [], forex: [] };
  board.forEach((s) => byMarket[s.market]?.push(s));
  return {
    us_stocks: { sessions: byMarket.us_stocks, active: byMarket.us_stocks.some((s) => s.active) },
    forex: { sessions: byMarket.forex, active: byMarket.forex.some((s) => s.active) },
    crypto: { sessions: [], active: true, note: "Crypto trades 24/7 — always active." },
  };
}

/** Formats a minute count as "Xh Ym" / "Xm" for countdown display. */
export function formatCountdown(mins) {
  if (mins === null || mins === undefined) return "—";
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/** Formats a millisecond duration as "Xh Ym Zs" (with seconds) for a live-ticking countdown. */
export function formatCountdownHMS(ms) {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

/**
 * The two sessions the Home screen's compact countdown hero cares about:
 * US Stocks Regular session, and Forex New York session (the two the user
 * actually wants surfaced, rather than the full 7-session board). Each
 * entry carries the raw target Date (open or close instant) so the caller
 * can tick a live per-second countdown against it without recomputing
 * Intl-based session math every second.
 */
export function computeKeySessionCountdowns(now = new Date(), displayTimeZone = DEFAULT_TIMEZONE) {
  const usRegular = SESSIONS.find((s) => s.id === "us_regular");
  const nyForex = SESSIONS.find((s) => s.id === "newyork_fx");

  const build = (session, label) => {
    const active = isSessionActive(session, now);
    if (active) {
      const targetAt = sessionCloseDate(session, now);
      return { id: session.id, label, active: true, targetAt, phase: "closes" };
    }
    const targetAt = nextSessionOpenDate(session, now);
    return { id: session.id, label, active: false, targetAt, phase: "opens" };
  };

  return [build(usRegular, "US Stocks"), build(nyForex, "Forex (New York)")];
}

/** US market holidays (fixed-date + a few observed ones) for the current & next year — best-effort, static list. */
export const US_MARKET_HOLIDAYS_NOTE =
  "Market holiday calendars are not fetched live in Phase 1 (no free, reliable, no-key holiday API). " +
  "The session engine uses weekday + trading-hours logic only; the app may show a session as 'open' on an " +
  "exchange holiday. Always cross-check before live trading around holidays.";
