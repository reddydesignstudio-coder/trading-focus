// tests/helpers/fakeIndexedDB.js
//
// A minimal, in-memory stand-in for the browser's IndexedDB, implementing
// only the surface db.js actually uses: open() with onupgradeneeded,
// transactions, objectStore put/get/getAll/delete/clear, and single-value
// index lookups (index.getAll(value)). Good enough to let paperTrading.js's
// real read/write logic run end-to-end in Node without a browser.

function makeRequest(work) {
  const req = { result: undefined, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      req.result = work();
      req.onsuccess && req.onsuccess();
    } catch (err) {
      req.error = err;
      req.onerror && req.onerror();
    }
  });
  return req;
}

class FakeStore {
  constructor(name, keyPath, indexes = []) {
    this.name = name;
    this.keyPath = keyPath;
    this.indexNames = { contains: (n) => indexes.some((i) => i[0] === n) };
    this._indexes = indexes;
    this.rows = new Map();
  }
  put(value) {
    return makeRequest(() => {
      this.rows.set(value[this.keyPath], value);
      return value[this.keyPath];
    });
  }
  get(key) {
    return makeRequest(() => this.rows.get(key));
  }
  getAll() {
    return makeRequest(() => [...this.rows.values()]);
  }
  delete(key) {
    return makeRequest(() => {
      this.rows.delete(key);
    });
  }
  clear() {
    return makeRequest(() => {
      this.rows.clear();
    });
  }
  createIndex() {}
  index(name) {
    const field = this._indexes.find((i) => i[0] === name)?.[1];
    const rows = this.rows;
    return {
      getAll: (value) =>
        makeRequest(() => {
          const all = [...rows.values()];
          return value === undefined ? all : all.filter((r) => r[field] === value);
        }),
    };
  }
}

class FakeDB {
  constructor(stores) {
    this.stores = stores; // Map name -> FakeStore
    this.objectStoreNames = { contains: (n) => this.stores.has(n) };
  }
  createObjectStore(name, { keyPath }) {
    const store = new FakeStore(name, keyPath, []);
    this.stores.set(name, store);
    return store;
  }
  transaction(storeNames, _mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = { oncomplete: null, onerror: null, onabort: null };
    queueMicrotask(() => tx.oncomplete && tx.oncomplete());
    tx.objectStore = (name) => this.stores.get(name);
    return tx;
  }
}

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

export function installFakeIndexedDB() {
  const stores = new Map();
  for (const def of STORE_DEFS) {
    stores.set(def.name, new FakeStore(def.name, def.keyPath, def.indexes || []));
  }
  const db = new FakeDB(stores);

  globalThis.indexedDB = {
    open() {
      const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => {
        req.result = db;
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  return db;
}
