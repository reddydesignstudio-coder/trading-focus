// js/db.js
//
// Storage Engine (IndexedDB)
// --------------------------------------------------------------
// A small hand-rolled promise wrapper (no external dependency —
// keeps Phase 1 at $0 and dependency-free). Schema is versioned via
// DB_VERSION; onupgradeneeded creates/migrates object stores so
// future Phase updates can add stores or indexes without losing
// existing user data.

export const DB_NAME = "trading_focus_db";
export const DB_VERSION = 1;

const STORE_DEFS = [
  { name: "settings", keyPath: "key" },
  { name: "signals", keyPath: "id", indexes: [["byDate", "dateKey"], ["bySymbol", "symbol"], ["byMarket", "market"]] },
  { name: "trades", keyPath: "id", indexes: [["byDate", "dateKey"], ["byMode", "mode"], ["byStatus", "status"], ["bySymbol", "symbol"]] },
  { name: "dailySummaries", keyPath: "dateKey" },
  { name: "backtests", keyPath: "id", indexes: [["byDate", "createdAt"]] },
  { name: "strategyResults", keyPath: "id", indexes: [["byStrategy", "strategyId"]] },
  { name: "alerts", keyPath: "id", indexes: [["byDate", "createdAt"]] },
  { name: "marketCache", keyPath: "key" },
];

let dbPromise = null;

/** Test-only hook: forces the next openDB() call to re-open — e.g. against a freshly installed fake IndexedDB between test cases. Not used by the app itself. */
export function _resetForTests() {
  dbPromise = null;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      for (const def of STORE_DEFS) {
        let store;
        if (!db.objectStoreNames.contains(def.name)) {
          store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        } else {
          store = req.transaction.objectStore(def.name);
        }
        (def.indexes || []).forEach(([indexName, field]) => {
          if (!store.indexNames.contains(indexName)) {
            store.createIndex(indexName, field, { unique: false });
          }
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn("[db] upgrade blocked by another open tab");
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Cloud sync hook points — db.js has ZERO import of cloudSync.js (kept fully
// standalone/testable with no Firebase dependency). cloudSync.js registers
// itself here, once, at app startup, if the person has configured it.
let cloudSyncHooks = null;
export function setCloudSyncHooks(hooks) {
  cloudSyncHooks = hooks;
}

export async function put(storeName, value, options = {}) {
  const result = await withStore(storeName, "readwrite", (store) => store.put(value));
  // Awaited deliberately — pushToCloud/deleteFromCloud never throw (they
  // log and swallow their own errors), so this never makes a local write
  // fail because of a cloud problem. What it DOES fix: callers that need
  // to know the cloud copy is actually gone before doing something else
  // (e.g. Reset Trade Data reloading the page) can now just `await put()`
  // / `await remove()` and be sure of that, instead of the cloud call
  // still being in flight in the background when the page navigates away.
  if (!options.skipCloudSync && cloudSyncHooks?.afterPut) await cloudSyncHooks.afterPut(storeName, value);
  return result;
}

export async function bulkPut(storeName, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    values.forEach((v) => store.put(v));
    tx.oncomplete = () => resolve(values.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function get(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return reqToPromise(tx.objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return reqToPromise(tx.objectStore(storeName).getAll());
}

export async function getAllByIndex(storeName, indexName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index(indexName);
  return reqToPromise(value !== undefined ? index.getAll(value) : index.getAll());
}

export async function getRangeByIndex(storeName, indexName, lower, upper) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index(indexName);
  const range = IDBKeyRange.bound(lower, upper);
  return reqToPromise(index.getAll(range));
}

export async function remove(storeName, key, options = {}) {
  const result = await withStore(storeName, "readwrite", (store) => store.delete(key));
  if (!options.skipCloudSync && cloudSyncHooks?.afterDelete) await cloudSyncHooks.afterDelete(storeName, key);
  return result;
}

export async function clearStore(storeName) {
  return withStore(storeName, "readwrite", (store) => store.clear());
}

export async function exportAllData() {
  const out = {};
  for (const def of STORE_DEFS) {
    out[def.name] = await getAll(def.name);
  }
  out.exportedAt = new Date().toISOString();
  out.schemaVersion = DB_VERSION;
  return out;
}

export async function importAllData(data, { merge = true } = {}) {
  for (const def of STORE_DEFS) {
    const rows = data[def.name];
    if (!Array.isArray(rows)) continue;
    if (!merge) await clearStore(def.name);
    await bulkPut(def.name, rows);
  }
  return true;
}

export const STORE_NAMES = STORE_DEFS.map((d) => d.name);
