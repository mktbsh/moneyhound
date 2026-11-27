/**
 * Local-only check of the importers against the owner's own statement files.
 *
 *   .private/statements/<口座名>/*.csv       institution CSV for that account
 *   .private/statements/<口座名>@card/*.csv  same, forcing the account kind
 *
 *   bun run try:import                 summary only (no row contents)
 *   bun run try:import --rows 5        also print the first 5 parsed rows per file
 *   bun run try:import --out           write .private/out/moneyhound-backup.json
 *
 * `.private/` is gitignored. Nothing is sent anywhere. Do not paste real rows into issues or PRs.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  addAccount,
  applyImport,
  decodeCsvBytes,
  detectInstitutionLayout,
  exportBackup,
  formatYen,
  getImporter,
  groupUnresolvedTransfers,
  guessAccountKind,
  projectAccountBalances,
  seedLedger,
  summarizeMonth,
  unresolvedTransfers,
  type AccountKind,
  type ImportParseResult,
  type Ledger,
} from '../packages/core/src/index'

const ROOT = join(import.meta.dirname, '..', '.private')
const STATEMENTS = join(ROOT, 'statements')
const OUT = join(ROOT, 'out')
const KINDS: readonly AccountKind[] = ['cash', 'bank', 'card', 'emoney', 'securities', 'other']
const SHOWN_ERRORS = 10

const args = process.argv.slice(2)
const rowsIndex = args.indexOf('--rows')
const showRows = rowsIndex >= 0 ? Number(args[rowsIndex + 1] ?? 5) : 0
const writeOut = args.includes('--out')

let sequence = 0
const clock = () => ({ now: new Date().toISOString(), id: () => `local-${++sequence}` })

function csvFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /\.csv$/i.test(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => join(dir, name))
}

function folderTarget(folder: string): { accountName: string; kind: AccountKind } {
  const [name, forced] = folder.split('@')
  const kind = KINDS.includes(forced as AccountKind)
    ? (forced as AccountKind)
    : guessAccountKind(name)
  return { accountName: name.trim(), kind }
}

function ensureAccount(ledger: Ledger, name: string, kind: AccountKind): Ledger {
  if (ledger.accounts.some((account) => account.deletedAt === null && account.name === name)) {
    return ledger
  }
  return addAccount(ledger, { name, kind }, clock())
}

function describeParse(parsed: ImportParseResult) {
  const rows = parsed.transactions
  const dates = rows.map((row) => row.date).sort()
  const sum = (type: string) =>
    rows.filter((row) => row.type === type).reduce((total, row) => total + row.amountYen, 0)
  const count = (type: string) => rows.filter((row) => row.type === type).length
  console.log(
    `  読めた行 ${rows.length}件 · 読み飛ばし ${parsed.errors.length}件` +
      (dates.length ? ` · 期間 ${dates[0]} 〜 ${dates[dates.length - 1]}` : ''),
  )
  console.log(
    `  収入 ${formatYen(sum('income'))}（${count('income')}件） · 支出 ${formatYen(sum('expense'))}（${count('expense')}件） · 振替 ${formatYen(sum('transfer'))}（${count('transfer')}件）`,
  )
  const excluded = rows.filter((row) => !row.include).length
  if (excluded) console.log(`  対象外 ${excluded}件`)
  const hashOnly = rows.filter((row) => !row.externalId)
  const distinct = new Set(hashOnly.map((row) => row.contentHash)).size
  if (hashOnly.length > distinct) {
    console.log(
      `  同じ日・金額・内容の行 ${hashOnly.length - distinct}件（出現順で区別。期間が重なるファイルでは要確認）`,
    )
  }
  for (const error of parsed.errors.slice(0, SHOWN_ERRORS)) {
    console.log(`  ! ${error.line}行目: ${error.message}`)
  }
  if (parsed.errors.length > SHOWN_ERRORS) {
    console.log(`  ! ほか ${parsed.errors.length - SHOWN_ERRORS}件`)
  }
  for (const row of rows.slice(0, showRows)) {
    const sign = row.amountSign < 0 ? '-' : '+'
    console.log(
      `    ${row.date} ${row.type.padEnd(8)} ${sign}${row.amountYen} ${row.accountName ?? '-'} | ${row.description}` +
        (row.categoryLarge ? ` [${row.categoryLarge}/${row.categoryMiddle ?? ''}]` : ''),
    )
  }
}

function importFile(
  ledger: Ledger,
  file: string,
  adapterId: string,
  target?: { accountName: string; kind: AccountKind },
): Ledger {
  const bytes = new Uint8Array(readFileSync(file))
  const { encoding, text } = decodeCsvBytes(bytes)
  console.log(`\n■ ${relative(STATEMENTS, file)}  [${adapterId}, ${encoding}]`)
  if (adapterId === 'institution-csv') {
    const layout = detectInstitutionLayout(text)
    if (layout) {
      const columns = Object.entries(layout.columns)
        .map(([key, value]) => [key, Array.isArray(value) ? value.join('+') : value])
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      console.log(`  見出し ${layout.headerLine}行目: ${columns}`)
    }
  }
  const parsed = getImporter(adapterId)!.parse({
    bytes,
    fileName: basename(file),
    accountName: target?.accountName,
    positiveAmountIs: target?.kind === 'card' ? 'expense' : undefined,
  })
  if (parsed.fileError) {
    console.log(`  × ${parsed.fileError}`)
    return ledger
  }
  describeParse(parsed)
  const applied = applyImport(ledger, parsed, clock())
  const report = applied.report
  console.log(
    `  取り込み: 追加 ${report.inserted} · 更新 ${report.updated} · 変更なし ${report.unchanged} · 取り消し ${report.excluded} · 対象外 ${report.skipped}`,
  )
  const again = applyImport(applied.ledger, parsed, clock()).report
  const idempotent = again.inserted === 0 && again.updated === 0 && again.excluded === 0
  console.log(
    `  再取り込み: ${idempotent ? 'OK（追加・更新なし）' : `NG 追加 ${again.inserted} · 更新 ${again.updated} · 取り消し ${again.excluded}`}`,
  )
  return applied.ledger
}

function main() {
  if (!existsSync(STATEMENTS)) {
    mkdirSync(STATEMENTS, { recursive: true })
    console.log(
      `${relative(process.cwd(), STATEMENTS)}/ を作りました。CSV を置いてもう一度実行してください。`,
    )
    console.log('  <口座名>/       その口座の公式 CSV（例: ミドリカード/、ミドリ銀行@bank/）')
    return
  }
  let ledger = seedLedger()
  const folders = readdirSync(STATEMENTS)
    .filter((name) => statSync(join(STATEMENTS, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b, 'ja'))
  let files = 0
  for (const folder of folders) {
    const target = folderTarget(folder)
    for (const file of csvFiles(join(STATEMENTS, folder))) {
      files += 1
      ledger = ensureAccount(ledger, target.accountName, target.kind)
      ledger = importFile(ledger, file, 'institution-csv', target)
    }
  }
  if (files === 0) {
    console.log('CSV がありません。.private/statements/<口座名>/ に置いてください。')
    return
  }

  const live = ledger.transactions.filter((row) => row.deletedAt === null)
  const months = [...new Set(live.map((row) => row.date.slice(0, 7)))].sort()
  console.log('\n== 月ごとの集計（振替は収支に含めない） ==')
  for (const month of months) {
    const summary = summarizeMonth(ledger, month)
    console.log(
      `  ${month}  収入 ${formatYen(summary.incomeYen).padStart(12)}  支出 ${formatYen(summary.expenseYen).padStart(12)}  収支 ${formatYen(summary.balanceYen).padStart(12)}  振替 ${formatYen(summary.transferYen).padStart(12)}`,
    )
  }

  console.log('\n== 口座ごとの増減（開始残高なし） ==')
  const names = new Map(ledger.accounts.map((account) => [account.id, account]))
  for (const flow of projectAccountBalances(ledger)) {
    const account = names.get(flow.accountId)
    const touched = flow.incomeYen + flow.expenseYen + flow.transferInYen + flow.transferOutYen
    if (!account || touched === 0) continue
    console.log(`  ${account.name}（${account.kind}）  ${formatYen(flow.balanceYen)}`)
  }

  const open = unresolvedTransfers(ledger)
  const missingDestination = open.filter((row) => row.transferAccountId === null).length
  console.log(
    `\n相手口座が未設定の振替: ${open.length}件（振替先未設定 ${missingDestination} · 振替元未設定 ${open.length - missingDestination}）`,
  )
  const groups = groupUnresolvedTransfers(ledger)
  if (groups.length) {
    const sizes = groups.map((group) => group.transactions.length)
    const covered = (top: number) => sizes.slice(0, top).reduce((total, size) => total + size, 0)
    console.log(
      `  まとめて設定する種類: ${groups.length} · 上位5種類で ${covered(5)}件 · 上位10種類で ${covered(10)}件 · 1件だけの種類 ${sizes.filter((size) => size === 1).length}`,
    )
  }
  const uncategorized = live.filter((row) => row.type !== 'transfer' && !row.categoryId).length
  console.log(`カテゴリなしの収入・支出: ${uncategorized}件`)

  if (writeOut) {
    mkdirSync(OUT, { recursive: true })
    const path = join(OUT, 'moneyhound-backup.json')
    writeFileSync(path, exportBackup(ledger, new Date().toISOString()))
    console.log(`\nバックアップを書き出しました: ${relative(process.cwd(), path)}`)
    console.log(
      'アプリの 設定 → バックアップ →「ファイルを選ぶ」で読み込めます（その端末の台帳を置き換えます）。',
    )
  }
}

main()
