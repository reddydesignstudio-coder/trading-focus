import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFirebaseConfigInput } from "../js/cloudSync.js";

const EXPECTED = {
  apiKey: "AIzaSyABCDEF1234567890",
  authDomain: "trading-focus-xxxxx.firebaseapp.com",
  projectId: "trading-focus-xxxxx",
  storageBucket: "trading-focus-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
};

test("parses strict JSON directly", () => {
  const json = JSON.stringify(EXPECTED);
  assert.deepEqual(parseFirebaseConfigInput(json), EXPECTED);
});

test("parses the exact format Firebase's console shows (unquoted keys, const wrapper, trailing semicolon)", () => {
  const raw = `const firebaseConfig = {
  apiKey: "AIzaSyABCDEF1234567890",
  authDomain: "trading-focus-xxxxx.firebaseapp.com",
  projectId: "trading-focus-xxxxx",
  storageBucket: "trading-focus-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};`;
  assert.deepEqual(parseFirebaseConfigInput(raw), EXPECTED);
});

test("parses the object literal with no surrounding const/semicolon at all", () => {
  const raw = `{
  apiKey: "AIzaSyABCDEF1234567890",
  authDomain: "trading-focus-xxxxx.firebaseapp.com",
  projectId: "trading-focus-xxxxx",
  storageBucket: "trading-focus-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
}`;
  assert.deepEqual(parseFirebaseConfigInput(raw), EXPECTED);
});

test("handles a trailing comma after the last field (valid JS, invalid strict JSON)", () => {
  const raw = `{
  apiKey: "AIzaSyABCDEF1234567890",
  authDomain: "trading-focus-xxxxx.firebaseapp.com",
  projectId: "trading-focus-xxxxx",
  storageBucket: "trading-focus-xxxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
}`;
  assert.deepEqual(parseFirebaseConfigInput(raw), EXPECTED);
});

test("handles 'export const' wrapper too", () => {
  const raw = `export const firebaseConfig = { apiKey: "AIzaSyABCDEF1234567890", authDomain: "trading-focus-xxxxx.firebaseapp.com", projectId: "trading-focus-xxxxx", storageBucket: "trading-focus-xxxxx.appspot.com", messagingSenderId: "123456789012", appId: "1:123456789012:web:abcdef1234567890" };`;
  assert.deepEqual(parseFirebaseConfigInput(raw), EXPECTED);
});

test("returns null for empty or whitespace-only input", () => {
  assert.equal(parseFirebaseConfigInput(""), null);
  assert.equal(parseFirebaseConfigInput("   \n  "), null);
  assert.equal(parseFirebaseConfigInput(null), null);
});

test("returns null for genuine garbage, never throws", () => {
  assert.equal(parseFirebaseConfigInput("this is not a config at all"), null);
  assert.equal(parseFirebaseConfigInput("{ this: is, broken syntax !! }"), null);
});

test("returns null (does not fabricate a config) when required fields are missing", () => {
  assert.equal(parseFirebaseConfigInput('{ "foo": "bar" }'), null);
});

test("never executes the pasted text as code — a side-effecting expression just fails to parse as a config, harmlessly", () => {
  const result = parseFirebaseConfigInput("(function(){ globalThis.__pwned = true; return 1; })()");
  assert.equal(result, null);
  assert.equal(globalThis.__pwned, undefined); // proves nothing ran — this is pure string/JSON parsing, no eval or Function
});
