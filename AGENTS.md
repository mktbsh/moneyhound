# AGENTS.md

moneyhound is a single-user household ledger. The owner decides merges. Cloud agents do the implementation. Read this file before changing the app.

## Product boundaries

- One person. Japanese UI. Amounts are integer yen.
- Manual entry and CSV import the owner starts. No bank login, no credential storage, no server-side scraping.
- Hosted as a Google Apps Script web app, run as the owner and open only to the owner (`executeAs: USER_DEPLOYING`, `access: MYSELF`). No other server, no Cloudflare, no OAuth client of our own.
- System of record is one JSON ledger, `My Drive/moneyhound/ledger.json`. Apps Script scope is `https://www.googleapis.com/auth/drive.file` only (`apps/gas/appsscript.json`).
- Online only. The page has no offline copy; every edit is saved to Drive. Local development and e2e run without Google and keep the ledger in IndexedDB.
- The page is one self-contained HTML file (Solid, `vite-plugin-singlefile`). Keep it small: no image files; icons are inline SVG, and anything large comes from a CDN.
- Never commit real statements, exports, tokens, `.clasp.json`, or `.env` files. Never push or deploy the Apps Script project. Never widen the scope.

## Commands

```bash
bun install
bun run dev       # http://127.0.0.1:5173
bun run check     # bun fmt --check, oxlint, typecheck, bun test
bun run test:e2e  # Playwright via bunx, local-only, desktop and mobile
bun run build     # typecheck, apps/web/dist/index.html, then apps/gas/dist (Code.js, appsscript.json, index.html)
bun run gas:push  # owner only: build and clasp push apps/gas/dist (needs apps/gas/.clasp.json)
bun run verify:formal  # core money property tests, then the Lean proofs
bun run try:import     # owner only: run the importers on CSVs in .private/statements (gitignored)
```

`.private/` is for the owner's real statements and outputs. It is gitignored. Agents read it only when the owner asks in that session, never copy or quote real rows into commits, issues, or PRs, and never build fixtures from it. `try:import` prints counts and totals only unless `--rows N` is passed; `--out` writes a backup JSON there to load in the app.

Package manager is Bun 1.4.5 (`packageManager` and CI). Typecheck uses `typescript@7.0.2` (`tsc` launches the native Go compiler). Node is 26.13.1 (`.node-version` and `engines`); CI installs that Node for Playwright. Format with `bun fmt`. Lint with oxlint: Bun 1.4.5 has `bun fmt` and does not ship `bun lint` (`bun --help` lists `fmt` only, and `bun lint` looks for a package script). Do not add ESLint or Prettier.

`bun run check` does not run the browser tests. Run `bun run test:e2e` before a PR that changes UI or storage.

## Layout

Bun workspaces:

- `packages/core` is pure. Model, schema, aggregation, transfers, category rules, the institution CSV parser, `applyImport`, and the sync merge live here. No DOM and no UI framework. Tests sit next to the code and run with `bun test`.
- `packages/ui` is Solid 2 components (`solid-js` and `@solidjs/web` 2.0, built by `@solidjs/vite-plugin` 3). It receives a ledger and callbacks. It does not talk to storage or Google. Read props as `props.x` inside JSX, memos, or handlers; never destructure props or read them once in a component body (Solid 2 reports `STRICT_READ_UNTRACKED`). Form state seeded from props uses `editable()` in `packages/ui/src/editable.ts`. Use `onInput` for text fields, lowercase HTML attribute names (`inputmode`), and string values for `aria-*`. Do not silence diagnostics with `untrack`. Check the browser console for `[CODE]` warnings after UI changes; the repair guide is `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`.
- `apps/web` is the Vite app built into one `index.html`: routing, the store, and `storage/backend.ts`. When the page runs inside Apps Script (`google.script.run` exists) it uses `driveBackend`; otherwise `localBackend` (IndexedDB `moneyhound` / object store `kv`). Hash routes: `#/`, `#/transactions`, `#/categories`, `#/settings`.
- `apps/gas` is the Apps Script project: `src/Code.js` (`doGet`, `mhRead`, `mhWrite`), `appsscript.json`, and `build.ts`, which assembles `apps/gas/dist`. `src/fakeAppsScript.ts` runs `Code.js` in tests with in-memory Drive, properties, and lock services.
- Playwright lives in `e2e/` and must not need Google. It runs the local backend.

## Data model (schemaVersion 2)

`Ledger` holds `accounts`, `categories`, `transactions`, `importSources`, `categoryRules`, `budgets`, and `assetSnapshots`.

Every record has `id`, `createdAt`, `updatedAt`, `revision`, and `deletedAt`. Deletes are tombstones so another device can learn about them. Do not drop rows to mean "deleted".

- Amounts are positive integers. `type` is `income`, `expense`, or `transfer`.
- A transfer is one record. `accountId` is the source and `transferAccountId` is the destination. Either side may be null, and both null is invalid. Income and expense always set `accountId` and leave `transferAccountId` null. Monthly income, expense, and balance ignore transfers. `projectAccountBalances` debits a set source and credits a set destination. An importer sees one account, so an imported transfer is one-sided: an outflow sets `accountId` and leaves `transferAccountId` null (振替先未設定); an inflow leaves `accountId` null and sets `transferAccountId` (振替元未設定). Both stay out of income and expense. Rows from different statements are never matched against each other (no bank-to-card netting).
- Categories have `kind` (`income` or `expense`) and optional `parentId` (a statement's middle category).
- Accounts have `kind` (`cash`, `bank`, `card`, `emoney`, `securities`, `other`), optional `sourceId`, optional `externalAccountId`, and `openingBalanceYen` for a later balance screen.
- `budgets` and `assetSnapshots` are stored now and unused by the UI. Phase 3 and phase 4 should fill them instead of replacing the ledger.
- `categoryOrigin` is `user`, `import`, or `rule`. Re-import must not replace a `user` category.
- `Transaction.source` is `{ sourceId, externalId, contentHash, importedAt }`. Manual rows use source id `manual`. Imported rows use the import-source id `src_<adapterId>`.

Seed categories and accounts use fixed ids and the timestamp `1970-01-01T00:00:00.000Z`, so two devices start from the same canonical records.

Backup files are `{ app: "moneyhound", schemaVersion, exportedAt, ledger }`. The Drive file is the ledger object itself, not the backup wrapper. `assertLedger` rejects `schemaVersion` other than `2`. Version 1 was never shipped, so there is no migration from it. Adding a field requires a version bump and a migration in `assertLedger` / `loadStoredLedger`.

## Saving to Drive

Last-writer-wins is per record, not per file.

1. `mhRead` returns the file body and a version counter (script property `ledgerVersion`) as its etag.
2. Every edit sends the whole ledger to `mhWrite` with the version it was based on. Under a script lock, the server writes only when that version is current, then increments it. Otherwise it throws `precondition_failed`. It also refuses a body that is not a schema 2 ledger.
3. On `precondition_failed`, the page runs `exchangeLedgers`: read the remote, three-way merge base, local, and remote (`mergeLedgers`), and write again (up to three attempts). A missing row is not a delete. Both sides changed the same id: higher `revision` wins, then later `updatedAt`, then a deterministic canonical JSON tie-break.
4. The merged ledger becomes the screen's ledger and the new base. Edits are saved one at a time.

Two devices that edit different records both keep their edits. Other devices' changes appear on reload or with 「最新を読み込む」 in settings.

`Code.js` creates a visible folder `moneyhound` and `ledger.json` inside it, and remembers the file id in script properties. With `drive.file`, Apps Script only sees files this script created. A hand edit of the file in Drive does not bump the version.

## Importers

Parsers implement `ImporterAdapter` in `packages/core/src/importers`:

```ts
parse({ bytes, fileName, accountName?, positiveAmountIs? }) => ImportParseResult
```

`accountName` names the account for a statement that does not (an institution CSV is one account). `positiveAmountIs` says how a single signed amount column reads (`expense` for card statements). The settings screen passes the chosen account's name, and `expense` when that account's kind is `card`.

`applyImport` turns normalized rows into ledger records. It creates missing accounts and categories, applies category rules when the file has no category, and matches existing rows by `(sourceId, externalId)` or, when there is no external id, `(sourceId, contentHash)`. The same file imported twice does not duplicate rows. A row with `include: false` soft-deletes a previously imported id. A row that disappears from a later file is not deleted. `ImportReport` counts `inserted`, `updated`, `unchanged`, `excluded` (tombstoned by `include: false`), and `skipped` (`include: false` rows never imported).

The settings screen 「明細の取り込み」 picks an adapter (and an account for `institution-csv`), parses the file in the browser, shows a dry-run `ImportReport`, parse errors, and how many one-sided transfers will remain, and commits only on 「取り込む」. The file never leaves the device.

One-sided transfers (振替先未設定 / 振替元未設定) are listed across all months in an optional settings section 「振替の相手口座（任意）」. The owner chose continuity over exactness: old history often cannot be resolved, and a one-sided transfer only shifts account balances, never monthly income, expense, or balance, so the app does not nag about them on the transactions screen. `groupUnresolvedTransfers` groups them by missing side, known account, and folded description (a monthly card repayment is one group), and `fillTransferSides` sets the missing side of a whole group. `setTransferAccounts` changes one row. Neither touches provenance, so re-import keeps the chosen account.

Money Forward CSV is not imported, on purpose. Supporting its export format (transfers flagged 計算対象=0, 「なし」 accounts, two-row transfer pairing) made the core more complex than the history was worth. Do not add an MF adapter back. Data already imported from MF stays valid: it is ordinary schema 2 rows with source id `src_mf-csv`.

Registered now:

| id                  | status                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `institution-csv`   | Generic header-detected CSV for one bank, card, or e-money account. OFX is not read yet.               |
| `browser-extension` | Planned. A Chrome extension reads a statement page the owner already opened and sends rows to the app. |

Adapters must not collect passwords, cookies, or passkeys, and must not automate login.

Category rules (`contains` or `regex` on the description, optional `sourceId` / `accountId`) run at import time when the source did not name a category. Lower `priority` wins. The settings screen can add a contains-rule. Regex is in the model and is applied by `categoryFromRules`; the screen does not edit regex yet.

`institution-csv` finds the header row in the first 30 lines by known Japanese column names (`ALIASES` in `institutionCsv.ts`): a date column, and either 出金/入金 style columns or one amount column, plus optional description, balance, and memo columns. Dates accept `YYYY/M/D`, `YYYY.M.D`, `YYYY年M月D日`, `YYYYMMDD`, and Reiwa (`R8.4.2`, `令和8年4月2日`). Rows with no date (totals) or no amount (前月繰越) are skipped silently. There is no row id, so the content hash includes the running balance when the file has one. Every row is income or expense; a bank row that is really a move between the owner's own accounts (card payment, ATM) is counted as expense until the owner edits it. A new column name goes into `ALIASES` with a fictional fixture. An institution whose layout the aliases cannot read gets its own adapter, with synthetic fixtures, not real statements.

## Verification before a PR

- `bun run check` passes.
- `bun run test:e2e` passes when UI, routing, or storage behavior changes.
- `bun run build` passes.
- `bun run verify:formal` passes when aggregation, `applyImport`, or the sync merge changes. The spec and the command live in `.cursor/skills/verify-core-invariants/SKILL.md`.
- New domain behavior has unit tests. Import changes need a fixture with fictional rows.
- Do not weaken the scope tests in `packages/core/src/sync/exchange.test.ts` and `apps/gas/src/Code.test.ts`.

## Definition of done

- The change matches the issue's acceptance criteria and stays inside that scope.
- Schema changes are versioned and covered by backup/merge tests.
- Local mode (no Apps Script) still works, so e2e needs no Google.
- No secrets, no real financial data, no deploy, no scope wider than `drive.file`.
- `AGENTS.md` is updated when commands, the data model, or the importer contract change.

## Owner setup (not done by agents)

Agents must not change GitHub settings or branch protection. The owner should:

- Require the `verify` workflow on `main`.
- Create labels `ready-for-agent`, `spec`, and `blocked` for issue triage.
- Create the Apps Script project, bind it with `apps/gas/.clasp.json`, and push and deploy it (see `README.md`).
