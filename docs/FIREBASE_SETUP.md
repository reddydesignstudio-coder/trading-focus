# Firebase Cloud Sync — Setup Guide

This is the one feature I genuinely can't test for you — it needs a real
Firebase project with real credentials, which only you can create. Follow
these steps exactly and it should work; if a step doesn't match what you
see, tell me exactly what's on your screen.

**Cost:** Free. The tier this uses (Spark plan) needs no credit card, ever,
for the amount of data a personal trade journal generates.

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com and sign in with your Google
   account.
2. Click **Add project** (or **Create a project**).
3. Give it a name — anything, e.g. `trading-focus`. Click **Continue**.
4. It'll ask about Google Analytics — click the toggle **off** (you don't
   need it) — then click **Create project**.
5. Wait ~30 seconds, then click **Continue** once it's ready.

## 2. Enable Google Sign-In

1. In the left sidebar, click **Build** → **Authentication**.
2. Click **Get started**.
3. Under **Sign-in providers**, click **Google**.
4. Toggle **Enable**, pick a support email (your own email is fine), click
   **Save**.

## 3. Enable Firestore (the actual database)

1. In the left sidebar, click **Build** → **Firestore Database**.
2. Click **Create database**.
3. Choose **Start in production mode** → **Next**.
4. Pick a location close to you (any is fine) → **Enable**.

## 4. Set the security rules (important — do this)

1. Still in Firestore Database, click the **Rules** tab at the top.
2. Delete everything in the box and paste this exactly:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click **Publish**.

This rule means: only a signed-in user can read or write their *own* data —
nobody else's, and nobody who isn't signed in at all. Without this step,
Firestore defaults to a mode that blocks everything, so sync simply won't
work until you publish this.

## 5. Register a Web App and get your config

1. Click the **gear icon** next to "Project Overview" (top-left) →
   **Project settings**.
2. Scroll down to **Your apps**. Click the **`</>`** (web) icon.
3. Give it a nickname (e.g. `trading-focus-web`) → **Register app**. Skip
   the "Firebase Hosting" checkbox.
4. You'll now see a code block containing `const firebaseConfig = { ... }`.
   That object — the part between the curly braces — is what you need.
   It looks like:

```json
{
  "apiKey": "AIza...",
  "authDomain": "trading-focus-xxxxx.firebaseapp.com",
  "projectId": "trading-focus-xxxxx",
  "storageBucket": "trading-focus-xxxxx.appspot.com",
  "messagingSenderId": "123456789",
  "appId": "1:123456789:web:abcdef123456"
}
```

Copy that whole object (including the curly braces).

## 6. Add your app's real-world address to Authorized Domains

This step is easy to miss and Google Sign-In will fail without it.

1. Still in **Authentication**, click the **Settings** tab → **Authorized
   domains**.
2. Click **Add domain**.
3. Add whatever address your app is actually hosted at — e.g.
   `your-username.github.io` (GitHub Pages) or `your-site.netlify.app`
   (Netlify). Don't include `https://` or any trailing slash, just the
   bare domain.
4. `localhost` is already there by default, which is why sign-in works
   fine while testing locally but needs this extra step once it's live.

## 7. Connect it in the app

1. Open Trading Focus → **Settings** → **Cloud Sync (Firebase)**.
2. Paste the whole config object you copied in Step 5 into the text box.
3. Tap **Connect**.
4. Tap **Sign in with Google**, choose your Google account.
5. You should now see "Signed in as your@email.com" and a note that
   syncing is active.

## 8. Do the same sign-in on your other device

On your iPhone (or desktop, whichever you haven't done yet): open the app,
go to Settings → Cloud Sync — you don't need to paste the config again if
you're opening the *same deployed app* (the config travels with the app
itself, not per-device) — just tap **Sign in with Google** and use the
same Google account. Your trades should appear within a few seconds.

If you're testing on a fresh, empty second device and want your existing
data to show up immediately rather than waiting for the first sync, tap
**Pull Latest From Cloud** after signing in. Conversely, if you set up
cloud sync on the device that already has all your trade history, tap
**Push This Device's Data** right after connecting so it uploads what you
already have.

## What syncs, and what doesn't

- **Syncs:** trades, journal entries, backtests (including saved backtest
  runs), and app settings (risk %, watchlists, API keys).
- **Stays local, on purpose:** your PIN. A PIN is a lock for *this device*
  — if it synced, unlocking your phone would also require whatever PIN you
  last set on your desktop, which defeats the point. Set a PIN separately
  on each device if you want one everywhere.

## How conflicts are handled

This is built for one person using their own account on multiple devices,
not multiple people editing together — so there's no real "conflict" to
resolve, just "which device's version is newest." Firestore keeps whichever
write happened most recently and every signed-in device picks that up
automatically, live, within a few seconds — no manual merging.

## Troubleshooting

- **"Sign-in failed or was cancelled"** — almost always the Authorized
  Domains step (Step 6). Double-check the exact domain your app is hosted
  at is listed there.
- **"Couldn't connect"** — the pasted config is either invalid JSON (check
  for a missing comma or bracket) or Firestore/Auth haven't been enabled
  yet (Steps 2–3).
- **Trades not appearing on the other device** — confirm both devices show
  the *same* email under "Signed in as." Different Google accounts
  obviously won't share data — that's the security rule from Step 4 doing
  exactly what it's supposed to.
- **Want to disconnect entirely** — Settings → Cloud Sync → Sign Out, then
  "Disconnect this project" removes the saved config too.
