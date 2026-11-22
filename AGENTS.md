# AGENTS.md

moneyhound is a single-user household ledger. The owner decides merges. Cloud agents do the implementation. Read this file before changing the app.

## Product boundaries

- One person. Japanese UI. Amounts are integer yen.
- Manual entry in this phase. No bank login, no credential storage, no server-side scraping.
- Static hosting only (Cloudflare Pages or Workers static assets). No application server, no D1, no Workers API.
- System of record is a JSON ledger. A copy lives in IndexedDB. Optional sync uses the owner's Google Drive **My Drive** folder `moneyhound/`, scope `https://www.googleapis.com/auth/drive.file` only.
- If `VITE_GOOGLE_CLIENT_ID` is empty the app must stay fully usable offline. Tests and local development run in that mode.
- Never commit real statements, exports, tokens, or `.env` files. Never deploy. Never widen the OAuth scope.

## Commands

```bash
bun install
bun run dev       # http://127.0.0.1:5173
bun run check     # bun fmt --check, oxlint, typecheck, bun test
bun run test:e2e  # Playwright via bunx, local-only, desktop and mobile
bun run build     # typecheck and production build (apps/web/dist)
```

Package manager is Bun 1.4.5 (`packageManager` and CI). Format with `bun fmt`. Lint with oxlint: Bun 1.4.5 has `bun fmt` and does not ship `bun lint` (`bun --help` lists `fmt` only, and `bun lint` looks for a package script). Do not add ESLint or Prettier.

`bun run check` does not run the browser tests. Run `bun run test:e2e` before a PR that changes UI or storage.

## Layout

Bun workspaces:

- `packages/core` is pure. Model, schema, aggregation, transfers, category rules, the Money Forward CSV parser, `applyImport`, and the sync merge live here. No DOM and no React. Tests sit next to the code and run with `bun test`.
- `packages/ui` is shared React components. It receives a ledger and callbacks. It does not talk to IndexedDB or Google.
- `apps/web` is the Vite PWA: routing, IndexedDB (`moneyhound` / object store `kv`), and the Drive client. Hash routes: `#/`, `#/transactions`, `#/categories`, `#/settings`.
- Playwright lives in `e2e/` and must not need Google. The Drive file is still schema version 1 `ledger.json`.

## Data model (schemaVersion 1)

`Ledger` holds `accounts`, `categories`, `transactions`, `importSources`, `categoryRules`, `budgets`, and `assetSnapshots`.

Every record has `id`, `createdAt`, `updatedAt`, `revision`, and `deletedAt`. Deletes are tombstones so another device can learn about them. Do not drop rows to mean "deleted".

- Amounts are positive integers. `type` is `income`, `expense`, or `transfer`.
- A transfer is one record: `accountId` is the source, `transferAccountId` is the destination. Monthly income, expense, and balance ignore transfers. `projectAccountBalances` moves the amount from one account to the other. An imported transfer may have a null destination until a later importer can pair it; that row still stays out of income and expense.
- Categories have `kind` (`income` or `expense`) and optional `parentId` (Money Forward 中項目).
- Accounts have `kind` (`cash`, `bank`, `card`, `emoney`, `securities`, `other`), optional `sourceId`, optional `externalAccountId`, and `openingBalanceYen` for a later balance screen.
- `budgets` and `assetSnapshots` are stored and synced now and unused by the UI. Phase 3 and phase 4 should fill them instead of replacing the ledger.
- `categoryOrigin` is `user`, `import`, or `rule`. Re-import must not replace a `user` category.
- `Transaction.source` is `{ sourceId, externalId, contentHash, importedAt }`. Manual rows use source id `manual`. Imported rows use the import-source id `src_<adapterId>`.

Seed categories and accounts use fixed ids and the timestamp `1970-01-01T00:00:00.000Z`, so two devices start from the same canonical records.

Backup files are `{ app: "moneyhound", schemaVersion, exportedAt, ledger }`. The Drive file is the ledger object itself, not the backup wrapper. `assertLedger` rejects `schemaVersion` other than `1`. Adding a field requires a version bump and a migration in `assertLedger` / `loadStoredLedger`.

## Sync

Last-writer-wins is per record, not per file.

1. Remember the ledger we last successfully synced (`SyncState.base`) and the Drive etag.
2. Read the remote ledger. If it is not valid JSON of schema 1, stop and do not upload.
3. Three-way merge base, local, and remote (`mergeLedgers`). A missing row is not a delete. Both sides changed the same id: higher `revision` wins, then later `updatedAt`, then a deterministic canonical JSON tie-break. The result lists those conflicts.
4. Upload the merged ledger with `If-Match` on the etag we just read. On HTTP 412, re-read and merge again (up to three attempts).
5. Save the merged ledger as both the local copy and the new base.

Two devices that edit different records both keep their edits. Two devices that edit the same record keep the newer revision instead of one file replacing the other. Clocks can still tie; revision is the primary key because each edit increments it.

The Drive client creates a visible folder named `moneyhound` and `ledger.json` inside it, marked with `appProperties.app=moneyhound`. `drive.file` only sees files this OAuth client created. The app does not read the rest of the user's Drive.

## Importers

Parsers implement `ImporterAdapter` in `packages/core/src/importers`:

```ts
parse({ bytes, fileName }) => ImportParseResult
```

`applyImport` turns normalized rows into ledger records. It creates missing accounts and categories, applies category rules when the file has no category, and matches existing rows by `(sourceId, externalId)` or, when there is no external id, `(sourceId, contentHash)`. The same file imported twice does not duplicate rows. `計算対象=0` soft-deletes a previously imported id. A row that disappears from a later file is not deleted.

Registered now:

| id                  | status                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `mf-csv`            | Parser and `applyImport` path. No import button yet.                                                   |
| `institution-csv`   | Planned. Official CSV/OFX the owner downloads (banks, cards, brokerages, e-money).                     |
| `browser-extension` | Planned. A Chrome extension reads a statement page the owner already opened and sends rows to the app. |

Adapters must not collect passwords, cookies, or passkeys, and must not automate login. `pnsk-lab/mnie` was consulted for the provider boundary (adapter id, normalized account/transaction, stable external reference). None of its login, session, or passkey code is in this repo and it must not be added.

`mf-csv` reads Money Forward ME 「収入・支出詳細」. Columns, header folding, and the UTF-8 / UTF-16 / Shift_JIS decode order follow `ossannote2025/mf-csv-viewer` (MIT). See `THIRD_PARTY_NOTICES.md`. Positive amounts are income, negative amounts are expense, `振替=1` is a transfer, and the MF `ID` column is `externalId`.

Money Forward CSV export requires MF Premium. After the owner cancels Money Forward, new history has to come from each institution's own CSV/OFX (or the extension). Do not assume MF CSV will remain available. The MF parser stays so the owner can import history exported before cancellation.

Category rules (`contains` or `regex` on the description, optional `sourceId` / `accountId`) run at import time when the source did not name a category. Lower `priority` wins. This is the replacement for Money Forward's exact-match learning. The settings screen can add a contains-rule. Regex is in the model and is applied by `categoryFromRules`; the screen does not edit regex yet.

Institution-specific column maps (SMBC, WAON, and others) are not ported in this phase. Add them as new adapters with synthetic fixtures, not real statements.

## Verification before a PR

- `bun run check` passes.
- `bun run test:e2e` passes when UI, routing, or IndexedDB behavior changes.
- `bun run build` passes.
- New domain behavior has unit tests. Import changes need a fixture with fictional rows.
- Do not weaken the OAuth scope test in `packages/core/src/sync/exchange.test.ts`.

## Definition of done

- The change matches the issue's acceptance criteria and stays inside that scope.
- Schema changes are versioned and covered by backup/merge tests.
- Local-only mode still works with an empty client id.
- No secrets, no real financial data, no deploy, no scope wider than `drive.file`.
- `AGENTS.md` is updated when commands, the data model, or the importer contract change.

## Owner setup (not done by agents)

Agents must not change GitHub settings or branch protection. The owner should:

- Require the `verify` workflow on `main`.
- Create labels `ready-for-agent`, `spec`, and `blocked` for issue triage.
- Create the Google OAuth client and the Cloudflare project (see `README.md`) when they want sync and hosting.
