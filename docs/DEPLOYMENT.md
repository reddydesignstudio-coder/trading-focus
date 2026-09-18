# Deployment (free static hosting)

This app is a static site (HTML/CSS/JS, no build step, no server). Any of the
following free tiers work — pick whichever you already have an account with.

## Option A: GitHub Pages (recommended, simplest)

1. Push the `trading-app/` folder contents to a GitHub repo.
2. Repo → Settings → Pages → Source: `Deploy from a branch` → branch `main`,
   folder `/ (root)` (or `/trading-app` if it's a subfolder — GitHub Pages
   serves from the folder root, so keep `index.html` at that folder's top).
3. Your app is live at `https://<username>.github.io/<repo>/`.

## Option B: Cloudflare Pages

1. Connect your GitHub repo in the Cloudflare dashboard → Pages → Create
   project.
2. Build command: *(none)*. Output directory: `/` (repo root, or wherever
   `index.html` lives).
3. Deploy. You get a free `*.pages.dev` URL plus free custom-domain support.

## Option C: Netlify / Vercel free tier

Both support "drag and drop a static folder" or a connected Git repo with no
build command. Point the output/publish directory at the folder containing
`index.html`.

## HTTPS is required

Service workers (and therefore PWA installability) only work over HTTPS (or
`localhost` for local dev). All three options above serve HTTPS by default —
no extra configuration needed.

## Environment / secrets

There are none to configure at deploy time. The Twelve Data API key is
entered by each user in the app's own Settings screen and stored in their
browser — it is never a server-side environment variable because there is no
server.

## Local development

```bash
npm run serve   # python3 -m http.server 8080
```
Any static file server works identically (`npx serve`, `php -S`, VS Code Live
Server, etc.) — just make sure it serves the folder containing `index.html`
at its root, over HTTP(S).
