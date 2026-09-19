// js/pinLock.js
//
// PIN Lock
// --------------------------------------------------------------
// A basic local screen-lock, not real authentication: there is no
// server, no account, nothing to authenticate AGAINST — this just
// gates access to the app's own UI on THIS device with a 6-digit
// PIN, so someone picking up your phone can't immediately see your
// trades. The PIN is hashed (SHA-256) before storage; only the hash
// is ever persisted, never the plain PIN. Setup happens once, the
// first time the app is opened with no PIN configured; after that,
// entering the PIN is required each time the app is freshly loaded.
//
// Honest limitation: anyone with direct access to this browser's
// IndexedDB (e.g. via dev tools) can read the stored hash and, in
// principle, everything else the app stores — this lock deters
// casual access to the UI, it is not encryption of the underlying
// data. See docs/LIMITATIONS.md.

import { get, put } from "./db.js";

const PIN_KEY = "pin_lock";
const PIN_LENGTH = 6;

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isPinSet() {
  const record = await get("settings", PIN_KEY);
  return !!record?.hash;
}

/** True only when a PIN exists AND the user hasn't turned the lock off from Settings. */
export async function isPinEnabled() {
  const record = await get("settings", PIN_KEY);
  return !!record?.hash && record.enabled !== false;
}

export async function setupPin(pin) {
  const hash = await sha256Hex(pin);
  await put("settings", { key: PIN_KEY, hash, enabled: true });
}

/** Turns the lock off without discarding the hash, so Settings can distinguish "never set up" from "off". */
export async function disablePin() {
  const record = await get("settings", PIN_KEY);
  if (record) await put("settings", { ...record, enabled: false });
}

export async function verifyPin(pin) {
  const record = await get("settings", PIN_KEY);
  if (!record?.hash) return false;
  const hash = await sha256Hex(pin);
  return hash === record.hash;
}

function isValidPin(pin) {
  return /^\d{6}$/.test(pin);
}

/**
 * Renders the setup-or-unlock screen and resolves once the user has
 * successfully set up or entered their PIN. Uses its OWN dedicated overlay
 * element appended directly to <body> — deliberately NOT the app's existing
 * #app/#content containers, since those hold the header/nav/content
 * structure app.js depends on; clearing them here and expecting them back
 * later would leave app.js holding references to elements that no longer
 * exist. The overlay is removed entirely once unlocked.
 */
export function requirePinUnlock() {
  return new Promise(async (resolve) => {
    const record = await get("settings", PIN_KEY);

    if (!record?.hash) {
      // Never configured at all — mandatory first-time setup.
      const overlay = document.createElement("div");
      document.body.appendChild(overlay);
      renderSetupScreen(overlay, () => {
        overlay.remove();
        resolve();
      });
      return;
    }

    if (record.enabled === false) {
      resolve(); // user turned the lock off from Settings — skip straight through
      return;
    }

    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    renderUnlockScreen(overlay, () => {
      overlay.remove();
      resolve();
    });
  });
}

function screenShell(title, subtitle) {
  const wrap = document.createElement("div");
  wrap.className = "pin-screen";
  const card = document.createElement("div");
  card.className = "pin-card";
  const h1 = document.createElement("h1");
  h1.className = "pin-title";
  h1.textContent = title;
  const p = document.createElement("p");
  p.className = "pin-subtitle";
  p.textContent = subtitle;
  card.appendChild(h1);
  card.appendChild(p);
  wrap.appendChild(card);
  return { wrap, card };
}

function pinInput() {
  const input = document.createElement("input");
  input.type = "password";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.maxLength = PIN_LENGTH;
  input.className = "pin-input";
  input.autocomplete = "off";
  input.placeholder = "••••••";
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
  });
  return input;
}

function renderSetupScreen(container, resolve) {
  container.innerHTML = "";
  const { wrap, card } = screenShell("Set Up a PIN", "Create a 6-digit PIN to lock the app on this device. You'll only set this up once.");

  const pin1 = pinInput();
  const pin2 = pinInput();
  pin2.placeholder = "Confirm PIN";
  const error = document.createElement("p");
  error.className = "pin-error";

  const btn = document.createElement("button");
  btn.className = "btn btn-primary btn-large";
  btn.textContent = "Set PIN";
  btn.onclick = async () => {
    error.textContent = "";
    if (!isValidPin(pin1.value)) {
      error.textContent = "Enter exactly 6 digits.";
      return;
    }
    if (pin1.value !== pin2.value) {
      error.textContent = "PINs don't match — try again.";
      pin2.value = "";
      pin2.focus();
      return;
    }
    await setupPin(pin1.value);
    container.innerHTML = "";
    resolve();
  };

  const skipNote = document.createElement("p");
  skipNote.className = "pin-skip-note";
  skipNote.textContent = "This is a local screen lock only — there's no account and no way to recover a forgotten PIN except clearing the app's browser storage (which also erases your trade history).";

  card.appendChild(pin1);
  card.appendChild(pin2);
  card.appendChild(error);
  card.appendChild(btn);
  card.appendChild(skipNote);
  container.appendChild(wrap);
  pin1.focus();
}

function renderUnlockScreen(container, resolve) {
  container.innerHTML = "";
  const { wrap, card } = screenShell("Enter PIN", "Enter your 6-digit PIN to unlock Trading Focus.");

  const pin = pinInput();
  const error = document.createElement("p");
  error.className = "pin-error";

  const attempt = async () => {
    error.textContent = "";
    if (!isValidPin(pin.value)) {
      error.textContent = "Enter exactly 6 digits.";
      return;
    }
    const ok = await verifyPin(pin.value);
    if (!ok) {
      error.textContent = "Incorrect PIN — try again.";
      pin.value = "";
      pin.focus();
      return;
    }
    container.innerHTML = "";
    resolve();
  };

  pin.addEventListener("keydown", (e) => {
    if (e.key === "Enter") attempt();
  });

  const btn = document.createElement("button");
  btn.className = "btn btn-primary btn-large";
  btn.textContent = "Unlock";
  btn.onclick = attempt;

  card.appendChild(pin);
  card.appendChild(error);
  card.appendChild(btn);
  container.appendChild(wrap);
  pin.focus();
}
