# PWA: Installation & Notification Limitations

## Installing on iPhone (Safari)

1. Open the deployed app URL in **Safari** (not Chrome — iOS requires Safari
   for the "Add to Home Screen" PWA install path).
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The app now launches full-screen from your home screen, with
   its own icon, no Safari address bar.

## Installing on Android (Chrome)

1. Open the deployed app URL in Chrome.
2. Tap the **⋮** menu → **Add to Home screen** (or you may see an automatic
   "Install app" prompt/banner).
3. Confirm. The app installs like a native app, launches standalone.

## Installing on Desktop (Chrome/Edge)

Look for the install icon (⊕ or a monitor-with-arrow icon) in the address bar,
or **⋮ menu → Install Trading Focus…**.

## Offline behavior

The service worker caches the app shell (HTML/CSS/JS/icons) so the app opens
even with no connection. It deliberately does **not** cache market-data API
responses (Binance/Twelve Data) — see `service-worker.js`. Offline, you'll see
the UI, your stored journal/performance data, and a `DATA UNAVAILABLE` status
on any screen that needs fresh market data.

## Notification limitations — read this honestly

Browser and PWA notifications in this app use the standard web
[Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API).
Here is exactly what that can and cannot do:

- **While the app is open and in the foreground:** notifications fire
  reliably.
- **While the app is briefly backgrounded** (you switched apps for a moment):
  usually still works, platform-dependent.
- **While the app is fully closed, or suspended by the OS** (which iOS does
  aggressively for web apps, including installed PWAs): **notifications will
  not fire.** iOS Safari/PWA does not support always-on background push for
  home-screen web apps the way native iOS apps or (to a lesser extent)
  Android/desktop Chrome do.
- **This app never runs a persistent background market scanner.** There is no
  server pushing alerts to you — everything happens client-side, in your
  browser, only while that browser tab/app is alive.

**Practical implication:** treat in-app alerts (session-open reminders,
"high-confidence setup found", TP/SL reached, daily result) as a convenience
when you have the app open, not as something to rely on to wake you up for a
trade. Do not use this app as your sole mechanism for time-sensitive alerts.

## Why not Web Push (server-sent push notifications)?

Web Push that works while the app is fully closed requires a push service and
(for iOS 16.4+ home-screen web apps) VAPID keys plus a server endpoint that
sends the push payload. Building that "for free" means running always-on
server infrastructure, which conflicts with the $0 zero-cost requirement.
Phase 2 (native iOS, see `docs/PHASE2_IOS.md`) is the right place to solve
this properly.
