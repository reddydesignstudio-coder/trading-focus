// js/cloudSync.js
//
// Cloud Sync (Firebase)
// --------------------------------------------------------------
// Entirely optional. If the person never pastes a Firebase config into
// Settings, this module does nothing and the Firebase SDK is never even
// downloaded (all Firebase imports below are LAZY — dynamic imports that
// only fire once sync is actually configured, so users who don't want
// this feature pay zero cost for it).
//
// Design: IndexedDB (db.js) remains the local source of truth and the
// ONLY thing the rest of the app talks to directly — this module hooks
// into db.js's write/delete path (via registerCloudSyncHooks, called once
// from app.js) so every local write also mirrors out to Firestore, and
// every real-time change that arrives FROM Firestore gets written back
// into IndexedDB through the same db.js functions (marked "local-only"
// so it doesn't bounce right back out to Firestore in an infinite loop).
//
// Conflict model: last-write-wins, per document. This is a personal,
// single-user, multi-DEVICE app — not a multi-user editor — so there is
// no real concurrent-edit conflict to resolve, just "which device's
// version landed last," which is exactly what Firestore already gives
// you for free.
//
// Only these stores sync: settings, signals, trades, backtests. Not
// pin_lock (a PIN is a per-device lock, not something that should
// travel with you), not marketCache (purely a local perf cache), not
// alerts/dailySummaries/strategyResults (derived/local-only for now).

import { get, put, getAll, remove, STORE_NAMES } from "./db.js";

const SYNCED_STORES = ["settings", "signals", "trades", "backtests"];
const CONFIG_KEY = "cloud_config"; // stored locally in the `settings` store, NOT synced itself

let firebaseApp = null;
let auth = null;
let db = null;
let firestoreFns = null; // the destructured functions from the lazy-loaded firestore module
let unsubscribers = [];
let onChangeCallback = null; // set by app.js so it can re-render when remote data arrives

async function loadFirebase(config) {
  const FIREBASE_VERSION = "12.19.0";
  const [{ initializeApp }, authMod, storeMod] = await Promise.all([
    import(/* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(/* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(/* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
  ]);
  firebaseApp = initializeApp(config);
  auth = authMod.getAuth(firebaseApp);
  db = storeMod.getFirestore(firebaseApp);
  firestoreFns = { ...authMod, ...storeMod };
  return { auth, db };
}

export async function getSavedConfig() {
  const record = await get("settings", CONFIG_KEY);
  return record?.config || null;
}

export async function saveConfig(config) {
  await put("settings", { key: CONFIG_KEY, config });
}

export async function clearConfig() {
  await remove("settings", CONFIG_KEY);
  stopListeners();
  firebaseApp = null;
  auth = null;
  db = null;
  firestoreFns = null;
}

/** Call once, early (e.g. from app.js on boot), so remote changes can trigger a UI refresh. */
export function onRemoteChange(callback) {
  onChangeCallback = callback;
}

/** Initializes Firebase from a saved config, if one exists. Safe to call even if none is saved (no-op). */
export async function initFromSavedConfig() {
  const config = await getSavedConfig();
  if (!config) return { initialized: false };
  await loadFirebase(config);
  return { initialized: true };
}

export async function connectWithConfig(config) {
  await loadFirebase(config);
  await saveConfig(config);
  return true;
}

export function isConnected() {
  return !!auth;
}

export function currentUser() {
  return auth?.currentUser || null;
}

export async function signInWithGoogle() {
  if (!auth) throw new Error("Cloud sync isn't connected yet — paste your Firebase config first.");
  const provider = new firestoreFns.GoogleAuthProvider();
  const result = await firestoreFns.signInWithPopup(auth, provider);
  startListeners();
  return result.user;
}

export async function signOutUser() {
  stopListeners();
  if (auth) await firestoreFns.signOut(auth);
}

/** Subscribes to auth state changes (fires immediately with the current state, then on every change). */
export function onAuthChange(callback) {
  if (!auth) return () => {};
  return firestoreFns.onAuthStateChanged(auth, (user) => {
    if (user) startListeners();
    callback(user);
  });
}

function userDocRef(storeName, key) {
  const uid = auth.currentUser.uid;
  return firestoreFns.doc(db, "users", uid, storeName, String(key));
}

function userCollectionRef(storeName) {
  const uid = auth.currentUser.uid;
  return firestoreFns.collection(db, "users", uid, storeName);
}

/** Pushes one local record up to Firestore. Fire-and-forget from the caller's perspective — never blocks or throws into the local write path. */
async function pushToCloud(storeName, keyField, value) {
  if (!auth?.currentUser || !SYNCED_STORES.includes(storeName)) return;
  try {
    await firestoreFns.setDoc(userDocRef(storeName, value[keyField]), { ...value, _updatedAt: firestoreFns.serverTimestamp() });
  } catch (e) {
    console.warn(`[cloudSync] push failed for ${storeName}:`, e.message);
  }
}

async function deleteFromCloud(storeName, key) {
  if (!auth?.currentUser || !SYNCED_STORES.includes(storeName)) return;
  try {
    await firestoreFns.deleteDoc(userDocRef(storeName, key));
  } catch (e) {
    console.warn(`[cloudSync] delete push failed for ${storeName}:`, e.message);
  }
}

const KEY_FIELD_BY_STORE = { settings: "key", signals: "id", trades: "id", backtests: "id" };

/**
 * Wires db.js's write/delete path to also mirror to Firestore. Call this
 * ONCE, from app.js, after the local db module is available. db.js itself
 * never imports this module — it just calls whatever hook was registered,
 * keeping db.js fully usable/testable standalone with zero Firebase
 * dependency when cloud sync isn't in play.
 */
export function registerCloudSyncHooks(dbModule) {
  dbModule.setCloudSyncHooks({
    afterPut: (storeName, value) => {
      const keyField = KEY_FIELD_BY_STORE[storeName];
      if (keyField) pushToCloud(storeName, keyField, value);
    },
    afterDelete: (storeName, key) => {
      if (KEY_FIELD_BY_STORE[storeName]) deleteFromCloud(storeName, key);
    },
  });
}

function stopListeners() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
}

/** Starts one real-time listener per synced store; merges remote docs into local IndexedDB. */
function startListeners() {
  stopListeners();
  if (!auth?.currentUser) return;
  SYNCED_STORES.forEach((storeName) => {
    const unsub = firestoreFns.onSnapshot(userCollectionRef(storeName), (snapshot) => {
      let changed = false;
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        delete data._updatedAt;
        if (change.type === "removed") {
          remove(storeName, change.doc.id, { skipCloudSync: true });
        } else {
          put(storeName, data, { skipCloudSync: true });
        }
        changed = true;
      });
      if (changed && onChangeCallback) onChangeCallback(storeName);
    });
    unsubscribers.push(unsub);
  });
}

/** One-time manual pull, useful right after first sign-in on a new device to backfill before listeners settle. */
export async function pullAllOnce() {
  if (!auth?.currentUser) return;
  for (const storeName of SYNCED_STORES) {
    const snapshot = await firestoreFns.getDocs(userCollectionRef(storeName));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      delete data._updatedAt;
      await put(storeName, data, { skipCloudSync: true });
    }
  }
}

/** One-time manual push of everything currently local — useful the first time you connect an existing local dataset. */
export async function pushAllOnce() {
  if (!auth?.currentUser) return;
  for (const storeName of SYNCED_STORES) {
    const rows = await getAll(storeName);
    const keyField = KEY_FIELD_BY_STORE[storeName];
    for (const row of rows) {
      if (row.key === CONFIG_KEY) continue; // never sync the cloud config itself
      await pushToCloud(storeName, keyField, row);
    }
  }
}
