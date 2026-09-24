import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/fakeDom.js"; // must install document/window/localStorage BEFORE views.js is imported
import { installFakeIndexedDB } from "./helpers/fakeIndexedDB.js";
import { _resetForTests } from "../js/db.js";

globalThis.alert = () => {};
globalThis.confirm = () => true;

function makeState(settings) {
  const state = {
    settings,
    currentTab: "home",
    currentScanMarket: "us_stocks",
    tradeMode: "live",
    performanceFilter: "30d",
    othersView: null,
    intervalIds: [],
    effectiveTimeZone() { return settings.timeZone || "Asia/Kolkata"; },
    goToScan() {},
    goToSettings() {},
    goToHome() {},
    goToOthers() {},
    async persistSettings() {},
    registerInterval(id) { state.intervalIds.push(id); },
    clearIntervals() { state.intervalIds.forEach((id) => clearInterval(id)); state.intervalIds = []; },
    lastResolutionCheckAt: 0,
  };
  return state;
}

async function freshState() {
  installFakeIndexedDB();
  _resetForTests();
  const { defaultSettings } = await import("../js/settings.js");
  return makeState(defaultSettings());
}

// Every render function below is called against demo data only (no real
// network calls succeed in this environment anyway — Node's global fetch
// will just fail to connect, which every provider already handles as a
// normal error path). The point isn't verifying what's on screen, it's
// verifying the function runs at all without throwing a ReferenceError,
// TypeError, or similar — exactly the class of bug `node --check` cannot
// catch, since it only parses syntax and never executes anything.

test("renderHome runs without throwing on a completely fresh (never-configured) settings object", async () => {
  const state = await freshState();
  const { renderHome } = await import("../js/ui/views.js");
  const root = document.createElement("div");
  await assert.doesNotReject(renderHome(root, state));
});

test("renderScan runs without throwing for us_stocks with no API keys configured (demo fallback path)", async () => {
  const state = await freshState();
  const { renderScan } = await import("../js/ui/views.js");
  const root = document.createElement("div");
  await assert.doesNotReject(renderScan(root, state));
});

test("renderScan runs without throwing for crypto", async () => {
  const state = await freshState();
  state.currentScanMarket = "crypto";
  const { renderScan } = await import("../js/ui/views.js");
  const root = document.createElement("div");
  await assert.doesNotReject(renderScan(root, state));
});

test("renderSettings runs without throwing on a completely fresh settings object — this is the exact scenario of opening the app in a brand-new browser with empty local storage", async () => {
  const state = await freshState();
  const { renderSettings } = await import("../js/ui/views.js");
  const root = document.createElement("div");
  await assert.doesNotReject(renderSettings(root, state));
});

test("renderOthers (the More menu) runs without throwing", async () => {
  const state = await freshState();
  const { renderOthers } = await import("../js/ui/views.js");
  const root = document.createElement("div");
  await assert.doesNotReject(renderOthers(root, state));
});

test("every item in the More menu's own render function runs without throwing", async () => {
  const state = await freshState();
  const views = await import("../js/ui/views.js");
  const renderers = [views.renderAccountLedger, views.renderJournal, views.renderDailySummary, views.renderPerformance, views.renderBacktest, views.renderStrategyLab];
  for (const renderFn of renderers) {
    const root = document.createElement("div");
    await assert.doesNotReject(renderFn(root, state), `${renderFn.name} threw`);
  }
});
