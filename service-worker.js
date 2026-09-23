// service-worker.js
//
// Caches ONLY the static app shell (HTML/CSS/JS/icons) so the app is
// installable and opens offline. Market-data requests (Binance,
// Twelve Data, Finnhub, FMP, Alpha Vantage) are explicitly bypassed —
// never cached here — so a stale service-worker cache can never
// masquerade as fresh price data. Freshness/staleness of market data
// is handled entirely by js/dataProviders/index.js at the application
// layer.
//
// NETWORK-FIRST for the app's own JS/CSS/HTML (changed from
// cache-first): this app ships real fixes frequently, and cache-first
// meant a browser that had already cached an old version could keep
// serving that old version indefinitely — updates would only apply in
// the background, one load behind, and a same-named cache never gets
// cleared of stale entries on its own. Network-first means you always
// get whatever's actually deployed while you have a connection; the
// cache is only a fallback for when you're genuinely offline.

const CACHE_NAME = "trading-focus-shell-v2"; // bumped so the old (stale) v1 cache is deleted on next activate
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.ico",
  "./css/styles.css",
  "./js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

const NEVER_CACHE_HOSTS = ["api.binance.com", "api.twelvedata.com", "finnhub.io", "financialmodelingprep.com", "www.alphavantage.co"];

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (NEVER_CACHE_HOSTS.includes(url.hostname)) {
    // Always hit the network for market data; never serve or store a cached copy.
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return; // let cross-origin / non-GET requests pass through untouched
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request)) // offline fallback only — never preferred over a live network response
  );
});
