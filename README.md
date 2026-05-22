# Xero Invoicer

Desktop app that turns a weekly placements spreadsheet into draft invoices in
Xero. Built for Josh (The Enclosure / Keep Education / Teach Education).

Drafts only. Nothing is sent to schools automatically.

## What it does

1. Drop in `Week_ending_DDth_Month_YYYY.xlsx`
2. Parses ~95 schools and ~150–200 teacher placements
3. Matches each school to a Xero contact (fuzzy + saved mappings)
4. Creates one **draft** invoice per school in Xero with all teacher line items
5. Josh reviews and sends from Xero

## Setup

### 1. Install Node 20+ and npm

```bash
node --version  # should be v20 or v22
```

### 2. Install dependencies

```bash
npm install
```

### 3. Register a Xero developer app

1. Sign in to <https://developer.xero.com>
2. Create a new app (Web app or "Auth code with PKCE")
3. Set the redirect URI to **exactly** `http://localhost:5391/callback`
4. Required scopes (already requested in code — granular scopes per Xero's 2 March 2026 change):
   - `openid`, `profile`, `email`
   - `accounting.contacts.read`
   - `accounting.invoices` (replaced the legacy `accounting.transactions`)
   - `accounting.settings.read`
   - `offline_access`
5. Copy the client ID and client secret

### 4. Configure .env

```bash
cp .env.example .env
# edit .env and paste your Xero credentials
```

### 5. Run in development

```bash
npm run dev
```

The app window opens. Click **Connect to Xero**, authorise in your browser,
return to the app and you're ready to drop in a spreadsheet.

## Build for distribution

```bash
npm run dist:win   # Windows .exe installer
npm run dist:mac   # macOS .dmg
```

Output lands in `release/`.

## Project layout

```
electron/         Main process + IPC + Xero SDK wrapper + parser
  main.ts         Window/menu/IPC bootstrap
  preload.ts      contextBridge.exposeInMainWorld('api', …)
  xero/           OAuth, client, contacts/accounts/invoices
  parser/         XLSX parsing + grouping
  matching/       Fuzzy matching (fuse.js)
  store/          electron-store schema + accessors
src/              React renderer (Vite)
  screens/        One per step (Setup → Upload → Parse → Match → Review → Results)
  components/     Layout + recent-runs modal
  lib/            Run context + formatters
shared/           Types + bridge API contract used by both sides
```

## Notes

- Tokens are stored encrypted in `electron-store` with a key derived from
  machine + user details. Not a true secret, but obscures inspection.
- School → contact mappings persist across runs. After the first week, every
  school auto-resolves and you click straight through to review.
- The app throttles to ~1 invoice/second to stay under Xero's 60/min limit
  and retries 429 / 5xx with exponential backoff.
- Dry run mode is **on by default** so you can sanity-check before going live.
- Run history (last 50) is available from the **History** button in the header.

## Troubleshooting

- **"Not connected to Xero"** — open Settings → Manage Xero connection, or
  the first-run Setup screen, and click Connect.
- **"Xero refresh token rejected"** — tokens have been revoked (60 days idle,
  or the developer app secret has rotated). Disconnect and reconnect.
- **Spreadsheet won't parse** — check the filename matches the
  `Week_ending_*` pattern, or enter the date manually when prompted.
- **Wrong account code / branding theme** — set defaults in Settings; the
  Review screen also lets you override per run.
