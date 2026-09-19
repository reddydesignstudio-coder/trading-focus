// js/ui/components.js
import { fmtUSD, fmtPct } from "../utils.js";
import { formatHoldingTime } from "../performance.js";

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

export function dataStatusBadge(status) {
  const map = {
    LIVE: { cls: "badge-live", label: "Live" },
    DELAYED: { cls: "badge-delayed", label: "Delayed" },
    STALE: { cls: "badge-stale", label: "Stale" },
    UNAVAILABLE: { cls: "badge-unavailable", label: "Data Unavailable" },
    DEMO: { cls: "badge-demo", label: "Demo Mode" },
  };
  const m = map[status] || { cls: "badge-unavailable", label: status || "Unknown" };
  return el("span", { class: `badge ${m.cls}` }, m.label);
}

export function confidenceRing(score, max = 100) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? "#16a34a" : pct >= 65 ? "#d97706" : pct >= 50 ? "#ea580c" : "#dc2626";
  const wrap = el("div", { class: "confidence-ring", style: `--pct:${pct}; --ring-color:${color}` });
  wrap.appendChild(el("div", { class: "confidence-ring-inner" }, [el("strong", {}, `${score}`), el("span", {}, `/${max}`)]));
  return wrap;
}

export function signalCard(signal, { onPaperTrade, onMissed, blockedReason } = {}) {
  const dirClass = signal.direction === "long" ? "dir-long" : "dir-short";
  const card = el("div", { class: `signal-card ${dirClass}` });

  card.appendChild(
    el("div", { class: "signal-card-header" }, [
      el("div", { class: "signal-symbol" }, [el("span", { class: "ticker" }, signal.symbol), el("span", { class: `dir-pill ${dirClass}` }, signal.direction === "long" ? "Long" : "Short")]),
      dataStatusBadge(signal.isDemo ? "DEMO" : signal.dataStatus),
    ])
  );
  if (signal.isDemo) {
    card.appendChild(
      el("p", { class: "demo-warning" }, "This setup was generated from simulated demo data, not a real market feed — add a free Twelve Data API key in Settings to scan real US Stocks/Forex data.")
    );
  }

  card.appendChild(
    el("div", { class: "signal-card-body" }, [
      confidenceRing(signal.confidence.score),
      el("div", { class: "signal-key-numbers" }, [
        kv("Current Price", fmtPrice(signal.currentPrice)),
        kv("Entry Zone", `${fmtPrice(signal.entryZone.low)} – ${fmtPrice(signal.entryZone.high)}`),
        kv("Ideal Entry", fmtPrice(signal.idealEntry)),
        kv("Stop Loss", fmtPrice(signal.stopLoss)),
        kv("Take Profit", signal.takeProfit ? fmtPrice(signal.takeProfit) : "—"),
        kv("R:R", signal.rr ? `1:${signal.rr.toFixed(2)}` : "—"),
        kv("Risk (if SL hits)", fmtUSD(signal.dollarRisk)),
        kv("Reward (if TP hits)", fmtUSD(signal.potentialReward)),
        kv("Position Size", signal.positionSize ? signal.positionSize.toFixed(4) : "—"),
      ]),
    ])
  );
  if (signal.rrCapped) {
    card.appendChild(
      el("p", { class: "capped-note" }, `Target pulled in to hold R:R at your max setting — structure suggested a farther target near ${fmtPrice(signal.structuralTarget)}.`)
    );
  }

  card.appendChild(
    el("div", { class: "signal-meta" }, [
      el("span", {}, `Strategy: ${signal.strategyName}`),
      el("span", {}, `Regime: ${signal.regime}`),
      el("span", {}, `Session: ${signal.session}`),
    ])
  );

  card.appendChild(el("div", { class: "signal-section-label" }, "Why this qualified"));
  card.appendChild(el("p", { class: "plain-english-text" }, signal.plainEnglish));
  if (signal.rationale) {
    card.appendChild(el("p", { class: "rationale-text" }, `Technical detail: ${signal.rationale}`));
  }

  const confList = el(
    "div",
    { class: "confirmations" },
    signal.confirmations.satisfied.map((c) => el("span", { class: "confirmation-chip" }, c.category.replace(/_/g, " ")))
  );
  card.appendChild(el("div", { class: "signal-section-label" }, `Confirmations (${signal.confirmations.count})`));
  card.appendChild(confList);

  card.appendChild(el("div", { class: "signal-section-label" }, "Invalidation"));
  card.appendChild(el("p", { class: "invalidation-text" }, signal.invalidation));

  const actions = el("div", { class: "signal-actions" });
  if (blockedReason) {
    actions.appendChild(el("button", { class: "btn btn-disabled", disabled: "disabled" }, "Paper Trade"));
    card.appendChild(actions);
    card.appendChild(el("p", { class: "blocked-reason" }, blockedReason));
    return card;
  }
  if (onPaperTrade) actions.appendChild(el("button", { class: "btn btn-primary", onclick: () => onPaperTrade(signal) }, "Paper Trade"));
  if (onMissed) actions.appendChild(el("button", { class: "btn btn-ghost", onclick: () => onMissed(signal) }, "Mark Missed"));
  card.appendChild(actions);

  return card;
}

function kv(label, value) {
  return el("div", { class: "kv" }, [el("span", { class: "kv-label" }, label), el("span", { class: "kv-value" }, String(value))]);
}

function fmtPrice(v) {
  if (v === null || v === undefined) return "—";
  return v >= 100 ? v.toFixed(2) : v.toFixed(v >= 1 ? 4 : 6);
}

export function statCard(label, value, sub) {
  return el("div", { class: "stat-card" }, [el("div", { class: "stat-label" }, label), el("div", { class: "stat-value" }, String(value)), sub ? el("div", { class: "stat-sub" }, sub) : null]);
}

export function funnelBar(funnel) {
  const steps = [
    ["Signals Generated", funnel.signalsGenerated],
    ["Qualifying Signals", funnel.qualifyingSignals],
    ["Trades Taken", funnel.tradesTaken],
    ["Wins", funnel.wins],
    ["Losses", funnel.losses],
  ];
  return el(
    "div",
    { class: "funnel" },
    steps.map(([label, val], idx) => el("div", { class: "funnel-step" }, [el("div", { class: "funnel-value" }, String(val)), el("div", { class: "funnel-label" }, label)]))
  );
}

export function tradeRow(trade, live = null) {
  const statusClass = { WIN: "status-win", LOSS: "status-loss", OPEN: "status-open", AMBIGUOUS: "status-ambiguous" }[trade.status] || "";
  const statusLabel = { WIN: "Win", LOSS: "Loss", OPEN: "Open", AMBIGUOUS: "Ambiguous" }[trade.status] || trade.status;
  const rows = [
    el("div", { class: "trade-row-top" }, [
      el("span", { class: "ticker" }, trade.symbol),
      el("span", { class: `dir-pill dir-${trade.direction}` }, trade.direction === "long" ? "Long" : "Short"),
      el("span", { class: `status-pill ${statusClass}` }, statusLabel),
    ]),
    el("div", { class: "trade-row-strategy" }, trade.strategyName),
  ];

  if (trade.status === "OPEN") {
    rows.push(
      el("div", { class: "trade-row-live" }, [
        kv("Current Price", live ? fmtPrice(live.currentPrice) : "…"),
        kv("Unrealized P&L", live && live.unrealizedPnl !== null ? fmtUSD(live.unrealizedPnl) : "—"),
        kv("If TP hits", `+${fmtUSD(trade.potentialReward)}`),
        kv("If SL hits", `-${fmtUSD(trade.dollarRisk)}`),
        kv("Distance to TP", live && live.distanceToTP !== null ? fmtPrice(live.distanceToTP) : "—"),
        kv("Distance to SL", live && live.distanceToSL !== null ? fmtPrice(live.distanceToSL) : "—"),
      ])
    );
    if (live && live.paceMs !== null && live.paceMs !== undefined) {
      rows.push(
        el("p", { class: "pace-note" }, `Typical pace to TP at current volatility: ~${formatHoldingTime(live.paceMs)}. This is a rough historical-volatility estimate, not a prediction — price can move faster, slower, stall, or reverse at any time.`)
      );
    }
  }

  rows.push(
    el("div", { class: "trade-row-grid" }, [
      kv("Entry", fmtPrice(trade.entryPrice)),
      kv("SL", fmtPrice(trade.stopLoss)),
      kv("TP", fmtPrice(trade.takeProfit)),
      kv("R:R", trade.rr ? `1:${trade.rr.toFixed(2)}` : "—"),
      kv("P&L", trade.pnl !== null ? fmtUSD(trade.pnl) : "—"),
      kv("R", trade.rMultiple !== null && trade.rMultiple !== undefined ? `${trade.rMultiple.toFixed(2)}R` : "—"),
      kv("Confidence", trade.confidence ? `${trade.confidence.score}/100` : "—"),
      kv("Holding", trade.resolvedAt ? formatHoldingTime(new Date(trade.resolvedAt) - new Date(trade.createdAt)) : "—"),
    ])
  );

  return el("div", { class: `trade-row ${statusClass}` }, rows);
}
