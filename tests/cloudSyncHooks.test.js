import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeIndexedDB } from "./helpers/fakeIndexedDB.js";
import { _resetForTests, put, remove, setCloudSyncHooks } from "../js/db.js";

test("put() calls the registered afterPut hook with the store name and value", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const calls = [];
  setCloudSyncHooks({ afterPut: (store, value) => calls.push(["put", store, value]), afterDelete: () => {} });

  await put("trades", { id: "t1", symbol: "AAPL" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["put", "trades", { id: "t1", symbol: "AAPL" }]);

  setCloudSyncHooks(null); // don't leak into other tests
});

test("put() with skipCloudSync:true does NOT call the hook — this is what prevents the sync echo loop", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const calls = [];
  setCloudSyncHooks({ afterPut: (...args) => calls.push(args), afterDelete: () => {} });

  await put("trades", { id: "t1" }, { skipCloudSync: true });
  assert.equal(calls.length, 0);

  setCloudSyncHooks(null);
});

test("remove() calls the registered afterDelete hook, and skipCloudSync suppresses it the same way", async () => {
  installFakeIndexedDB();
  _resetForTests();
  const calls = [];
  setCloudSyncHooks({ afterPut: () => {}, afterDelete: (store, key) => calls.push([store, key]) });

  await put("trades", { id: "t1" }, { skipCloudSync: true }); // seed without triggering afterPut noise
  await remove("trades", "t1");
  assert.deepEqual(calls, [["trades", "t1"]]);

  calls.length = 0;
  await put("trades", { id: "t2" }, { skipCloudSync: true });
  await remove("trades", "t2", { skipCloudSync: true });
  assert.equal(calls.length, 0);

  setCloudSyncHooks(null);
});

test("with no hooks registered at all, put/remove behave exactly as before (never throw)", async () => {
  installFakeIndexedDB();
  _resetForTests();
  setCloudSyncHooks(null);
  await put("trades", { id: "t1" });
  await remove("trades", "t1");
  // no assertion needed beyond "did not throw" — this locks in backward compatibility
});
