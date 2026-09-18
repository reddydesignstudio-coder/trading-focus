// js/exportImport.js
import { exportAllData, importAllData, getAll } from "./db.js";

export async function exportJSON() {
  const data = await exportAllData();
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

export async function exportTradesCSV() {
  const trades = await getAll("trades");
  const headers = [
    "id", "dateKey", "mode", "symbol", "market", "direction", "strategyName", "entryPrice", "stopLoss",
    "takeProfit", "rr", "positionSize", "dollarRisk", "potentialReward", "status", "pnl", "rMultiple",
    "confidenceScore", "regime", "session", "createdAt", "resolvedAt",
  ];
  const rows = trades.map((t) => [
    t.id, t.dateKey, t.mode, t.symbol, t.market, t.direction, t.strategyName, t.entryPrice, t.stopLoss,
    t.takeProfit, t.rr, t.positionSize, t.dollarRisk, t.potentialReward, t.status, t.pnl, t.rMultiple,
    t.confidence?.score, t.regime, t.session, t.createdAt, t.resolvedAt,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
  return new Blob([csv], { type: "text/csv" });
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function importFromJSON(jsonText, { merge = true } = {}) {
  const data = JSON.parse(jsonText);
  await importAllData(data, { merge });
  return true;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
