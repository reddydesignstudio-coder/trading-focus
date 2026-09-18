# Storage Documentation

## Engine

Plain IndexedDB via a small hand-rolled promise wrapper (`js/db.js`) — no
external dependency. Database name: `trading_focus_db`. Current schema
version: `1` (see `DB_VERSION` in `js/db.js`).

## Stores

| Store | Key | Indexes | Contents |
|---|---|---|---|
| `settings` | `key` | — | Risk defaults, timezone, API keys, provider overrides |
| `signals` | `id` | `byDate(dateKey)`, `bySymbol`, `byMarket` | Every qualifying/rejected/missed setup the scanner produced |
| `trades` | `id` | `byDate(dateKey)`, `byMode`, `byStatus`, `bySymbol` | Executed paper trades (Live or Test mode) |
| `dailySummaries` | `dateKey` | — | Reserved for cached daily rollups (computed on demand today; see note below) |
| `backtests` | `id` | `byDate(createdAt)` | Saved backtest runs (UI currently computes on demand; store is ready for "save this run") |
| `strategyResults` | `id` | `byStrategy` | Reserved for cached Strategy Lab rollups |
| `alerts` | `id` | `byDate(createdAt)` | Fired/attempted notification records |
| `marketCache` | `key` | — | Reserved store; live caching currently uses an in-memory `Map` in `dataProviders/index.js` for simplicity — this store exists for a future "persist cache across reloads" enhancement |

Note: `dailySummaries`, `backtests`, `strategyResults`, and `marketCache` are
created by the versioned schema so Phase 1.x can start writing to them without
another migration; the current UI computes those views on demand from
`signals`/`trades` via `performance.js` rather than persisting a duplicate
rollup, to avoid a second source of truth. This is intentional and documented,
not an oversight.

## Schema versioning / migration

`DB_VERSION` drives `indexedDB.open(DB_NAME, DB_VERSION)`. Bumping it triggers
`onupgradeneeded`, where `STORE_DEFS` is walked to create any missing store or
index. Existing data in already-present stores is preserved automatically by
IndexedDB — `onupgradeneeded` only touches structure, never row data. To add a
field to existing records, write a small migration function called from
`onupgradeneeded` after the store/index creation loop (not included in Phase 1
since no migration has been needed yet — the hook point is ready).

## Export / Import

- **Export JSON** (`js/exportImport.js#exportJSON`): dumps every store as-is,
  a full backup you can restore later or move to another browser/device.
- **Export Trades CSV**: flat trade-level export for spreadsheet analysis.
- **Import JSON**: merges (default) or replaces (`merge:false`) each store's
  contents from a previously exported file.

## Data never leaves your device

Nothing in `db.js` makes a network call. All persistence is local to the
browser profile you're using. Clearing site data / browser storage, or
switching browsers or devices, loses your data unless you've exported a
backup first.
