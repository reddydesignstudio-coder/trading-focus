// js/app.js
import { loadSettings, saveSettings, effectiveTimeZone } from "./settings.js";
import { renderHome, renderScan, renderJournal, renderDailySummary, renderPerformance, renderBacktest, renderStrategyLab, renderSettings } from "./ui/views.js";
import { el } from "./ui/components.js";

const TABS = [
  { id: "home", label: "Home", render: renderHome },
  { id: "scan", label: "Scan", render: renderScan },
  { id: "journal", label: "Journal", render: renderJournal },
  { id: "daily", label: "Today", render: renderDailySummary },
  { id: "performance", label: "Performance", render: renderPerformance },
  { id: "backtest", label: "Backtest", render: renderBacktest },
  { id: "lab", label: "Strategy Lab", render: renderStrategyLab },
  { id: "settings", label: "Settings", render: renderSettings },
];

const state = {
  settings: null,
  currentTab: "home",
  currentScanMarket: "us_stocks",
  tradeMode: "live",
  performanceFilter: "30d",
  intervalIds: [],
  effectiveTimeZone() {
    return effectiveTimeZone(this.settings);
  },
  goToScan(market) {
    state.currentScanMarket = market;
    setTab("scan");
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
};

const appRoot = document.getElementById("app");
const navRoot = document.getElementById("nav");
const contentRoot = document.getElementById("content");

function buildNav() {
  navRoot.innerHTML = "";
  TABS.forEach((tab) => {
    const btn = el("button", { class: `nav-btn ${tab.id === state.currentTab ? "active" : ""}`, onclick: () => setTab(tab.id) }, tab.label);
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
}

async function boot() {
  state.settings = await loadSettings();
  const hashTab = window.location.hash.replace("#", "");
  const initialTab = TABS.find((t) => t.id === hashTab) ? hashTab : "home";
  buildNav();
  await setTab(initialTab);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((e) => console.warn("SW registration failed", e));
  }
}

boot();
