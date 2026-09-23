// js/ui/views.js
import { el, signalCard, statCard, funnelBar, tradeRow, dataStatusBadge } from "./components.js";
import { computeMarketFocus, assessTradingWindow } from "../marketFocus.js";
import { formatClock, formatCountdownHMS, computeKeySessionCountdowns } from "../timezone.js";
import { scanMarket, DEFAULT_WATCHLISTS, scanNotableActivity } from "../scanner.js";
import { fetchMarketNews } from "../newsFeed.js";
import { getLiveModeStatus, executeTrade, markSignalMissed, saveSignal, TEST_MODE_OPTIONS, LIVE_MODE_LIMIT_OPTIONS, checkAndResolveOpenTrades, resetTradeData } from "../paperTrading.js";
import { recalculateTrade } from "../risk.js";
import { getDailySummary } from "../dailySummary.js";
import { getAll, put, remove } from "../db.js";
import { computePerformance, formatHoldingTime } from "../performance.js";
import { getStrategyLab } from "../strategyLab.js";
import { runBacktest } from "../backtest.js";
import { getMarketData, getUsageStats } from "../dataProviders/index.js";
import { atr, estimatePaceMs } from "../indicators.js";
import { detectPatternsAt } from "../candlestick.js";
import { strategiesForMarket, ALL_STRATEGIES } from "../strategies/index.js";
import { exportJSON, exportTradesCSV, importFromJSON, downloadBlob } from "../exportImport.js";
import { saveSettings } from "../settings.js";
import { isPinEnabled, verifyPin, setupPin, disablePin } from "../pinLock.js";
import {
  getSavedConfig,
  connectWithConfig,
  clearConfig,
  isConnected,
  currentUser,
  signInWithGoogle,
  signOutUser,
  pullAllOnce,
  pushAllOnce,
  parseFirebaseConfigInput,
} from "../cloudSync.js";
import { fmtUSD, fmtPct, todayKey, uid } from "../utils.js";

// -------------------------------------------------------------- HOME
export async function renderHome(root, state) {
  root.innerHTML = "";
  const tz = state.effectiveTimeZone();
  const liveStatus = await getLiveModeStatus(tz, state.settings.risk.liveModeDailyLimit);
  const summary = await getDailySummary({ timeZone: tz, startingBalance: state.settings.risk.accountBalance, mode: "live" });
  const allTrades = await getAll("trades");
  const liveTrades = allTrades.filter((t) => t.mode === "live");
  const livePerf = computePerformance({ trades: liveTrades, startingBalance: state.settings.risk.accountBalance });

  // ---- Countdown hero (US Stocks Regular + Forex New York, live to the second) ----
  const countdownHero = el("div", { class: "card countdown-hero" });
  root.appendChild(countdownHero);

  const clockLine = el("div", { class: "clock-time-small" });
  root.appendChild(clockLine);

  let cachedTargets = computeKeySessionCountdowns(new Date(), tz);
  const refreshTargets = () => {
    cachedTargets = computeKeySessionCountdowns(new Date(), tz);
  };
  const tick = () => {
    const now = new Date();
    clockLine.textContent = `${formatClock(now, tz)} · ${tz}`;
    countdownHero.innerHTML = "";
    cachedTargets.forEach((k) => {
      const ms = k.targetAt ? k.targetAt - now : null;
      if (ms !== null && ms < 0) refreshTargets(); // rolled over — recompute targets
      countdownHero.appendChild(
        el("div", { class: `countdown-row ${k.active ? "is-active" : "is-inactive"}` }, [
          el("span", { class: "countdown-market" }, k.label),
          el("div", { class: "countdown-value-wrap" }, [
            el("span", { class: "countdown-phase" }, k.active ? "closes in" : "opens in"),
            el("span", { class: "countdown-value" }, k.targetAt ? formatCountdownHMS(Math.max(0, ms)) : "—"),
          ]),
        ])
      );
    });
  };
  tick();
  const secondInterval = setInterval(tick, 1000);
  const refreshInterval = setInterval(refreshTargets, 30000);
  state.registerInterval(secondInterval);
  state.registerInterval(refreshInterval);

  // ---- Market Focus — condensed to essentials ----
  const focus = computeMarketFocus(new Date(), tz);
  root.appendChild(
    el("div", { class: `card focus-card focus-${focus.focus.market}` }, [
      el("div", { class: "focus-market" }, `Focus Now: ${labelForMarket(focus.focus.market)}`),
      el("p", { class: "focus-reason" }, focus.focus.reason),
    ])
  );

  // ---- Stats ----
  const statsGrid = el("div", { class: "stats-grid" }, [
    statCard(
      "Account Balance",
      fmtUSD(livePerf.endingBalance),
      `${liveTrades.filter((t) => t.status === "WIN" || t.status === "LOSS" || t.status === "AMBIGUOUS").length} closed trades · tap to view`,
      () => toggleClosedTradesSection()
    ),
    statCard("Today's P&L", fmtUSD(summary.metrics.netPnL)),
    statCard("Today's Win %", summary.metrics.winPct === null ? "N/A" : fmtPct(summary.metrics.winPct)),
    statCard(
      "Live Mode",
      liveStatus.available ? "Available" : "Completed",
      liveStatus.available
        ? `${(liveStatus.dailyLimit || 1) - (liveStatus.completedCount || 0)} of ${liveStatus.dailyLimit || 1} trade(s) left today`
        : liveStatus.reason.replace(/_/g, " ")
    ),
  ]);
  root.appendChild(statsGrid);

  // ---- Closed Trades — inline, not a popup, toggled by tapping Account Balance ----
  const closedTradesSection = el("div", { class: "closed-trades-section", style: "display:none" });
  root.appendChild(closedTradesSection);
  let closedTradesBuilt = false;
  function toggleClosedTradesSection() {
    const isOpen = closedTradesSection.style.display !== "none";
    if (isOpen) {
      closedTradesSection.style.display = "none";
      return;
    }
    closedTradesSection.style.display = "block";
    if (!closedTradesBuilt) {
      closedTradesBuilt = true;
      closedTradesSection.appendChild(el("div", { class: "section-title" }, "Closed Trades"));
      closedTradesSection.appendChild(el("p", { class: "focus-reason" }, "Every closed trade, with the date/time it closed. Open trades aren't shown here — see Journal for those."));
      const closedOnly = allTrades.filter((t) => t.status !== "OPEN").sort((a, b) => new Date(b.resolvedAt || b.createdAt) - new Date(a.resolvedAt || a.createdAt));
      const container = el("div", {});
      closedTradesSection.appendChild(container);
      renderTradeLogBrowser(container, closedOnly, {
        modeOptions: [
          { value: "all", label: "All Modes" },
          { value: "live", label: "Live Mode" },
          { value: "test", label: "Test Mode" },
        ],
        getMode: (t) => t.mode,
        emptyMessage: "No closed trades yet.",
      });
    }
    closedTradesSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Market Pulse: factual news headlines + non-predictive "notable activity" ----
  root.appendChild(el("div", { class: "section-title" }, "Market Pulse"));
  root.appendChild(marketPulseNewsCard(state));
  root.appendChild(marketPulseActivityCard(state, focus.focus.market));
}

function marketPulseNewsCard(state) {
  const card = el("div", { class: "card market-pulse-card" });
  const finnhubKey = state.settings.apiKeys.finnhub;
  if (!finnhubKey) {
    card.appendChild(el("p", { class: "focus-reason" }, "Add a free Finnhub API key in Settings to see real market headlines here — this app never invents news."));
    card.appendChild(el("button", { class: "btn", onclick: () => state.goToSettings() }, "Add Finnhub key →"));
    return card;
  }
  card.appendChild(el("p", { class: "loading-inline" }, "Loading headlines…"));
  fetchMarketNews(finnhubKey)
    .then((result) => {
      card.innerHTML = "";
      if (!result.available) {
        card.appendChild(el("p", { class: "focus-reason" }, "Couldn't load news right now (this is just headlines — it never affects any signal or scan)."));
        return;
      }
      if (!result.articles.length) {
        card.appendChild(el("p", { class: "empty-state" }, "No headlines returned right now."));
        return;
      }
      result.articles.forEach((a) => {
        card.appendChild(
          el("a", { href: a.url, target: "_blank", class: "news-item" }, [
            el("div", { class: "news-headline" }, a.headline),
            el("div", { class: "news-meta" }, `${a.source} · ${a.datetime.toLocaleString()}`),
          ])
        );
      });
    })
    .catch(() => {
      card.innerHTML = "";
      card.appendChild(el("p", { class: "focus-reason" }, "Couldn't load news right now."));
    });
  return card;
}

function marketPulseActivityCard(state, market) {
  const card = el("div", { class: "card market-pulse-card" });
  card.appendChild(el("div", { class: "provider-subheading" }, `Notable Activity — ${labelForMarket(market)}`));
  card.appendChild(
    el("p", { class: "focus-reason" }, "Symbols in your watchlist currently showing elevated volume or a breakout regime, right now. This is a factual observation, not a trade recommendation — always run Check for Trade before acting on anything.")
  );
  const resultsWrap = el("div", {});
  const btn = el("button", { class: "btn", onclick: async () => {
    btn.disabled = true;
    btn.textContent = "Checking…";
    resultsWrap.innerHTML = "";
    try {
      const watchlist = state.settings.watchlists?.[market] || DEFAULT_WATCHLISTS[market];
      const activity = await scanNotableActivity({
        market,
        watchlist,
        apiKeys: state.settings.apiKeys,
        forceProviderId: state.settings.dataProviderOverride?.[market],
      });
      if (!activity.length) {
        resultsWrap.appendChild(el("p", { class: "empty-state" }, "Nothing showing elevated activity in your watchlist right now."));
      } else {
        activity.forEach((a) => {
          resultsWrap.appendChild(
            el("div", { class: "activity-row" }, [
              el("span", { class: "ticker" }, a.symbol),
              el("span", { class: "activity-detail" }, a.rvol >= 1.5 ? `${a.rvol.toFixed(2)}x volume` : a.regime),
              dataStatusBadge(a.isDemo ? "DEMO" : a.dataStatus),
            ])
          );
        });
      }
    } catch {
      resultsWrap.appendChild(el("p", { class: "notice notice-error" }, "Couldn't check activity right now — try again shortly."));
    } finally {
      btn.disabled = false;
      btn.textContent = "Check Notable Activity";
    }
  } }, "Check Notable Activity");
  card.appendChild(btn);
  card.appendChild(resultsWrap);
  return card;
}

function labelForMarket(m) {
  return { us_stocks: "US Stocks", forex: "Forex", crypto: "Crypto" }[m] || m;
}

// -------------------------------------------------------------- SCAN
function scanLegend() {
  const details = document.createElement("details");
  details.className = "scan-legend";
  const summary = document.createElement("summary");
  summary.textContent = "What do Live, Delayed, Qualifying, and Rejected mean?";
  details.appendChild(summary);
  const items = [
    ["Live", "Real, current-as-of-seconds data (currently: Crypto via Binance only)."],
    ["Delayed", "Real data, but not guaranteed up-to-the-second (currently: Stocks/Forex via Twelve Data)."],
    ["Stale", "Data came back too old to trust — new signals are blocked until it refreshes."],
    ["Demo Mode", "No real data source configured — simulated, deterministic fake data so you can try the app."],
    ["Qualifying", "This symbol had a setup that passed every filter — it's shown above as a signal card."],
    ["Rejected", "A strategy's entry condition triggered, but it failed a quality/risk check (weak confirmation, poor R:R, etc). This is the app working correctly, not an error — most scans reject far more than they qualify."],
    ["No Setup Detected", "None of the strategies for this market saw a matching pattern on the latest candle right now — nothing to reject, there was just nothing there."],
  ];
  const list = document.createElement("div");
  list.className = "scan-legend-list";
  items.forEach(([term, desc]) => {
    const row = document.createElement("div");
    row.className = "scan-legend-row";
    const t = document.createElement("strong");
    t.textContent = term;
    const d = document.createElement("span");
    d.textContent = desc;
    row.appendChild(t);
    row.appendChild(d);
    list.appendChild(row);
  });
  details.appendChild(list);
  return details;
}

function windowVerdictRow(market) {
  const w = assessTradingWindow(market, new Date());
  const cls = { Good: "is-good", Fair: "is-fair", Weak: "is-weak", Closed: "is-closed" }[w.verdict] || "is-fair";
  return el("div", { class: "window-verdict" }, [
    el("span", { class: `window-verdict-pill ${cls}` }, `${w.verdict} Window`),
    el("p", { class: "window-verdict-reason" }, w.reason),
  ]);
}

function renderMarketStatusCard(container, market, state) {
  container.innerHTML = "";
  const tz = state.effectiveTimeZone();
  const card = el("div", { class: "card market-status-card" });
  container.appendChild(card);

  if (state.scanIntervalId) {
    clearInterval(state.scanIntervalId);
    state.scanIntervalId = null;
  }

  if (market === "crypto") {
    card.appendChild(el("div", { class: "market-status-row" }, [el("span", { class: "market-status-badge is-active" }, "Open 24/7")]));
    card.appendChild(windowVerdictRow(market));
    return;
  }

  const sessionId = market === "us_stocks" ? "us_regular" : "newyork_fx";
  let cached = computeKeySessionCountdowns(new Date(), tz).find((k) => k.id === sessionId);
  const refresh = () => {
    cached = computeKeySessionCountdowns(new Date(), tz).find((k) => k.id === sessionId);
  };

  const tick = () => {
    const now = new Date();
    let ms = cached.targetAt ? cached.targetAt - now : null;
    if (ms !== null && ms < 0) {
      refresh();
      ms = cached.targetAt ? cached.targetAt - now : null;
    }
    card.innerHTML = "";
    card.appendChild(
      el("div", { class: "market-status-row" }, [
        el("span", { class: `market-status-badge ${cached.active ? "is-active" : "is-inactive"}` }, cached.active ? "Open Now" : "Closed"),
        el("span", { class: "market-status-countdown" }, ms !== null ? `${cached.active ? "closes" : "opens"} in ${formatCountdownHMS(Math.max(0, ms))}` : "—"),
      ])
    );
    card.appendChild(windowVerdictRow(market));
  };
  tick();
  const id = setInterval(tick, 1000);
  state.scanIntervalId = id;
  state.registerInterval(id);
}

export async function renderScan(root, state) {
  root.innerHTML = "";
  const market = state.currentScanMarket || "us_stocks";

  const tabs = el(
    "div",
    { class: "sub-tabs" },
    ["us_stocks", "forex", "crypto"].map((m) =>
      el("button", { class: `sub-tab ${m === market ? "active" : ""}`, onclick: () => { state.currentScanMarket = m; renderScan(root, state); } }, labelForMarket(m))
    )
  );
  root.appendChild(tabs);

  const statusContainer = el("div", {});
  root.appendChild(statusContainer);
  renderMarketStatusCard(statusContainer, market, state);

  const modeRow = el("div", { class: "mode-row" }, [
    el("label", {}, [
      el("input", { type: "radio", name: "trademode", checked: state.tradeMode === "live" ? "checked" : null, onchange: () => { state.tradeMode = "live"; renderScan(root, state); } }),
      " Live Mode",
    ]),
    el("label", {}, [
      el("input", { type: "radio", name: "trademode", checked: state.tradeMode === "test" ? "checked" : null, onchange: () => { state.tradeMode = "test"; renderScan(root, state); } }),
      " Test Mode",
    ]),
  ]);
  root.appendChild(modeRow);

  root.appendChild(scanLegend());

  const isDemoForThisMarket = state.settings.dataProviderOverride?.[market] === "demo" || (market !== "crypto" && !state.settings.apiKeys.twelvedata && !state.settings.apiKeys.twelvedataBackup);

  if (isDemoForThisMarket) {
    root.appendChild(
      el("div", { class: "notice notice-demo" }, [
        el("strong", {}, "Demo Mode: "),
        market === "crypto"
          ? "Demo override enabled in Settings."
          : "No Twelve Data API key configured — add a free key in Settings to scan real US Stocks/Forex data. Showing deterministic demo data so you can exercise the full workflow.",
      ])
    );
    if (state.tradeMode === "live") {
      root.appendChild(
        el("div", { class: "notice notice-error" }, [
          el("strong", {}, "Live Mode is selected, but this market is on Demo data. "),
          "Live Mode trades can only be executed against real data — the PAPER TRADE button will be disabled on any signal below until you add an API key or switch to Test Mode.",
        ])
      );
    }
  }

  const scanBtn = el("button", { class: "btn btn-primary btn-large", onclick: () => runScan() }, "Check for Trade");
  root.appendChild(scanBtn);

  const resultsWrap = el("div", { class: "scan-results" });
  root.appendChild(resultsWrap);

  async function runScan() {
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning…";
    resultsWrap.innerHTML = "";
    try {
      const forceProviderId = state.settings.dataProviderOverride?.[market];
      const result = await scanMarket({
        market,
        watchlist: state.settings.watchlists?.[market] || DEFAULT_WATCHLISTS[market],
        riskSettings: state.settings.risk,
        apiKeys: state.settings.apiKeys,
        forceProviderId,
      });

      for (const perSymbol of result.perSymbol) {
        for (const sig of perSymbol.qualifying) await saveSignal(sig, state.effectiveTimeZone());
      }

      const dataBadgeRow = el("div", { class: "data-status-row" }, [dataStatusBadge(result.isDemo ? "DEMO" : result.perSymbol[0]?.dataStatus)]);
      resultsWrap.appendChild(dataBadgeRow);

      const candleTimeframe = market === "us_stocks" ? "15-minute" : "1-hour";
      const candleSpan = market === "us_stocks" ? "≈7–8 trading days" : "≈8 days";
      resultsWrap.appendChild(
        el(
          "p",
          { class: "scan-context-note" },
          `Scanned the last 200 ${candleTimeframe} candles per symbol (${candleSpan} of history) across ${result.symbolsScanned} symbol(s).`
        )
      );

      if (result.qualifying.length === 0) {
        resultsWrap.appendChild(
          el("div", { class: "no-trade-card" }, [
            el("div", { class: "no-trade-title" }, "No Qualifying Trade"),
            el("p", {}, `No setup met the minimum confirmation, risk/reward, or no-trade filter requirements right now — see the breakdown below for exactly why each symbol was passed over.`),
          ])
        );
      } else {
        resultsWrap.appendChild(el("p", { class: "scan-context-note" }, `${result.qualifying.length} qualifying setup${result.qualifying.length === 1 ? "" : "s"} found.`));
        result.qualifying.forEach((sig) => {
          resultsWrap.appendChild(
            signalCard(sig, {
              onPaperTrade: (s) => openTradeModal(s, state),
              onMissed: async (s) => {
                await markSignalMissed(s, state.effectiveTimeZone());
                alert("Marked as missed. It will not count toward wins/losses.");
              },
              blockedReason:
                state.tradeMode === "live" && sig.isDemo
                  ? "Live Mode can't execute a trade on Demo data. Switch to Test Mode, or add a real data API key in Settings."
                  : null,
            })
          );
        });
      }

      resultsWrap.appendChild(el("div", { class: "section-title" }, `Symbols Scanned (${result.perSymbol.length})`));
      resultsWrap.appendChild(symbolsScannedTable(result.perSymbol));
    } catch (e) {
      resultsWrap.appendChild(el("div", { class: "notice notice-error" }, friendlyErrorMessage(e)));
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = "Check for Trade";
    }
  }
}

/** Full per-symbol audit trail: qualifying / rejected (with reasons) / no setup detected — every symbol scanned, accounted for. */
function symbolsScannedTable(perSymbolResults) {
  const container = el("div", { class: "symbol-audit-list" });
  perSymbolResults.forEach((r) => {
    const hasQualifying = r.qualifying.length > 0;
    const hasRejected = (r.rejected || []).length > 0;
    const statusLabel = r.error ? "Data Issue" : hasQualifying ? "Qualifying" : hasRejected ? "Rejected" : "No Setup Detected";
    const statusClass = r.error ? "audit-issue" : hasQualifying ? "audit-qualifying" : hasRejected ? "audit-rejected" : "audit-none";

    const row = el("div", { class: "symbol-audit-row" });
    const header = el("div", { class: "symbol-audit-header" }, [
      el("span", { class: "ticker" }, r.symbol),
      el("span", { class: `audit-status-pill ${statusClass}` }, statusLabel),
      dataStatusBadge(r.isDemo ? "DEMO" : r.dataStatus),
    ]);
    row.appendChild(header);

    if (r.error) {
      row.appendChild(el("p", { class: "audit-detail" }, r.error));
    } else if (hasQualifying) {
      row.appendChild(el("p", { class: "audit-detail" }, `${r.qualifying.length} qualifying setup(s): ${r.qualifying.map((q) => q.strategyName).join(", ")}.`));
    } else if (hasRejected) {
      const list = el("ul", { class: "audit-reasons" });
      r.rejected.forEach((rej) => {
        list.appendChild(el("li", {}, [el("strong", {}, `${rej.strategyName}: `), rej.rejectionReasons.join(" ")]));
      });
      row.appendChild(list);
    } else {
      row.appendChild(el("p", { class: "audit-detail" }, `None of the ${r.strategiesEvaluated ?? "applicable"} strategies for this market found a matching entry pattern on the latest candle.`));
    }
    container.appendChild(row);
  });
  return container;
}

function openTradeModal(signal, state) {
  const modal = buildModal(`Confirm Paper Trade — ${signal.symbol}`);
  const entryInput = el("input", { type: "number", step: "any", value: signal.idealEntry, class: "input" });
  const recalcOut = el("div", { class: "recalc-out" });

  function recalc() {
    const entry = parseFloat(entryInput.value);
    if (Number.isNaN(entry) || entry < signal.entryZone.low * 0.5 || entry > signal.entryZone.high * 1.5) {
      recalcOut.innerHTML = "";
      recalcOut.appendChild(el("p", { class: "notice notice-error" }, "Entry is far outside the entry zone."));
      return null;
    }
    const result = recalculateTrade({
      direction: signal.direction,
      entryPrice: entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      settings: state.settings.risk,
      minRR: 1, // display-only recalculation; strategy minRR already enforced at scan time
    });
    recalcOut.innerHTML = "";
    if (!result.valid) {
      recalcOut.appendChild(el("p", { class: "notice notice-error" }, result.reason));
      return null;
    }
    recalcOut.appendChild(
      el("div", { class: "recalc-grid" }, [
        el("span", {}, `Take Profit: ${result.takeProfit.toFixed(4)}`),
        el("span", {}, `Position size: ${result.units.toFixed(4)}`),
        el("span", {}, `Risk: ${fmtUSD(result.dollarRisk)}`),
        el("span", {}, `Reward: ${fmtUSD(result.potentialReward)}`),
        el("span", {}, `R:R: 1:${result.rr.toFixed(2)}`),
      ])
    );
    if (result.capped) {
      recalcOut.appendChild(el("p", { class: "capped-note" }, result.note));
    }
    return result;
  }
  entryInput.addEventListener("input", recalc);
  let sizing = recalc();

  modal.body.appendChild(el("p", {}, `Entry zone: ${signal.entryZone.low} – ${signal.entryZone.high}`));
  modal.body.appendChild(el("label", { class: "field-label" }, "Actual entry price"));
  modal.body.appendChild(entryInput);
  modal.body.appendChild(recalcOut);

  const confirmBtn = el("button", { class: "btn btn-primary", onclick: async () => {
    const latestSizing = recalc();
    if (!latestSizing) return;
    try {
      const trade = await executeTrade({ signal, actualEntry: parseFloat(entryInput.value), sizing: latestSizing, mode: state.tradeMode, timeZone: state.effectiveTimeZone(), liveModeDailyLimit: state.settings.risk.liveModeDailyLimit });
      alert(`Trade recorded (${state.tradeMode === "live" ? "Live Mode" : "Test Mode"}). Track it in the Journal tab.`);
      modal.overlay.remove();
    } catch (e) {
      alert(e.message);
    }
  } }, "Confirm Paper Trade");
  modal.body.appendChild(confirmBtn);

  document.body.appendChild(modal.overlay);
}

function buildModal(title) {
  const overlay = el("div", { class: "modal-overlay", onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const box = el("div", { class: "modal-box" });
  box.appendChild(el("div", { class: "modal-header" }, [el("h3", {}, title), el("button", { class: "modal-close", onclick: () => overlay.remove() }, "✕")]));
  const body = el("div", { class: "modal-body" });
  box.appendChild(body);
  overlay.appendChild(box);
  return { overlay, body };
}

function friendlyErrorMessage(e) {
  return e?.userMessage || "Something went wrong retrieving market data. Please wait a moment and try again.";
}

// -------------------------------------------------------------- OTHERS (menu + sub-views)
const OTHERS_MENU = [
  { id: "journal", label: "Journal", icon: "📔", desc: "Every trade you've taken, in one list", render: renderJournal },
  { id: "daily", label: "Today", icon: "📅", desc: "Today's signal funnel and trades", render: renderDailySummary },
  { id: "performance", label: "Performance", icon: "📈", desc: "Win rate, P&L, equity curve over time", render: renderPerformance },
  { id: "backtest", label: "Backtest", icon: "🧪", desc: "Test a strategy against historical data", render: renderBacktest },
  { id: "lab", label: "Strategy Lab", icon: "🔬", desc: "Factual performance per strategy", render: renderStrategyLab },
];

export async function renderOthers(root, state) {
  root.innerHTML = "";

  if (!state.othersView) {
    root.appendChild(el("div", { class: "section-title" }, "More"));
    const menu = el("div", { class: "others-menu" });
    OTHERS_MENU.forEach((item) => {
      menu.appendChild(
        el("button", { class: "others-menu-item", onclick: () => { state.clearIntervals(); state.othersView = item.id; renderOthers(root, state); } }, [
          el("span", { class: "others-menu-icon" }, item.icon),
          el("div", { class: "others-menu-text" }, [el("div", { class: "others-menu-label" }, item.label), el("div", { class: "others-menu-desc" }, item.desc)]),
          el("span", { class: "others-menu-chevron" }, "›"),
        ])
      );
    });
    root.appendChild(menu);
    return;
  }

  const item = OTHERS_MENU.find((i) => i.id === state.othersView);
  const backBar = el("button", { class: "back-bar", onclick: () => { state.clearIntervals(); state.othersView = null; renderOthers(root, state); } }, "‹ Back to More");
  root.appendChild(backBar);
  const subRoot = el("div", {});
  root.appendChild(subRoot);
  if (item) await item.render(subRoot, state);
}

// -------------------------------------------------------------- REUSABLE TRADE LOG BROWSER
// Used by Journal, the Home "Account Balance" drill-down, and Backtest's
// individual-trade list — one filterable (date range + mode), paginated
// (10 at a time) trade list, so all three stay visually and behaviorally
// consistent instead of three separate one-off implementations.
function renderTradeLogBrowser(container, allTrades, options = {}) {
  const pageSize = options.pageSize || 10;
  const modeOptions = options.modeOptions || null; // [{value, label}] or null to omit the filter
  const getMode = options.getMode || (() => "all");
  const rowRenderer = options.rowRenderer || ((t) => tradeRow(t, t.__live || null));
  const emptyMessage = options.emptyMessage || "No trades match these filters.";

  let modeFilter = "all";
  let dateFrom = null;
  let dateTo = null;
  let visibleCount = pageSize;

  const controls = el("div", { class: "tradelog-controls" });
  if (modeOptions) {
    controls.appendChild(
      el(
        "select",
        {
          class: "input tradelog-mode-select",
          onchange: (e) => {
            modeFilter = e.target.value;
            visibleCount = pageSize;
            refresh();
          },
        },
        modeOptions.map((o) => el("option", { value: o.value }, o.label))
      )
    );
  }
  controls.appendChild(
    el("div", { class: "tradelog-date-row" }, [
      el("label", { class: "field-label" }, "From"),
      el("input", {
        type: "date",
        class: "input tradelog-date",
        onchange: (e) => {
          dateFrom = e.target.value || null;
          visibleCount = pageSize;
          refresh();
        },
      }),
      el("label", { class: "field-label" }, "To"),
      el("input", {
        type: "date",
        class: "input tradelog-date",
        onchange: (e) => {
          dateTo = e.target.value || null;
          visibleCount = pageSize;
          refresh();
        },
      }),
    ])
  );

  const listWrap = el("div", { class: "trade-list" });
  const loadMoreWrap = el("div", { class: "tradelog-loadmore" });

  function filteredTrades() {
    return allTrades.filter((t) => {
      if (modeFilter !== "all" && getMode(t) !== modeFilter) return false;
      const d = (t.createdAt || "").slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  function refresh() {
    const rows = filteredTrades();
    listWrap.innerHTML = "";
    if (!rows.length) {
      listWrap.appendChild(el("p", { class: "empty-state" }, emptyMessage));
    } else {
      rows.slice(0, visibleCount).forEach((t) => listWrap.appendChild(rowRenderer(t)));
    }
    loadMoreWrap.innerHTML = "";
    if (rows.length > visibleCount) {
      const remaining = rows.length - visibleCount;
      loadMoreWrap.appendChild(
        el(
          "button",
          {
            class: "btn",
            onclick: () => {
              visibleCount += pageSize;
              refresh();
            },
          },
          `Load ${Math.min(pageSize, remaining)} more (${remaining} left)`
        )
      );
    }
  }

  container.appendChild(controls);
  container.appendChild(listWrap);
  container.appendChild(loadMoreWrap);
  refresh();

  // Exposed so callers can patch trade objects in place (e.g. once a live
  // price arrives) and re-render without losing filter/pagination state.
  return { refresh, listWrap };
}

// -------------------------------------------------------------- JOURNAL
export async function renderJournal(root, state) {
  root.innerHTML = "";
  const trades = (await getAll("trades")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  root.appendChild(el("div", { class: "section-title" }, `Journal (${trades.length} trades)`));
  if (!trades.length) {
    root.appendChild(el("p", { class: "empty-state" }, "No trades yet. Run Check for Trade and paper trade a signal to start your journal."));
    return;
  }

  const listContainer = el("div", {});
  root.appendChild(listContainer);
  const browser = renderTradeLogBrowser(listContainer, trades, {
    modeOptions: [
      { value: "all", label: "All Modes" },
      { value: "live", label: "Live Mode" },
      { value: "test", label: "Test Mode" },
    ],
    getMode: (t) => t.mode,
    emptyMessage: "No trades match these filters.",
  });

  if (!trades.some((t) => t.status === "OPEN")) return;

  // Fetch current price + volatility (ATR) for every OPEN trade's symbol (deduped by
  // symbol+market), patching trade objects in place (by id, never by DOM index) so
  // re-rendering is always safe regardless of the browser's filter/pagination state.
  // Refreshed periodically (not just once) so the pace estimate actually responds to
  // current market conditions rather than going stale the moment you open the page.
  //
  // IMPORTANT: resolution is checked HERE FIRST, every cycle — not just on tab
  // navigation elsewhere in the app. Previously the Journal's own live-price
  // display could show a price past TP/SL while the trade's actual status field
  // only got re-checked when you happened to switch tabs, so a trade could sit
  // there looking "OPEN" with a current price well past its target. Now the
  // same refresh that updates the displayed price also resolves the trade
  // first, using that same fresh data, so the two can never disagree.
  async function refreshLiveData() {
    const resolution = await checkAndResolveOpenTrades(state);
    if (resolution.resolved > 0) {
      // Pull the updated statuses back into our in-memory trade objects (by id)
      // so the existing DOM patch-by-id flow below stays correct.
      const freshTrades = await getAll("trades");
      const freshById = new Map(freshTrades.map((t) => [t.id, t]));
      trades.forEach((t, i) => {
        const fresh = freshById.get(t.id);
        if (fresh && fresh.status !== t.status) trades[i] = fresh;
      });
    }

    const openTrades = trades.filter((t) => t.status === "OPEN");
    if (!openTrades.length) {
      browser.refresh();
      return;
    }

    const uniqueKeys = [...new Set(openTrades.map((t) => `${t.market}:${t.symbol}`))];
    await Promise.all(
      uniqueKeys.map(async (key) => {
        const [market, symbol] = key.split(":");
        let price = null;
        let atrVal = null;
        let lastPatternLabel = null;
        const timeframe = market === "us_stocks" ? "15m" : "1h";
        const timeframeMs = { "15m": 900000, "1h": 3600000 }[timeframe];
        try {
          // limit:30 (not just the last candle) so we can also read recent volatility (ATR) for the pace estimate below.
          const data = await getMarketData({ symbol, market, timeframe, limit: 30, apiKeys: state.settings.apiKeys, forceProviderId: state.settings.dataProviderOverride?.[market] });
          const candles = data.candles;
          price = candles?.[candles.length - 1]?.c ?? null;
          if (candles && candles.length >= 15) {
            const atrSeries = atr(candles, 14);
            atrVal = atrSeries[atrSeries.length - 1];
          }
          if (candles && candles.length >= 4) {
            // Factual, backward-looking only — what pattern the most recent completed
            // candle actually formed. Deliberately NOT a prediction of what forms next;
            // no honest method exists to predict a future candlestick shape, so this
            // app doesn't pretend to. See the note rendered alongside it in the UI.
            const patterns = detectPatternsAt(candles, candles.length - 1);
            lastPatternLabel = patterns.length ? patterns.map((p) => p.name.replace(/([A-Z])/g, " $1").trim()).join(", ") : null;
          }
        } catch {
          price = null;
        }
        if (price === null) return;
        const now = Date.now();
        trades.forEach((t) => {
          if (t.status !== "OPEN" || `${t.market}:${t.symbol}` !== key) return;
          const risk = Math.abs(t.entryPrice - t.stopLoss);
          const priceDelta = t.direction === "long" ? price - t.entryPrice : t.entryPrice - price;
          const distanceToTP = t.takeProfit !== null && t.takeProfit !== undefined ? Math.abs(t.takeProfit - price) : null;
          const distanceToSL = Math.abs(t.stopLoss - price);
          const paceMs = estimatePaceMs(distanceToTP, atrVal, timeframeMs);
          t.__live = {
            currentPrice: price,
            unrealizedPnl: priceDelta * t.positionSize,
            unrealizedR: risk > 0 ? priceDelta / risk : null,
            distanceToTP,
            distanceToSL,
            paceMs,
            paceTargetAt: paceMs !== null ? new Date(now + paceMs) : null,
            lastPattern: lastPatternLabel,
          };
        });
      })
    );
    browser.refresh();
  }

  await refreshLiveData();

  // Live-tick every open trade's pace countdown every second (pure client-side
  // math against the target timestamp — no network call), and refresh the
  // underlying price/volatility data every 60s so the estimate itself stays
  // current with actual market conditions, not just a stale one-time snapshot.
  const tickInterval = setInterval(() => {
    const now = Date.now();
    listContainer.querySelectorAll(".pace-countdown[data-pace-target]").forEach((elNode) => {
      const target = new Date(elNode.getAttribute("data-pace-target")).getTime();
      const remaining = target - now;
      elNode.textContent = remaining > 0 ? formatCountdownHMS(remaining) : "due now";
    });
  }, 1000);
  const refreshInterval = setInterval(refreshLiveData, 60000);
  state.registerInterval(tickInterval);
  state.registerInterval(refreshInterval);
}

// -------------------------------------------------------------- DAILY SUMMARY
export async function renderDailySummary(root, state) {
  root.innerHTML = "";
  const summary = await getDailySummary({ timeZone: state.effectiveTimeZone(), startingBalance: state.settings.risk.accountBalance, mode: "all" });

  root.appendChild(el("div", { class: "card headline-card" }, [el("div", { class: "headline-label" }, "Today"), el("div", { class: "headline-text" }, summary.headline)]));
  root.appendChild(
    el("div", { class: "balance-row" }, [
      el("span", {}, `Starting: ${fmtUSD(summary.startingBalance)}`),
      el("span", {}, `Ending: ${fmtUSD(summary.endingBalance)}`),
    ])
  );

  root.appendChild(el("div", { class: "section-title" }, "Signal Funnel"));
  root.appendChild(funnelBar(summary.funnel));

  root.appendChild(el("div", { class: "section-title" }, "Metrics"));
  const m = summary.metrics;
  root.appendChild(
    el("div", { class: "stats-grid" }, [
      statCard("Net P&L", fmtUSD(m.netPnL)),
      statCard("Win %", m.winPct === null ? "N/A" : fmtPct(m.winPct)),
      statCard("Avg Win", m.avgWin === null ? "—" : fmtUSD(m.avgWin)),
      statCard("Avg Loss", m.avgLoss === null ? "—" : fmtUSD(m.avgLoss)),
      statCard("Profit Factor", m.profitFactor === null ? "—" : m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(2)),
      statCard("Expectancy", m.expectancy === null ? "—" : fmtUSD(m.expectancy)),
      statCard("Avg R", m.avgR === null ? "—" : `${m.avgR}R`),
      statCard("Max Drawdown", fmtUSD(m.maxDrawdown)),
    ])
  );

  root.appendChild(el("div", { class: "section-title" }, "Strategy Breakdown"));
  root.appendChild(breakdownTable(m.breakdownByStrategy));
  root.appendChild(el("div", { class: "section-title" }, "Market Breakdown"));
  root.appendChild(breakdownTable(m.breakdownByMarket));
  root.appendChild(el("div", { class: "section-title" }, "Session Breakdown"));
  root.appendChild(breakdownTable(m.breakdownBySession));

  root.appendChild(el("div", { class: "section-title" }, "Today's Trades"));
  if (!summary.trades.length) root.appendChild(el("p", { class: "empty-state" }, "No trades yet today."));
  const list = el("div", { class: "trade-list" });
  summary.trades.forEach((t) => list.appendChild(tradeRow(t)));
  root.appendChild(list);
}

function breakdownTable(rows) {
  if (!rows.length) return el("p", { class: "empty-state" }, "No completed trades yet.");
  const table = el("table", { class: "breakdown-table" });
  table.appendChild(
    el("tr", {}, ["Name", "Trades", "Win %", "P&L", "Avg R"].map((h) => el("th", {}, h)))
  );
  rows.forEach((r) => {
    table.appendChild(
      el("tr", {}, [
        el("td", {}, r.key),
        el("td", {}, String(r.trades)),
        el("td", {}, r.winPct === null ? "N/A" : `${r.winPct}%`),
        el("td", {}, fmtUSD(r.pnl)),
        el("td", {}, r.avgR === null ? "—" : `${r.avgR}R`),
      ])
    );
  });
  return table;
}

// -------------------------------------------------------------- PERFORMANCE DASHBOARD
const TIME_FILTERS = [
  ["today", "Today", 1],
  ["7d", "7 Days", 7],
  ["30d", "30 Days", 30],
  ["90d", "90 Days", 90],
  ["6m", "6 Months", 182],
  ["1y", "1 Year", 365],
  ["all", "All Time", null],
];

export async function renderPerformance(root, state) {
  root.innerHTML = "";
  const filter = state.performanceFilter || "30d";

  const tabs = el(
    "div",
    { class: "sub-tabs wrap" },
    TIME_FILTERS.map(([key, label]) => el("button", { class: `sub-tab ${key === filter ? "active" : ""}`, onclick: () => { state.performanceFilter = key; renderPerformance(root, state); } }, label))
  );
  root.appendChild(tabs);

  const allTrades = await getAll("trades");
  const days = TIME_FILTERS.find(([k]) => k === filter)[2];
  const cutoff = days ? Date.now() - days * 86400000 : null;
  const filtered = allTrades.filter((t) => !cutoff || new Date(t.createdAt).getTime() >= cutoff);

  const perf = computePerformance({ trades: filtered, startingBalance: state.settings.risk.accountBalance });

  root.appendChild(
    el("div", { class: "stats-grid" }, [
      statCard("Trades", perf.tradesTaken),
      statCard("Win %", perf.winPct === null ? "N/A" : fmtPct(perf.winPct)),
      statCard("Net P&L", fmtUSD(perf.netPnL)),
      statCard("Profit Factor", perf.profitFactor === null ? "—" : perf.profitFactor === Infinity ? "∞" : perf.profitFactor.toFixed(2)),
      statCard("Expectancy", perf.expectancy === null ? "—" : fmtUSD(perf.expectancy)),
      statCard("Avg R", perf.avgR === null ? "—" : `${perf.avgR}R`),
      statCard("Max Drawdown", fmtUSD(perf.maxDrawdown)),
      statCard("Win/Loss Streak", `W${perf.longestWinStreak} / L${perf.longestLossStreak}`),
    ])
  );

  root.appendChild(el("div", { class: "section-title" }, "Equity Curve"));
  root.appendChild(equityCurveSVG(perf.equityCurve));

  root.appendChild(el("div", { class: "section-title" }, "Strategy Results"));
  root.appendChild(breakdownTable(perf.breakdownByStrategy));
  root.appendChild(el("div", { class: "section-title" }, "Market Results"));
  root.appendChild(breakdownTable(perf.breakdownByMarket));
  root.appendChild(el("div", { class: "section-title" }, "Session Results — which window wins more"));
  root.appendChild(el("p", { class: "focus-reason" }, "Sorted by win % (highest first) among sessions with at least 3 completed trades, so a single lucky trade doesn't look like a pattern."));
  root.appendChild(sessionBreakdownTable(perf.breakdownBySession));
}

/** Same shape as breakdownTable, but sorted by win % (sessions with too few trades to mean anything stay unsorted at the bottom, not misleadingly on top). */
function sessionBreakdownTable(rows) {
  if (!rows.length) return el("p", { class: "empty-state" }, "No completed trades yet.");
  const sorted = [...rows].sort((a, b) => {
    const aReliable = a.trades >= 3 && a.winPct !== null;
    const bReliable = b.trades >= 3 && b.winPct !== null;
    if (aReliable && !bReliable) return -1;
    if (!aReliable && bReliable) return 1;
    if (aReliable && bReliable) return b.winPct - a.winPct;
    return b.trades - a.trades;
  });
  return breakdownTable(sorted);
}

function equityCurveSVG(curve) {
  if (curve.length < 2) return el("p", { class: "empty-state" }, "Not enough resolved trades yet for an equity curve.");
  const w = 320;
  const h = 120;
  const values = curve.map((p) => p.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = curve.map((p, i) => `${(i / (curve.length - 1)) * w},${h - ((p.balance - min) / range) * h}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "equity-svg");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "var(--accent)");
  polyline.setAttribute("stroke-width", "2");
  svg.appendChild(polyline);
  return svg;
}

// -------------------------------------------------------------- BACKTEST
export async function renderBacktest(root, state) {
  root.innerHTML = "";
  root.appendChild(el("div", { class: "section-title" }, "Backtest"));
  root.appendChild(el("p", { class: "focus-reason" }, "Tests every strategy for the selected market against that symbol's real history — no manual strategy picking needed."));

  const marketSelect = el("select", { class: "input" }, ["us_stocks", "forex", "crypto"].map((m) => el("option", { value: m }, labelForMarket(m))));
  const symbolSelect = el("select", { class: "input" });

  function refreshSymbols() {
    symbolSelect.innerHTML = "";
    const symbols = state.settings.watchlists?.[marketSelect.value] || DEFAULT_WATCHLISTS[marketSelect.value];
    symbols.forEach((sym) => symbolSelect.appendChild(el("option", { value: sym }, sym)));
  }
  marketSelect.addEventListener("change", refreshSymbols);
  refreshSymbols();

  const runBtn = el("button", { class: "btn btn-primary", onclick: runIt }, "Run Backtest");
  const resultsWrap = el("div", { class: "backtest-results" });

  root.appendChild(el("label", { class: "field-label" }, "Market"));
  root.appendChild(marketSelect);
  root.appendChild(el("label", { class: "field-label" }, "Symbol"));
  root.appendChild(symbolSelect);
  root.appendChild(el("p", { class: "focus-reason" }, "Add or remove symbols in Settings → Watchlists — this dropdown always matches your current watchlist for the selected market."));
  root.appendChild(runBtn);
  root.appendChild(resultsWrap);

  const historyContainer = el("div", {});
  root.appendChild(el("div", { class: "section-title" }, "Saved Backtests"));
  root.appendChild(historyContainer);
  await renderBacktestHistory(historyContainer, state);

  let lastRun = null; // { market, symbol, strategyIds, isDemo, dataStatus, result } — set after a successful run

  async function runIt() {
    resultsWrap.innerHTML = "";
    lastRun = null;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    try {
      const market = marketSelect.value;
      const symbol = symbolSelect.value;
      const strategyIds = strategiesForMarket(market).map((s) => s.id); // always test every strategy for this market
      const timeframe = market === "us_stocks" ? "15m" : "1h";
      const data = await getMarketData({ symbol, market, timeframe, limit: 500, apiKeys: state.settings.apiKeys, forceProviderId: state.settings.dataProviderOverride?.[market] });
      if (!data.candles || data.candles.length < 65) {
        resultsWrap.appendChild(el("div", { class: "notice notice-error" }, "Not enough historical candles available for this symbol/timeframe."));
        return;
      }
      const result = runBacktest({ candles: data.candles, strategyIds, market, symbol, riskSettings: state.settings.risk });
      if (result.error) {
        resultsWrap.appendChild(el("div", { class: "notice notice-error" }, result.error));
        return;
      }
      resultsWrap.appendChild(dataStatusBadge(data.isDemo ? "DEMO" : data.status));
      resultsWrap.appendChild(el("div", { class: "section-title" }, `In-Sample (${result.inSample.count} trades)`));
      resultsWrap.appendChild(backtestStatsBlock(result.inSample.performance));
      resultsWrap.appendChild(el("div", { class: "section-title" }, `Out-of-Sample (${result.outOfSample.count} trades)`));
      resultsWrap.appendChild(backtestStatsBlock(result.outOfSample.performance));

      resultsWrap.appendChild(el("div", { class: "section-title" }, `All Trades (${result.trades.length})`));
      if (result.trades.length) {
        const tradeListContainer = el("div", {});
        resultsWrap.appendChild(tradeListContainer);
        renderTradeLogBrowser(tradeListContainer, [...result.trades].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), {
          modeOptions: [
            { value: "all", label: "All Trades" },
            { value: "inSample", label: "In-Sample" },
            { value: "outOfSample", label: "Out-of-Sample" },
          ],
          getMode: (t) => (t.inSample ? "inSample" : "outOfSample"),
          emptyMessage: "No trades match these filters.",
          rowRenderer: simpleBacktestRow,
        });
      } else {
        resultsWrap.appendChild(el("p", { class: "empty-state" }, "No trades were generated over this history — see the aggregate stats above for why (likely: no candidate ever cleared confirmation/risk checks in this window)."));
      }

      resultsWrap.appendChild(el("div", { class: "section-title" }, "Caveats"));
      resultsWrap.appendChild(el("ul", { class: "caveat-list" }, result.caveats.map((c) => el("li", {}, c))));

      lastRun = { market, symbol, strategyIds, isDemo: !!data.isDemo, dataStatus: data.status, result };
      const saveBtn = el("button", { class: "btn", onclick: async () => {
        await saveBacktestRun(lastRun);
        await renderBacktestHistory(historyContainer, state);
        saveBtn.textContent = "Saved ✓";
        saveBtn.disabled = true;
      } }, "💾 Save this backtest");
      resultsWrap.appendChild(saveBtn);
    } catch (e) {
      resultsWrap.appendChild(el("div", { class: "notice notice-error" }, friendlyErrorMessage(e)));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Run Backtest";
    }
  }
}

async function saveBacktestRun(run) {
  const record = {
    id: uid("backtest"),
    createdAt: new Date().toISOString(),
    market: run.market,
    symbol: run.symbol,
    strategyIds: run.strategyIds,
    isDemo: run.isDemo,
    dataStatus: run.dataStatus,
    totalBars: run.result.totalBars,
    inSampleCount: run.result.inSample.count,
    outOfSampleCount: run.result.outOfSample.count,
    inSamplePerformance: run.result.inSample.performance,
    outOfSamplePerformance: run.result.outOfSample.performance,
    trades: run.result.trades, // full per-trade detail, not just the aggregate stats — so saved runs can be reviewed trade-by-trade later too
  };
  await put("backtests", record);
  return record;
}

async function renderBacktestHistory(container, state) {
  container.innerHTML = "";
  const runs = (await getAll("backtests")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!runs.length) {
    container.appendChild(el("p", { class: "empty-state" }, "No saved backtests yet — run one above and tap \"Save this backtest\" to keep it here for comparison later."));
    return;
  }
  runs.forEach((run) => {
    const perf = run.outOfSamplePerformance?.tradesTaken ? run.outOfSamplePerformance : run.inSamplePerformance;
    const card = el("div", { class: "card backtest-history-card" });
    card.appendChild(
      el("div", { class: "backtest-history-header" }, [
        el("span", { class: "backtest-history-title" }, `${run.symbol} · ${labelForMarket(run.market)}`),
        dataStatusBadge(run.isDemo ? "DEMO" : run.dataStatus),
      ])
    );
    card.appendChild(el("p", { class: "backtest-history-meta" }, `${new Date(run.createdAt).toLocaleString()} · ${run.strategyIds.length} strategy(ies) · ${run.totalBars} bars`));
    card.appendChild(
      el("div", { class: "backtest-history-stats" }, [
        el("span", {}, `Win %: ${perf.winPct === null ? "N/A" : perf.winPct + "%"}`),
        el("span", {}, `Net P&L: ${fmtUSD(perf.netPnL)}`),
        el("span", {}, `Trades: ${perf.tradesTaken}`),
      ])
    );
    const tradeListContainer = el("div", { class: "backtest-history-trades" });
    const viewBtn = el("button", { class: "btn btn-ghost", onclick: () => {
      if (tradeListContainer.childElementCount) {
        tradeListContainer.innerHTML = "";
        viewBtn.textContent = "View Trades";
        return;
      }
      viewBtn.textContent = "Hide Trades";
      if (!run.trades || !run.trades.length) {
        tradeListContainer.appendChild(el("p", { class: "empty-state" }, "This saved run predates per-trade storage, or generated no trades — only the aggregate stats above are available."));
        return;
      }
      renderTradeLogBrowser(tradeListContainer, [...run.trades].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), {
        modeOptions: [
          { value: "all", label: "All Trades" },
          { value: "inSample", label: "In-Sample" },
          { value: "outOfSample", label: "Out-of-Sample" },
        ],
        getMode: (t) => (t.inSample ? "inSample" : "outOfSample"),
        rowRenderer: simpleBacktestRow,
      });
    } }, "View Trades");
    const actionsRow = el("div", { class: "backtest-history-actions" }, [
      viewBtn,
      el("button", { class: "btn btn-ghost", onclick: async () => {
        await remove("backtests", run.id);
        await renderBacktestHistory(container, state);
      } }, "Delete"),
    ]);
    card.appendChild(actionsRow);
    card.appendChild(tradeListContainer);
    container.appendChild(card);
  });
}

/**
 * The simplified, one-line-ish backtest result row: Symbol, Entry, Time
 * Taken, Strategy Name, Confidence Score, Amount, Win/Loss — deliberately
 * lighter than the full Journal trade card, since a backtest run can have
 * many more rows than a real trade history and scanning them quickly
 * matters more here than seeing every field.
 */
function simpleBacktestRow(trade) {
  const statusClass = { WIN: "status-win", LOSS: "status-loss", AMBIGUOUS: "status-ambiguous" }[trade.status] || "";
  const statusLabel = { WIN: "Win", LOSS: "Loss", AMBIGUOUS: "Ambiguous" }[trade.status] || trade.status;
  const holdingTime = trade.resolvedAt && trade.createdAt ? formatHoldingTime(new Date(trade.resolvedAt) - new Date(trade.createdAt)) : "—";
  return el("div", { class: `simple-bt-row ${statusClass}`, "data-trade-id": trade.id }, [
    el("div", { class: "simple-bt-row-top" }, [
      el("span", { class: "ticker" }, trade.symbol),
      el("span", { class: `dir-pill dir-${trade.direction}` }, trade.direction === "long" ? "Long" : "Short"),
      el("span", { class: `status-pill ${statusClass}` }, statusLabel),
    ]),
    el("div", { class: "simple-bt-row-grid" }, [
      el("span", {}, [el("strong", {}, "Entry: "), fmtPrice(trade.entryPrice)]),
      el("span", {}, [el("strong", {}, "Time Taken: "), holdingTime]),
      el("span", {}, [el("strong", {}, "Strategy: "), trade.strategyName]),
      el("span", {}, [el("strong", {}, "Confidence: "), trade.confidence ? `${trade.confidence.score}/100` : "—"]),
      el("span", {}, [el("strong", {}, "Amount: "), trade.pnl !== null && trade.pnl !== undefined ? fmtUSD(trade.pnl) : "—"]),
      el("span", {}, [el("strong", {}, "Result: "), statusLabel]),
    ]),
  ]);
}

function fmtPrice(v) {
  if (v === null || v === undefined) return "—";
  return v >= 100 ? v.toFixed(2) : v.toFixed(v >= 1 ? 4 : 6);
}

function backtestStatsBlock(perf) {
  return el("div", { class: "stats-grid" }, [
    statCard("Win %", perf.winPct === null ? "N/A" : fmtPct(perf.winPct)),
    statCard("Net P&L", fmtUSD(perf.netPnL)),
    statCard("Profit Factor", perf.profitFactor === null ? "—" : perf.profitFactor === Infinity ? "∞" : perf.profitFactor.toFixed(2)),
    statCard("Expectancy", perf.expectancy === null ? "—" : fmtUSD(perf.expectancy)),
    statCard("Avg R", perf.avgR === null ? "—" : `${perf.avgR}R`),
    statCard("Max Drawdown", fmtUSD(perf.maxDrawdown)),
  ]);
}

// -------------------------------------------------------------- STRATEGY LAB
export async function renderStrategyLab(root, state) {
  root.innerHTML = "";
  root.appendChild(el("div", { class: "section-title" }, "Strategy Lab"));
  root.appendChild(el("p", { class: "disclaimer-inline" }, "Factual performance per strategy from your recorded trades. No strategy is labeled \"best.\""));
  const rows = await getStrategyLab({ startingBalance: state.settings.risk.accountBalance });
  const container = el("div", { class: "strategy-lab-list" });
  rows.forEach((r) => {
    container.appendChild(
      el("div", { class: "card strategy-lab-card" }, [
        el("div", { class: "section-title" }, r.name),
        el("p", { class: "focus-reason" }, r.description),
        el("div", { class: "stats-grid" }, [
          statCard("Trades", r.trades),
          statCard("Win %", r.winPct === null ? "N/A" : `${r.winPct}%`),
          statCard("Profit Factor", r.profitFactor === null ? "—" : r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)),
          statCard("Avg R", r.avgR === null ? "—" : `${r.avgR}R`),
          statCard("Max Drawdown", fmtUSD(r.maxDrawdown)),
        ]),
      ])
    );
  });
  root.appendChild(container);
}

// -------------------------------------------------------------- SETTINGS
// -------------------------------------------------------------- WATCHLIST EDITOR (used inside Settings)
function getWatchlist(state, market) {
  return state.settings.watchlists?.[market] || [...DEFAULT_WATCHLISTS[market]];
}

async function updateWatchlist(state, market, newList) {
  if (!state.settings.watchlists) state.settings.watchlists = {};
  state.settings.watchlists[market] = newList;
  await saveSettings(state.settings);
}

function renderWatchlistSection(container, state) {
  container.innerHTML = "";
  ["us_stocks", "forex", "crypto"].forEach((market) => {
    const list = getWatchlist(state, market);
    const card = el("div", { class: "card watchlist-card" });
    card.appendChild(el("div", { class: "watchlist-market-label" }, labelForMarket(market)));

    const chipsRow = el("div", { class: "watchlist-chips" });
    list.forEach((symbol) => {
      chipsRow.appendChild(
        el("span", { class: "watchlist-chip" }, [
          symbol,
          el("button", {
            class: "watchlist-remove",
            "aria-label": `Remove ${symbol}`,
            onclick: async () => {
              if (list.length <= 1) {
                alert("Keep at least 1 symbol in this watchlist — remove is disabled below that.");
                return;
              }
              await updateWatchlist(state, market, list.filter((s) => s !== symbol));
              renderWatchlistSection(container, state);
            },
          }, "✕"),
        ])
      );
    });
    card.appendChild(chipsRow);

    const input = el("input", { class: "input watchlist-input", placeholder: market === "forex" ? "e.g. EURUSD" : market === "crypto" ? "e.g. BTCUSDT" : "e.g. AAPL", type: "text" });
    const addRow = el("div", { class: "watchlist-add-row" }, [
      input,
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const raw = input.value.trim().toUpperCase();
          if (!raw) return;
          if (raw.length > 12) {
            alert("That doesn't look like a valid symbol.");
            return;
          }
          if (list.includes(raw)) {
            alert(`${raw} is already in this watchlist.`);
            input.value = "";
            return;
          }
          await updateWatchlist(state, market, [...list, raw]);
          renderWatchlistSection(container, state);
        },
      }, "Add"),
    ]);
    card.appendChild(addRow);
    container.appendChild(card);
  });
}

export async function renderSettings(root, state) {
  root.innerHTML = "";
  const s = state.settings;

  root.appendChild(el("div", { class: "section-title" }, "Risk Management"));
  root.appendChild(numberField("Account Balance ($)", s.risk.accountBalance, (v) => (s.risk.accountBalance = v)));
  root.appendChild(numberField("Risk per Trade (%)", s.risk.riskPercent, (v) => (s.risk.riskPercent = v)));
  root.appendChild(numberField("Default R:R", s.risk.defaultRR, (v) => (s.risk.defaultRR = v)));
  root.appendChild(numberField("Max R:R", s.risk.maxRR, (v) => (s.risk.maxRR = v)));

  root.appendChild(el("div", { class: "section-title" }, "Timezone"));
  root.appendChild(
    el("label", { class: "checkbox-row" }, [
      el("input", { type: "checkbox", checked: s.useDeviceTimeZone ? "checked" : null, onchange: (e) => (s.useDeviceTimeZone = e.target.checked) }),
      " Use device timezone",
    ])
  );

  root.appendChild(el("div", { class: "section-title" }, "Data Providers"));
  root.appendChild(
    el("p", { class: "focus-reason" }, "Crypto uses Binance's free public API (no key) and is genuinely real-time. For US Stocks/Forex, add as many of these free keys as you have — the app tries them in order (most generous free tier first) and automatically falls through to the next one if a key is rate-limited, so you hit demo mode far less often. Important: every one of these is DELAYED on its free tier, including new ones — none of them adds genuine real-time data; adding more just adds redundancy.")
  );

  root.appendChild(el("div", { class: "provider-subheading" }, "Finnhub (tried first — 60 requests/min free)"));
  root.appendChild(textField("Finnhub API Key", s.apiKeys.finnhub, (v) => (s.apiKeys.finnhub = v)));
  root.appendChild(usageLine("finnhub", s.apiKeys.finnhub));
  root.appendChild(el("a", { href: "https://finnhub.io/register", target: "_blank", class: "link" }, "Get a free Finnhub API key →"));

  root.appendChild(el("div", { class: "provider-subheading" }, "Twelve Data (~8 requests/min free)"));
  root.appendChild(textField("Twelve Data API Key (Primary)", s.apiKeys.twelvedata, (v) => (s.apiKeys.twelvedata = v)));
  root.appendChild(usageLine("twelvedata", s.apiKeys.twelvedata));
  root.appendChild(textField("Twelve Data API Key (Backup, optional)", s.apiKeys.twelvedataBackup, (v) => (s.apiKeys.twelvedataBackup = v)));
  root.appendChild(usageLine("twelvedata", s.apiKeys.twelvedataBackup));
  root.appendChild(el("a", { href: "https://twelvedata.com/pricing", target: "_blank", class: "link" }, "Get a free Twelve Data API key →"));

  root.appendChild(el("div", { class: "provider-subheading" }, "Financial Modeling Prep"));
  root.appendChild(textField("FMP API Key", s.apiKeys.fmp, (v) => (s.apiKeys.fmp = v)));
  root.appendChild(usageLine("fmp", s.apiKeys.fmp));
  root.appendChild(el("a", { href: "https://site.financialmodelingprep.com/developer/docs/pricing", target: "_blank", class: "link" }, "Get a free FMP API key →"));

  root.appendChild(el("div", { class: "provider-subheading" }, "Alpha Vantage (tried last — free tier is only 25 requests/DAY)"));
  root.appendChild(textField("Alpha Vantage API Key", s.apiKeys.alphavantage, (v) => (s.apiKeys.alphavantage = v)));
  root.appendChild(usageLine("alphavantage", s.apiKeys.alphavantage));
  root.appendChild(el("a", { href: "https://www.alphavantage.co/support/#api-key", target: "_blank", class: "link" }, "Get a free Alpha Vantage API key →"));

  root.appendChild(el("div", { class: "section-title" }, "Watchlists"));
  root.appendChild(el("p", { class: "focus-reason" }, "Add or remove the exact symbols Check for Trade scans for each market. Changes save immediately."));
  const watchlistContainer = el("div", {});
  root.appendChild(watchlistContainer);
  renderWatchlistSection(watchlistContainer, state);

  root.appendChild(el("div", { class: "section-title" }, "Live Mode Trades/Day"));
  root.appendChild(
    el("p", { class: "focus-reason" }, "The original design locks Live Mode to 1 completed trade/day as a trading-discipline guardrail. You can raise it here if you'd rather — the limit is still hard-enforced, just against whichever number you pick.")
  );
  const liveModeSelect = el(
    "select",
    { class: "input", onchange: (e) => (s.risk.liveModeDailyLimit = parseInt(e.target.value, 10)) },
    LIVE_MODE_LIMIT_OPTIONS.map((n) => el("option", { value: n, selected: n === s.risk.liveModeDailyLimit ? "selected" : null }, String(n)))
  );
  root.appendChild(liveModeSelect);

  root.appendChild(el("div", { class: "section-title" }, "Test Mode Trades/Day"));
  const testModeSelect = el(
    "select",
    { class: "input", onchange: (e) => (s.testModeTradesPerDay = parseInt(e.target.value, 10)) },
    TEST_MODE_OPTIONS.map((n) => el("option", { value: n, selected: n === s.testModeTradesPerDay ? "selected" : null }, String(n)))
  );
  root.appendChild(testModeSelect);

  root.appendChild(el("div", { class: "section-title" }, "Export / Import"));
  root.appendChild(el("button", { class: "btn", onclick: async () => downloadBlob(await exportJSON(), `trading-data-${todayKey()}.json`) }, "Export JSON"));
  root.appendChild(el("button", { class: "btn", onclick: async () => downloadBlob(await exportTradesCSV(), `trades-${todayKey()}.csv`) }, "Export Trades CSV"));
  const importInput = el("input", { type: "file", accept: "application/json", onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    await importFromJSON(text, { merge: true });
    alert("Import complete.");
  } });
  root.appendChild(el("label", { class: "field-label" }, "Import JSON backup"));
  root.appendChild(importInput);

  root.appendChild(el("div", { class: "section-title" }, "Reset Trade Data" ));
  root.appendChild(
    el("p", { class: "focus-reason" }, "Erases every paper trade — open and closed — plus signal history. Your watchlists/symbols, risk settings, API keys, and saved backtests are NOT affected. Export a backup above first if you want to keep a copy.")
  );
  root.appendChild(el("button", { class: "btn btn-danger", onclick: () => openResetTradeDataModal(state) }, "Reset Trade Data…"));

  root.appendChild(el("div", { class: "section-title" }, "Cloud Sync (Firebase)"));
  const cloudContainer = el("div", {});
  root.appendChild(cloudContainer);
  await renderCloudSyncSection(cloudContainer, state);

  root.appendChild(el("div", { class: "section-title" }, "Security"));
  const securityContainer = el("div", {});
  root.appendChild(securityContainer);
  await renderSecuritySection(securityContainer, state);

  const saveBtn = el("button", { class: "btn btn-primary", onclick: () => state.persistSettings() }, "Save Settings");
  root.appendChild(saveBtn);
}

async function renderCloudSyncSection(container, state) {
  container.innerHTML = "";
  const savedConfig = await getSavedConfig();

  if (!savedConfig) {
    container.appendChild(
      el("p", { class: "focus-reason" }, "Not connected. Go to your Firebase project → Project Settings → Your apps, and copy the whole \"firebaseConfig\" block shown there — paste it below exactly as shown, no editing needed (this app accepts it whether or not it still has \"const firebaseConfig = \" and a semicolon around it). See docs/FIREBASE_SETUP.md for full setup steps — this is the one piece I can't fully test for you, since it needs your own live Firebase project.")
    );
    const textarea = document.createElement("textarea");
    textarea.className = "input cloud-config-textarea";
    textarea.placeholder = '{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "...",\n  ...\n}';
    const error = el("p", { class: "pin-error" });
    const connectBtn = el("button", { class: "btn btn-primary", onclick: async () => {
      error.textContent = "";
      const config = parseFirebaseConfigInput(textarea.value);
      if (!config) {
        error.textContent = "Couldn't read that as a config object. Paste the whole block Firebase showed you (the part between the { and }), including or excluding \"const firebaseConfig = \" — either works.";
        return;
      }
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting…";
      try {
        await connectWithConfig(config);
        await renderCloudSyncSection(container, state);
      } catch (e) {
        error.textContent = "Couldn't connect — double-check the config values and that Firestore/Auth are enabled in your Firebase project.";
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
      }
    } }, "Connect");
    container.appendChild(textarea);
    container.appendChild(error);
    container.appendChild(connectBtn);
    return;
  }

  const user = currentUser();
  if (!user) {
    container.appendChild(el("p", { class: "focus-reason" }, "Connected to your Firebase project. Sign in to start syncing."));
    const signInBtn = el("button", { class: "btn btn-primary", onclick: async () => {
      signInBtn.disabled = true;
      signInBtn.textContent = "Opening sign-in…";
      try {
        await signInWithGoogle();
        await renderCloudSyncSection(container, state);
      } catch (e) {
        signInBtn.disabled = false;
        signInBtn.textContent = "Sign in with Google";
        alert("Sign-in failed or was cancelled. Please try again.");
      }
    } }, "Sign in with Google");
    container.appendChild(signInBtn);
    container.appendChild(
      el("button", { class: "btn btn-ghost", onclick: async () => { await clearConfig(); await renderCloudSyncSection(container, state); } }, "Disconnect this project")
    );
    return;
  }

  container.appendChild(
    el("div", { class: "cloud-status-row" }, [
      el("span", { class: "data-source-dot is-real" }),
      el("span", {}, `Signed in as ${user.email || user.uid}`),
    ])
  );
  container.appendChild(el("p", { class: "focus-reason" }, "Trades, journal, and backtests now sync automatically across every device signed in with this account. Your PIN stays local to this device on purpose."));
  container.appendChild(
    el("div", { class: "security-actions" }, [
      el("button", { class: "btn", onclick: async () => { await pushAllOnce(); alert("Pushed everything currently on this device to the cloud."); } }, "Push This Device's Data"),
      el("button", { class: "btn", onclick: async () => { await pullAllOnce(); await renderCloudSyncSection(container, state); alert("Pulled the latest data from the cloud."); } }, "Pull Latest From Cloud"),
    ])
  );
  container.appendChild(
    el("button", { class: "btn btn-ghost", onclick: async () => { await signOutUser(); await renderCloudSyncSection(container, state); } }, "Sign Out")
  );
}

async function renderSecuritySection(container, state) {
  container.innerHTML = "";
  const enabled = await isPinEnabled();

  if (enabled) {
    container.appendChild(el("p", { class: "focus-reason" }, "PIN lock is ON — you'll need your 6-digit PIN each time you open the app."));
    container.appendChild(
      el("div", { class: "security-actions" }, [
        el("button", { class: "btn", onclick: () => openChangePinModal(container, state) }, "Change PIN"),
        el("button", { class: "btn btn-ghost", onclick: () => openDisablePinModal(container, state) }, "Turn Off PIN Lock"),
      ])
    );
  } else {
    container.appendChild(el("p", { class: "focus-reason" }, "PIN lock is OFF — anyone who opens this app on this device can see your trades."));
    container.appendChild(el("button", { class: "btn btn-primary", onclick: () => openSetupPinModal(container, state) }, "Set Up PIN Lock"));
  }
}

function pinModalInput(placeholder) {
  const input = document.createElement("input");
  input.type = "password";
  input.inputMode = "numeric";
  input.maxLength = 6;
  input.className = "input pin-modal-input";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
  });
  return input;
}

function openResetTradeDataModal(state) {
  const modal = buildModal("Reset Trade Data");
  modal.body.appendChild(
    el("p", { class: "focus-reason" }, "This permanently erases every open and closed paper trade and all signal history on this device (and from the cloud, if Cloud Sync is on). Your watchlists, risk settings, API keys, and saved backtests are kept. This can't be undone — export a backup first if you're not sure.")
  );
  const confirmInput = document.createElement("input");
  confirmInput.type = "text";
  confirmInput.className = "input";
  confirmInput.placeholder = 'Type RESET to confirm';
  const error = el("p", { class: "pin-error" });
  const btn = el("button", { class: "btn btn-danger", onclick: async () => {
    if (confirmInput.value.trim().toUpperCase() !== "RESET") {
      error.textContent = 'Type RESET (all caps) to confirm.';
      return;
    }
    btn.disabled = true;
    btn.textContent = "Resetting…";
    // resetTradeData() now awaits each cloud deletion (not fire-and-forget)
    // before resolving, so by the time we get here every deletion has
    // actually reached Firestore too — safe to move on without a full page
    // reload, which would also force a PIN re-entry unnecessarily.
    const result = await resetTradeData();
    modal.overlay.remove();
    alert(`Cleared ${result.tradesCleared} trade(s) and ${result.signalsCleared} signal(s). Your symbols and settings were not touched. Account Balance is back to your configured starting balance.`);
    state.goToHome();
  } }, "Erase All Trade Data");
  modal.body.appendChild(confirmInput);
  modal.body.appendChild(error);
  modal.body.appendChild(btn);
  document.body.appendChild(modal.overlay);
}

function openChangePinModal(securityContainer, state) {
  const modal = buildModal("Change PIN");
  const current = pinModalInput("Current PIN");
  const next = pinModalInput("New PIN");
  const confirm = pinModalInput("Confirm New PIN");
  const error = el("p", { class: "pin-error" });
  const btn = el("button", { class: "btn btn-primary", onclick: async () => {
    error.textContent = "";
    if (!(await verifyPin(current.value))) { error.textContent = "Current PIN is incorrect."; return; }
    if (!/^\d{6}$/.test(next.value)) { error.textContent = "New PIN must be exactly 6 digits."; return; }
    if (next.value !== confirm.value) { error.textContent = "New PINs don't match."; return; }
    await setupPin(next.value);
    modal.overlay.remove();
    await renderSecuritySection(securityContainer, state);
  } }, "Update PIN");
  [current, next, confirm, error, btn].forEach((n) => modal.body.appendChild(n));
  document.body.appendChild(modal.overlay);
}

function openDisablePinModal(securityContainer, state) {
  const modal = buildModal("Turn Off PIN Lock");
  modal.body.appendChild(el("p", { class: "focus-reason" }, "Enter your current PIN to confirm. You can turn it back on anytime from here."));
  const current = pinModalInput("Current PIN");
  const error = el("p", { class: "pin-error" });
  const btn = el("button", { class: "btn btn-primary", onclick: async () => {
    error.textContent = "";
    if (!(await verifyPin(current.value))) { error.textContent = "Incorrect PIN."; return; }
    await disablePin();
    modal.overlay.remove();
    await renderSecuritySection(securityContainer, state);
  } }, "Turn Off");
  [current, error, btn].forEach((n) => modal.body.appendChild(n));
  document.body.appendChild(modal.overlay);
}

function openSetupPinModal(securityContainer, state) {
  const modal = buildModal("Set Up PIN Lock");
  const next = pinModalInput("New PIN");
  const confirm = pinModalInput("Confirm PIN");
  const error = el("p", { class: "pin-error" });
  const btn = el("button", { class: "btn btn-primary", onclick: async () => {
    error.textContent = "";
    if (!/^\d{6}$/.test(next.value)) { error.textContent = "PIN must be exactly 6 digits."; return; }
    if (next.value !== confirm.value) { error.textContent = "PINs don't match."; return; }
    await setupPin(next.value);
    modal.overlay.remove();
    await renderSecuritySection(securityContainer, state);
  } }, "Turn On PIN Lock");
  [next, confirm, error, btn].forEach((n) => modal.body.appendChild(n));
  document.body.appendChild(modal.overlay);
}

function numberField(label, value, onChange) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label" }, label),
    el("input", { class: "input", type: "number", value, oninput: (e) => onChange(parseFloat(e.target.value)) }),
  ]);
}
/** Shows "X requests made this session" (and, when a limit is documented, "of Y/window") for one provider+key, next to its field in Settings. Nothing shown if the key is blank. */
function usageLine(providerId, apiKey) {
  if (!apiKey) return null;
  const usage = getUsageStats(providerId, apiKey);
  const limitText = usage.limitValue ? ` of ~${usage.limitValue}/${usage.limitWindow} (documented free-tier limit)` : "";
  return el("p", { class: "usage-line" }, `${usage.totalThisSession} request${usage.totalThisSession === 1 ? "" : "s"} made this session${limitText}.`);
}

function textField(label, value, onChange) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label" }, label),
    el("input", { class: "input", type: "text", value: value || "", oninput: (e) => onChange(e.target.value) }),
  ]);
}
