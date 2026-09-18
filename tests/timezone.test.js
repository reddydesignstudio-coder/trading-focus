import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, getSessionStatus, SESSIONS, computeSessionBoard, computeMarketBoard, formatCountdown } from "../js/timezone.js";

test("localParts correctly converts a known UTC instant to New York time (winter, EST -05:00)", () => {
  // Jan 15 2026 15:00 UTC => 10:00 EST in New York
  const d = new Date("2026-01-15T15:00:00.000Z");
  const p = localParts(d, "America/New_York");
  assert.equal(p.hour, 10);
});

test("localParts correctly handles US daylight saving (summer, EDT -04:00)", () => {
  // Jul 15 2026 15:00 UTC => 11:00 EDT in New York (DST active)
  const d = new Date("2026-07-15T15:00:00.000Z");
  const p = localParts(d, "America/New_York");
  assert.equal(p.hour, 11);
});

test("localParts handles UK daylight saving (BST vs GMT)", () => {
  const winter = localParts(new Date("2026-01-15T12:00:00.000Z"), "Europe/London");
  const summer = localParts(new Date("2026-07-15T12:00:00.000Z"), "Europe/London");
  assert.equal(winter.hour, 12); // GMT = UTC in winter
  assert.equal(summer.hour, 13); // BST = UTC+1 in summer
});

test("session weekday gating excludes Saturday/Sunday for regular US session", () => {
  const usRegular = SESSIONS.find((s) => s.id === "us_regular");
  assert.ok(!usRegular.days.includes(0)); // Sunday
  assert.ok(!usRegular.days.includes(6)); // Saturday
});

test("getSessionStatus flags London/New York overlap during the known overlap window", () => {
  // 14:00 UTC in July is 15:00 London (BST) and 10:00 New York (EDT) — both regular sessions active
  const d = new Date("2026-07-15T14:00:00.000Z");
  const status = getSessionStatus(d);
  assert.equal(status.overlaps.londonNewYork, true);
});

test("getSessionStatus reports no active sessions in the dead of a Saturday night", () => {
  // pick a Saturday well outside all session windows
  const d = new Date("2026-01-17T22:00:00.000Z"); // a Saturday
  const status = getSessionStatus(d);
  const equityOrFx = status.active.filter((s) => ["us_regular", "london", "newyork_fx", "tokyo", "sydney"].includes(s.id));
  assert.equal(equityOrFx.length, 0);
});

test("computeSessionBoard marks every session as active or inactive with a consistent countdown", () => {
  const now = new Date("2026-07-15T14:00:00.000Z"); // known London/NY overlap instant
  const board = computeSessionBoard(now, "Asia/Kolkata");
  assert.equal(board.length, SESSIONS.length);
  board.forEach((s) => {
    if (s.active) {
      assert.ok(s.closesAt instanceof Date);
      assert.ok(s.closesAt > now);
      assert.ok(s.minutesUntilClose >= 0);
      assert.ok(typeof s.localCloseTime === "string");
    } else {
      // either no future open found (extremely unlikely within 8 days) or a valid future open
      if (s.opensAt) {
        assert.ok(s.opensAt > now);
        assert.ok(s.minutesUntilOpen >= 0);
      }
    }
  });
});

test("computeMarketBoard reports crypto as always active with no session list", () => {
  const board = computeMarketBoard(new Date(), "Asia/Kolkata");
  assert.equal(board.crypto.active, true);
  assert.equal(board.crypto.sessions.length, 0);
});

test("computeMarketBoard reflects us_stocks active only when a US session window is open", () => {
  // Jan 15 2026 15:00 UTC = 10:00 EST — inside US regular session hours (9:30-16:00)
  const activeNow = new Date("2026-01-15T15:00:00.000Z");
  const activeBoard = computeMarketBoard(activeNow, "Asia/Kolkata");
  assert.equal(activeBoard.us_stocks.active, true);

  // Jan 15 2026 03:00 UTC = 22:00 EST previous day — well outside all US sessions (pre-market starts 4am ET)
  const inactiveNow = new Date("2026-01-15T03:00:00.000Z");
  const inactiveBoard = computeMarketBoard(inactiveNow, "Asia/Kolkata");
  assert.equal(inactiveBoard.us_stocks.active, false);
  // and every listed us_stocks session should carry a future open time for the countdown
  inactiveBoard.us_stocks.sessions.forEach((s) => {
    assert.equal(s.active, false);
    assert.ok(s.opensAt === null || s.opensAt > inactiveNow);
  });
});

test("formatCountdown renders human-friendly minute counts", () => {
  assert.equal(formatCountdown(0), "<1m");
  assert.equal(formatCountdown(45), "45m");
  assert.equal(formatCountdown(90), "1h 30m");
  assert.equal(formatCountdown(null), "—");
});
