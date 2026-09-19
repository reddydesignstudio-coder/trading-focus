// js/ui/views.js
import { el, signalCard, statCard, funnelBar, tradeRow, dataStatusBadge } from "./components.js";
import { computeMarketFocus, assessTradingWindow } from "../marketFocus.js";
import { formatClock, formatCountdownHMS, computeKeySessionCountdowns } from "../timezone.js";
import { scanMarket, DEFAULT_WATCHLISTS } from "../scanner.js";
import { getLiveModeStatus, executeTrade, markSignalMissed, saveSignal, TEST_MODE_OPTIONS, checkAndResolveOpenTrades } from "../paperTrading.js";
import { recalculateTrade } from "../risk.js";
import { getDailySummary } from "../dailySummary.js";
import { getAll, put, remove } from "../db.js";
import { computePerformance } from "../performance.js";
import { getStrategyLab } from "../strategyLab.js";
import { runBacktest } from "../backtest.js";
import { getMarketData } from "../dataProviders/index.js";
import { atr, estimatePaceMs } from "../indicators.js";
import { strategiesForMarket, ALL_STRATEGIES } from "../strategies/index.js";
import { exportJSON, exportTradesCSV, importFromJSON, downloadBlob } from "../exportImport.js";
import { saveSettings } from "../settings.js";
import { fmtUSD, fmtPct, todayKey, uid } from "../utils.js";

// -------------------------------------------------------------- HOME
export async function renderHome(root, state) {
  root.innerHTML = "";
  await checkAndResolveOpenTrades(state); // resolve any trade that has actually hit TP/SL since we last checked
  const tz = state.effectiveTimeZone();
  const liveStatus = await getLiveModeStatus(tz);
  const summary = await getDailySummary({ timeZone: tz, startingBalance: state.settings.risk.accountBalance, mode: "live" });

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
    statCard("Account Balance", fmtUSD(state.settings.risk.accountBalance)),
    statCard("Today's P&L", fmtUSD(summary.metrics.netPnL)),
    statCard("Today's Win %", summary.metrics.winPct === null ? "N/A" : fmtPct(summary.metrics.winPct)),
    statCard("Live Mode", liveStatus.available ? "Available" : "Completed", liveStatus.available ? "1 trade available today" : liveStatus.reason.replace(/_/g, " ")),
  ]);
  root.appendChild(statsGrid);

  // ---- Data Status — unambiguous real-vs-demo, per market ----
  root.appendChild(el("div", { class: "section-title" }, "Data Sources — Real or Demo?"));
  root.appendChild(dataSourcesCard(state));
}

function dataSourcesCard(state) {
  const hasKey = !!(state.settings.apiKeys.twelvedata || state.settings.apiKeys.twelvedataBackup);
  const rows = [
    { label: "Crypto", real: true, note: "Binance public API — always real, no setup needed" },
    { label: "US Stocks", real: hasKey && state.settings.dataProviderOverride?.us_stocks !== "demo", note: hasKey ? "Twelve Data (delayed, real)" : "No API key set — showing simulated demo data" },
    { label: "Forex", real: hasKey && state.settings.dataProviderOverride?.forex !== "demo", note: hasKey ? "Twelve Data (delayed, real)" : "No API key set — showing simulated demo data" },
  ];
  const card = el("div", { class: "card data-sources-card" });
  rows.forEach((r) => {
    card.appendChild(
      el("div", { class: "data-source-row" }, [
        el("span", { class: `data-source-dot ${r.real ? "is-real" : "is-demo"}` }),
        el("span", { class: "data-source-label" }, r.label),
        el("span", { class: `data-source-tag ${r.real ? "is-real" : "is-demo"}` }, r.real ? "Real" : "Demo"),
        el("span", { class: "data-source-note" }, r.note),
      ])
    );
  });
  if (!hasKey) {
    card.appendChild(el("button", { class: "btn btn-primary", style: "margin-top:10px;width:100%", onclick: () => state.goToSettings() }, "Add free API key for real Stocks/Forex data →"));
  }
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

      if (result.qualifying.length === 0) {
        resultsWrap.appendChild(
          el("div", { class: "no-trade-card" }, [
            el("div", { class: "no-trade-title" }, "No Qualifying Trade"),
            el("p", {}, `Scanned ${result.symbolsScanned} symbols. No setup met the minimum confirmation, risk/reward, or no-trade filter requirements right now — see the breakdown below for exactly why each symbol was passed over.`),
          ])
        );
      } else {
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
                  ? "Live Mode can't execute a trade on Demo data. Switch to Test Mode, or add a Twelve Data API key in Settings."
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
      const trade = await executeTrade({ signal, actualEntry: parseFloat(entryInput.value), sizing: latestSizing, mode: state.tradeMode, timeZone: state.effectiveTimeZone() });
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
        el("button", { class: "others-menu-item", onclick: () => { state.othersView = item.id; renderOthers(root, state); } }, [
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
  const backBar = el("button", { class: "back-bar", onclick: () => { state.othersView = null; renderOthers(root, state); } }, "‹ Back to More");
  root.appendChild(backBar);
  const subRoot = el("div", {});
  root.appendChild(subRoot);
  if (item) await item.render(subRoot, state);
}

// -------------------------------------------------------------- JOURNAL
export async function renderJournal(root, state) {
  root.innerHTML = "";
  root.appendChild(el("p", { class: "loading-inline" }, "Checking open trades against current prices…"));
  await checkAndResolveOpenTrades(state); // resolve anything that has actually hit TP/SL since we last checked
  root.innerHTML = "";
  const trades = (await getAll("trades")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  root.appendChild(el("div", { class: "section-title" }, `Journal (${trades.length} trades)`));
  if (!trades.length) {
    root.appendChild(el("p", { class: "empty-state" }, "No trades yet. Run Check for Trade and paper trade a signal to start your journal."));
    return;
  }

  const list = el("div", { class: "trade-list" });
  trades.forEach((t) => list.appendChild(tradeRow(t)));
  root.appendChild(list);

  // Fetch current price for every OPEN trade's symbol (deduped by symbol+market) and
  // fill in current price + unrealized P&L once it lands, without blocking the initial render.
  const openTrades = trades.filter((t) => t.status === "OPEN");
  if (!openTrades.length) return;

  const rows = [...list.children];
  const uniqueKeys = [...new Set(openTrades.map((t) => `${t.market}:${t.symbol}`))];
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const [market, symbol] = key.split(":");
      let price = null;
      let atrVal = null;
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
      } catch {
        price = null;
      }
      if (price === null) return;
      trades.forEach((t, idx) => {
        if (t.status !== "OPEN" || `${t.market}:${t.symbol}` !== key) return;
        const risk = Math.abs(t.entryPrice - t.stopLoss);
        const priceDelta = t.direction === "long" ? price - t.entryPrice : t.entryPrice - price;
        const distanceToTP = t.takeProfit !== null && t.takeProfit !== undefined ? Math.abs(t.takeProfit - price) : null;
        const distanceToSL = Math.abs(t.stopLoss - price);
        const paceMs = estimatePaceMs(distanceToTP, atrVal, timeframeMs);
        const live = {
          currentPrice: price,
          unrealizedPnl: priceDelta * t.positionSize,
          unrealizedR: risk > 0 ? priceDelta / risk : null,
          distanceToTP,
          distanceToSL,
          paceMs,
        };
        const freshRow = tradeRow(t, live);
        rows[idx].replaceWith(freshRow);
        rows[idx] = freshRow;
      });
    })
  );
}

// -------------------------------------------------------------- DAILY SUMMARY
export async function renderDailySummary(root, state) {
  root.innerHTML = "";
  await checkAndResolveOpenTrades(state); // resolve any trade that has actually hit TP/SL since we last checked
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

  const marketSelect = el("select", { class: "input" }, ["us_stocks", "forex", "crypto"].map((m) => el("option", { value: m }, labelForMarket(m))));
  const symbolInput = el("input", { class: "input", value: "BTCUSDT", placeholder: "Symbol" });
  const strategyChecks = el("div", { class: "strategy-checks" });

  function refreshStrategies() {
    strategyChecks.innerHTML = "";
    strategiesForMarket(marketSelect.value).forEach((s) => {
      const id = `bt-${s.id}`;
      const label = el("label", { class: "checkbox-row" }, [el("input", { type: "checkbox", id, value: s.id, checked: "checked" }), ` ${s.name}`]);
      strategyChecks.appendChild(label);
    });
  }
  marketSelect.addEventListener("change", refreshStrategies);
  refreshStrategies();

  const runBtn = el("button", { class: "btn btn-primary", onclick: runIt }, "Run Backtest");
  const resultsWrap = el("div", { class: "backtest-results" });

  root.appendChild(el("label", { class: "field-label" }, "Market"));
  root.appendChild(marketSelect);
  root.appendChild(el("label", { class: "field-label" }, "Symbol"));
  root.appendChild(symbolInput);
  root.appendChild(el("label", { class: "field-label" }, "Strategies"));
  root.appendChild(strategyChecks);
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
      const symbol = symbolInput.value.trim().toUpperCase();
      const strategyIds = [...strategyChecks.querySelectorAll("input:checked")].map((i) => i.value);
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
    card.appendChild(
      el("button", { class: "btn btn-ghost", onclick: async () => {
        await remove("backtests", run.id);
        await renderBacktestHistory(container, state);
      } }, "Delete")
    );
    container.appendChild(card);
  });
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
  root.appendChild(el("p", { class: "focus-reason" }, "Crypto uses Binance's free public API (no key). US Stocks/Forex use Twelve Data — enter your own free API key below (never stored in source code, only in your browser's local database)."));
  root.appendChild(textField("Twelve Data API Key (Primary)", s.apiKeys.twelvedata, (v) => (s.apiKeys.twelvedata = v)));
  root.appendChild(textField("Twelve Data API Key (Backup, optional)", s.apiKeys.twelvedataBackup, (v) => (s.apiKeys.twelvedataBackup = v)));
  root.appendChild(el("p", { class: "focus-reason" }, "If you add a second key, the app automatically switches to it whenever the primary key hits its rate limit — no separate step needed."));
  root.appendChild(
    el("a", { href: "https://twelvedata.com/pricing", target: "_blank", class: "link" }, "Get a free Twelve Data API key →")
  );

  root.appendChild(el("div", { class: "section-title" }, "Watchlists"));
  root.appendChild(el("p", { class: "focus-reason" }, "Add or remove the exact symbols Check for Trade scans for each market. Changes save immediately."));
  const watchlistContainer = el("div", {});
  root.appendChild(watchlistContainer);
  renderWatchlistSection(watchlistContainer, state);

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

  const saveBtn = el("button", { class: "btn btn-primary", onclick: () => state.persistSettings() }, "Save Settings");
  root.appendChild(saveBtn);
}

function numberField(label, value, onChange) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label" }, label),
    el("input", { class: "input", type: "number", value, oninput: (e) => onChange(parseFloat(e.target.value)) }),
  ]);
}
function textField(label, value, onChange) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label" }, label),
    el("input", { class: "input", type: "text", value: value || "", oninput: (e) => onChange(e.target.value) }),
  ]);
}
