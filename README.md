# BNP - Internal Traffic Control (warehouse boards)

Static pages hosted on GitHub Pages. The pages fetch board data directly from the Google Apps Script web app bound to the "BNP - Internal Traffic Control" Google Sheet.

## What's here

- `index.html` — a single TV board. Which board it shows comes from its URL query string:
  - `index.html?board=in` — Inbound Docks
  - `index.html?board=out` — Outbound Docks
  - `index.html?board=prep` — Prep Areas
  - `index.html?board=order_processing` — Inbound Processing
  - `index.html?board=order_fulfillment` — Order Fulfillment
  - `index.html?board=prep_holding_rentals` — Prep Holding & Rentals
- `overview.html` — desk preview showing all six boards at once.
- `dashboard.html` — manager control dashboard (Urgent / In Process / Complete / See MGMT per order).

## What's NOT here

`Code.gs`, `Board.html`, and `Dashboard.html` (capital D) live in the Apps Script editor bound to the Google Sheet. The two sides are connected only by the `SCRIPT_URL` constant near the top of `index.html` and `dashboard.html`, which must point at that Apps Script project's current `/exec` deployment URL.

`Code.gs` serves pre-built boards that are rebuilt only when the sheet changes, a dashboard button is pressed, or hourly. The `installBoardTriggers` function must be run once in the Apps Script editor for that to work.

## Hosting (GitHub Pages)

Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)**. Every push to `main` republishes the site. `.nojekyll` tells Pages to serve the files as-is.
