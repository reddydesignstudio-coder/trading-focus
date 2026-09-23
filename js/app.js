// js/app.js
import { loadSettings, saveSettings, effectiveTimeZone } from "./settings.js";
import { renderHome, renderScan, renderOthers, renderSettings } from "./ui/views.js";
import { el } from "./ui/components.js";
import { checkAndResolveOpenTrades } from "./paperTrading.js";
import * as db from "./db.js";
import { registerCloudSyncHooks, initFromSavedConfig, onAuthChange, onRemoteChange } from "./cloudSync.js";

const TABS = [
  { id: "home", label: "Home", icon: "🏠", render: renderHome },
  { id: "scan", label: "Scan", icon: "🔎", render: renderScan },
  { id: "others", label: "More", icon: "📚", render: renderOthers },
  { id: "settings", label: "Settings", icon: "⚙️", render: renderSettings },
];

const state = {
  settings: null,
  currentTab: "home",
  currentScanMarket: "us_stocks",
  tradeMode: "live",
  performanceFilter: "30d",
  othersView: null, // null = show the "More" menu; otherwise one of journal/daily/performance/backtest/lab
  intervalIds: [],
  effectiveTimeZone() {
    return effectiveTimeZone(this.settings);
  },
  goToScan(market) {
    state.currentScanMarket = market;
    setTab("scan");
  },
  goToSettings() {
    setTab("settings");
  },
  goToHome() {
    setTab("home");
  },
  goToOthers(view) {
    state.othersView = view;
    setTab("others");
  },
  async persistSettings() {
    await saveSettings(state.settings);
    alert("Settings saved.");
  },
  // Views that run a live countdown (setInterval) register the id here so
  // it's guaranteed to be cleared on tab switch — otherwise a Home-tab timer
  // would keep firing (and leaking) after the user navigates away.
  registerInterval(id) {
    state.intervalIds.push(id);
  },
  clearIntervals() {
    state.intervalIds.forEach((id) => clearInterval(id));
    state.intervalIds = [];
  },
  lastResolutionCheckAt: 0,
};

const navRoot = document.getElementById("nav");
const contentRoot = document.getElementById("content");

function buildNav() {
  navRoot.innerHTML = "";
  TABS.forEach((tab) => {
    const onClick = tab.id === "others" ? () => { state.othersView = null; setTab("others"); } : () => setTab(tab.id);
    const btn = el("button", { class: `nav-btn ${tab.id === state.currentTab ? "active" : ""}`, onclick: onClick }, [
      el("span", { class: "nav-btn-icon" }, tab.icon),
      el("span", {}, tab.label),
    ]);
    navRoot.appendChild(btn);
  });
}

async function setTab(tabId) {
  state.clearIntervals();
  state.currentTab = tabId;
  window.location.hash = tabId;
  buildNav();
  const tab = TABS.find((t) => t.id === tabId);
  contentRoot.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await tab.render(contentRoot, state);
  } catch (e) {
    console.error(e);
    contentRoot.innerHTML = "";
    contentRoot.appendChild(el("div", { class: "notice notice-error" }, "This screen couldn't be loaded. Please try again."));
  }

  // Trade resolution runs ONCE here, centrally, per navigation — never inside
  // the view functions themselves. It's fire-and-forget so it never blocks
  // the page from appearing (this is what was making Home feel slow to
  // load), and it's throttled to at most once every 10s so rapidly tapping
  // between tabs doesn't fire a network call on every single tap. If it
  // actually resolves something AND the user hasn't since navigated away,
  // the current tab is silently re-rendered so the change shows up without
  // needing a manual refresh — this is also what fixes trades appearing
  // resolved on one screen but still "open" on another: every screen was
  // previously running its own separate, out-of-sync check.
  const now = Date.now();
  if (now - state.lastResolutionCheckAt > 10000) {
    state.lastResolutionCheckAt = now;
    checkAndResolveOpenTrades(state)
      .then((result) => {
        if (result.resolved > 0 && state.currentTab === tabId) {
          tab.render(contentRoot, state);
        }
      })
      .catch((e) => console.warn("Background trade check failed", e));
  }
}

async function boot() {
  state.settings = await loadSettings();

  // Cloud sync: wires db.js's write path to also mirror to Firestore, IF a
  // config was previously saved (from Settings → Cloud Sync). No-op, and no
  // Firebase code ever downloaded, if the person hasn't set this up.
  registerCloudSyncHooks(db);
  try {
    const { initialized } = await initFromSavedConfig();
    if (initialized) {
      onAuthChange(() => {
        if (state.currentTab) setTab(state.currentTab); // re-render on sign-in/sign-out so Settings reflects it
      });
      onRemoteChange(() => {
        if (state.currentTab) setTab(state.currentTab); // a change arrived from another device — refresh what's on screen
      });
    }
  } catch (e) {
    console.warn("Cloud sync init failed", e);
  }

  const hashTab = window.location.hash.replace("#", "");
  const initialTab = TABS.find((t) => t.id === hashTab) ? hashTab : "home";
  buildNav();
  await setTab(initialTab);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((e) => console.warn("SW registration failed", e));
  }
}

boot();
