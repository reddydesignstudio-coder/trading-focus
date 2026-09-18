# Phase 2: Native iOS Migration Plan (forward-looking, not built in Phase 1)

Phase 1 is deliberately a $0, client-side PWA. This document sketches how a
native iOS app would build on top of it, for when that becomes worth the
tradeoff (App Store account, possible paid infra, real background execution).

## What moves as-is

The entire trading engine is pure, dependency-free JavaScript with no DOM or
browser-API coupling in its core (`indicators.js`, `structure.js`,
`candlestick.js`, `regime.js`, `strategies/*`, `confirmation.js`,
`confidence.js`, `targetEngine.js`, `risk.js`, `noTrade.js`,
`tradeResolution.js`, `performance.js`). Two realistic paths:

1. **Swift rewrite of the engine**, using this JS as the exact functional
   spec (same formulas, same thresholds, same test cases ported to XCTest).
   Best long-term native performance and access to iOS-native background
   execution / push notifications.
2. **Embed the existing JS engine in a WKWebView-based app**, replacing only
   the data layer (native `URLSession` networking) and notification layer
   (native `UserNotifications` framework + APNs) while keeping the UI either
   as the existing web UI in a WebView or rebuilt in SwiftUI talking to the
   same JS engine via a JS bridge. Faster to ship, less native "feel."

## What genuinely requires going native

- **Reliable background execution.** iOS's `BGTaskScheduler` / Background App
  Refresh lets a native app periodically wake up and run a scan even when not
  foregrounded — something no web app (installed or not) can do reliably on
  iOS. This is the #1 reason to go native for anyone who wants "wake me up
  when a setup appears."
- **True push notifications via APNs**, which do fire while the app is fully
  closed. Requires an Apple Developer account ($99/year) and, for
  server-triggered pushes (vs. locally-scheduled ones), a small always-on
  backend — the first real ongoing cost in this project's lifecycle.
- **Broker/exchange integration for real order execution** (out of scope for
  both Phase 1 and this Phase 2 sketch — this app remains analysis + paper
  trading unless a future phase explicitly adds broker connectivity, with all
  the regulatory/compliance work that implies).

## What stays free / cheap even in Phase 2

- IndexedDB → Core Data or SQLite: same local-only storage model, still free.
- Data providers: same Binance (free) + Twelve Data (free tier, user's own
  key) abstraction — a native `URLSession`-based provider implementing the
  same `{symbol, timeframe, limit} → {candles, status}` contract slots in
  without changing the engine.
- Locally-scheduled notifications (`UNUserNotificationCenter`, fired by the
  app itself while it's running or via `BGTaskScheduler` wake-ups) are free
  and don't require a backend — only *server-pushed* notifications
  (APNs push from a remote trigger) need backend infrastructure.

## Suggested phased approach

1. **Phase 2a:** Wrap Phase 1 in a thin native shell (WKWebView) + native
   `BGTaskScheduler` job that runs the existing scan logic in a background JS
   context on a schedule, firing local notifications on qualifying setups.
   No backend required — still $0 (minus the $99/year Apple Developer fee).
2. **Phase 2b:** If/when real-time push-while-closed or multi-device sync is
   wanted, add a minimal backend (e.g. a serverless function + a push
   service) — this is the first point real "server" cost enters the picture.
3. **Phase 3 (not scoped here):** Broker integration for real execution, with
   all associated compliance work — a substantial, separate undertaking.
