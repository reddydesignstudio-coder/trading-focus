import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeIndexedDB } from "./helpers/fakeIndexedDB.js";
import { _resetForTests } from "../js/db.js";
import { isPinSet, setupPin, verifyPin, isPinEnabled, disablePin } from "../js/pinLock.js";

test("isPinSet is false before any PIN has been created", async () => {
  installFakeIndexedDB();
  _resetForTests();
  assert.equal(await isPinSet(), false);
});

test("setupPin stores a hash, never the plain PIN, and isPinSet becomes true", async () => {
  const db = installFakeIndexedDB();
  _resetForTests();
  await setupPin("123456");
  assert.equal(await isPinSet(), true);

  const record = db.stores.get("settings").rows.get("pin_lock");
  assert.ok(record.hash, "expected a hash to be stored");
  assert.notEqual(record.hash, "123456", "the plain PIN must never be stored");
  assert.equal(record.hash.length, 64, "expected a 64-char hex SHA-256 digest");
});

test("verifyPin returns true for the correct PIN and false for a wrong one", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await setupPin("482913");
  assert.equal(await verifyPin("482913"), true);
  assert.equal(await verifyPin("000000"), false);
  assert.equal(await verifyPin("482912"), false); // off by one digit
});

test("verifyPin returns false (never throws) when no PIN has been set yet", async () => {
  installFakeIndexedDB();
  _resetForTests();
  assert.equal(await verifyPin("123456"), false);
});

test("setting a new PIN overwrites the old one entirely", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await setupPin("111111");
  await setupPin("222222");
  assert.equal(await verifyPin("111111"), false);
  assert.equal(await verifyPin("222222"), true);
});

test("isPinEnabled is false before any PIN is set", async () => {
  installFakeIndexedDB();
  _resetForTests();
  assert.equal(await isPinEnabled(), false);
});

test("isPinEnabled is true right after setup, and false after disablePin", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await setupPin("135790");
  assert.equal(await isPinEnabled(), true);

  await disablePin();
  assert.equal(await isPinEnabled(), false);
  // disabling must NOT erase the ability to verify the existing PIN — only turn the gate off
  assert.equal(await verifyPin("135790"), true);
});

test("re-running setupPin after disablePin turns it back on with the new PIN", async () => {
  installFakeIndexedDB();
  _resetForTests();
  await setupPin("111111");
  await disablePin();
  assert.equal(await isPinEnabled(), false);

  await setupPin("999999");
  assert.equal(await isPinEnabled(), true);
  assert.equal(await verifyPin("999999"), true);
  assert.equal(await verifyPin("111111"), false);
});
