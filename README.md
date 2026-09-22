# BNP - Internal Traffic Control (warehouse boards)

Static site + one Netlify Function, deployed to Netlify as `bnp-itc.netlify.app`.

## What's here

- `index.html` — a single TV board. Which board it shows comes from its own URL query string, e.g. `index.html?board=in`, `?board=order_processing`, `?board=order_fulfillment`, `?board=prep`, `?board=prep_holding_rentals`, `?board=out`.
- `overview.html` — the desk-preview page that iframes all six boards at once.
- `dashboard.html` — the manager control dashboard (buttons to toggle Urgent / In Process / Complete / See MGMT per order).
- `netlify/functions/board-data.js` — a Netlify Function that both `index.html` and `dashboard.html` call (same-origin, at `/.netlify/functions/board-data`) instead of talking to Apps Script directly. It follows Apps Script's internal redirect server-side (avoiding a Safari-specific redirect-timing bug that caused intermittent "Could not reach the Apps Script data endpoint" errors) and caches briefly so several screens polling at once only cost one real Apps Script call.
- `netlify.toml` — tells Netlify where the function lives and which Node version to run it on.

## What's NOT here

`Code.gs`, `Board.html`, and `Dashboard.html` (capital D) are the Google Apps Script side of this project — they live in the Apps Script editor bound to the "BNP - Internal Traffic Control" Google Sheet, not in this repo. Deploying this repo never touches that side; the two are connected only by the `APPS_SCRIPT_URL` constant near the top of `netlify/functions/board-data.js`, which should always point at that Apps Script project's current `/exec` deployment URL.

## One-time setup: connecting this repo to the existing Netlify site

1. Push this repo to GitHub (see commands below).
2. In Netlify: open the **existing** `bnp-itc` site (don't create a new one — that would give you a different URL) → **Site configuration → Build & deploy → Continuous deployment** → **Link repository** (or "Link site to a Git repository") → choose this repo.
3. Build settings: leave **Build command** blank (there's nothing to build — it's plain HTML plus one function) and set **Publish directory** to the repo root (`.` / leave default).
4. Deploy. Netlify will now auto-bundle `netlify/functions/board-data.js` as a live function at `/.netlify/functions/board-data`, and both `index.html` and `dashboard.html` already point at it.

After that, every update is just a normal git push — no manual file dragging, and the function stays live automatically.

## Pushing this to GitHub for the first time

```
cd bnp-itc-repo
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

(Replace the URL with the actual repo you create on GitHub — create it empty, no README/gitignore, since this folder already has both.)
