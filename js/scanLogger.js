// js/scanLogger.js
//
// Scan Logger
// --------------------------------------------------------------
// A structured record of what happened, step by step, during one
// "Check for Trade" run — built specifically so a person can export it
// and hand it back for diagnosis when something looks wrong (a symbol
// silently missing, a scan that seems incomplete). Pure, dependency-
// free data collection: no DOM, no network, so it's trivially testable
// and safe to call from anywhere in the scan pipeline.
//
// One logger instance per scan run — create with startScanLog(), pass
// it through the scan, call .entry(...) at each step, and either
// .toText() or .toJSON() it when the run finishes (or fails).

export function startScanLog(market) {
  const startedAt = new Date();
  const entries = [];

  return {
    startedAt,
    market,

    /**
     * Records one step. `level` is "info" | "warn" | "error". `symbol` is
     * optional (some entries, like "benchmark fetch", aren't per-symbol).
     */
    entry(level, symbol, step, detail = {}) {
      entries.push({ t: new Date().toISOString(), level, symbol: symbol || null, step, detail });
    },

    getEntries() {
      return entries;
    },

    /** Plain-text export — this is what a person downloads and can paste back for diagnosis. */
    toText() {
      const lines = [
        `Scan log — market: ${market}`,
        `Started: ${startedAt.toISOString()}`,
        `Finished: ${new Date().toISOString()}`,
        `Total steps logged: ${entries.length}`,
        "",
      ];
      entries.forEach((e) => {
        const tag = e.symbol ? `[${e.symbol}]` : "[scan]";
        const detailStr = Object.keys(e.detail).length ? " " + JSON.stringify(e.detail) : "";
        lines.push(`${e.t} ${e.level.toUpperCase().padEnd(5)} ${tag} ${e.step}${detailStr}`);
      });
      return lines.join("\n");
    },

    toJSON() {
      return { market, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), entries };
    },

    /** Quick summary: how many symbols hit an error-level entry, and which ones. */
    errorSummary() {
      const symbolsWithErrors = [...new Set(entries.filter((e) => e.level === "error" && e.symbol).map((e) => e.symbol))];
      return { errorCount: entries.filter((e) => e.level === "error").length, symbolsWithErrors };
    },
  };
}

/** Triggers a browser download of the log as a .txt file. Browser-only (uses document/URL) — kept separate from the pure logger above so the logger itself stays testable in Node. */
export function downloadScanLog(log, filename = `scan-log-${Date.now()}.txt`) {
  const blob = new Blob([log.toText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
