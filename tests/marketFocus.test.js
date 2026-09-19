import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTradingWindow } from "../js/marketFocus.js";

test("US stocks: opening hour is a Good window", () => {
  // 9:45 AM EST = 14:45 UTC in January (no DST)
  const now = new Date("2026-01-15T14:45:00.000Z");
  const w = assessTradingWindow("us_stocks", now);
  assert.equal(w.verdict, "Good");
  assert.match(w.reason, /opening|open/i);
});

test("US stocks: midday is a Weak window", () => {
  // 12:30 PM EST = 17:30 UTC in January
  const now = new Date("2026-01-15T17:30:00.000Z");
  const w = assessTradingWindow("us_stocks", now);
  assert.equal(w.verdict, "Weak");
  assert.match(w.reason, /midday/i);
});

test("US stocks: final hour before close is a Good window", () => {
  // 3:30 PM EST = 20:30 UTC in January
  const now = new Date("2026-01-15T20:30:00.000Z");
  const w = assessTradingWindow("us_stocks", now);
  assert.equal(w.verdict, "Good");
  assert.match(w.reason, /close|final/i);
});

test("US stocks: weekend is Closed", () => {
  const saturday = new Date("2026-01-17T16:00:00.000Z"); // a Saturday
  const w = assessTradingWindow("us_stocks", saturday);
  assert.equal(w.verdict, "Closed");
});

test("Forex: London/New York overlap is a Good window", () => {
  // known overlap instant used elsewhere in the suite
  const now = new Date("2026-07-15T14:00:00.000Z");
  const w = assessTradingWindow("forex", now);
  assert.equal(w.verdict, "Good");
  assert.match(w.reason, /overlap/i);
});

test("Forex: outside all major sessions is a Weak window", () => {
  const deadHour = new Date("2026-01-17T22:00:00.000Z"); // Saturday night, everything closed
  const w = assessTradingWindow("forex", deadHour);
  assert.equal(w.verdict, "Weak");
});

test("Crypto: US/EU overlap reads Good, quiet hours read Weak", () => {
  const overlap = new Date("2026-07-15T14:00:00.000Z");
  const quiet = new Date("2026-01-17T22:00:00.000Z");
  assert.equal(assessTradingWindow("crypto", overlap).verdict, "Good");
  assert.equal(assessTradingWindow("crypto", quiet).verdict, "Weak");
});
