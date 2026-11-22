import type { Clock } from '../ledger'
import { categoryFromRules } from '../rules'
import { fold } from '../text'
import {
  SEED_TIME,
  type Account,
  type AccountKind,
  type Category,
  type CategoryKind,
  type CategoryOrigin,
  type ImportSource,
  type Ledger,
  type Transaction,
} from '../types'
import { planTransferRows } from './pairTransfers'
import type { ImportParseResult, NormalizedTransaction } from './types'

export interface ImportReport {
  inserted: number
  updated: number
  unchanged: number
  excluded: number
  skipped: number
}

const EMPTY_REPORT: ImportReport = {
  inserted: 0,
  updated: 0,
  unchanged: 0,
  excluded: 0,
  skipped: 0,
}

export function guessAccountKind(name: string): AccountKind {
  if (/カード|card/i.test(name)) return 'card'
  if (/証券/.test(name)) return 'securities'
  if (/現金/.test(name)) return 'cash'
  if (/paypay|suica|waon|edy|nanaco|電子マネー/i.test(name)) return 'emoney'
  return 'bank'
}

function dedupe(rows: readonly NormalizedTransaction[]): NormalizedTransaction[] {
  const byKey = new Map<string, NormalizedTransaction>()
  const counts = new Map<string, number>()
  for (const row of rows) {
    let hash = row.contentHash
    if (!row.externalId) {
      const seen = counts.get(hash) ?? 0
      counts.set(hash, seen + 1)
      if (seen > 0) hash = `${hash}#${seen + 1}`
    }
    const key = row.externalId ? `id:${row.externalId}` : `hash:${hash}`
    byKey.set(key, { ...row, contentHash: hash })
  }
  return [...byKey.values()]
}

function findAccount(ledger: Ledger, name: string): Account | undefined {
  const folded = fold(name)
  return ledger.accounts.find(
    (account) => account.deletedAt === null && fold(account.name) === folded,
  )
}

function findCategory(
  ledger: Ledger,
  name: string,
  kind: CategoryKind,
  parentId: string | null,
): Category | undefined {
  const folded = fold(name)
  return ledger.categories.find(
    (category) =>
      category.deletedAt === null &&
      category.kind === kind &&
      category.parentId === parentId &&
      fold(category.name) === folded,
  )
}

function ensureAccount(
  ledger: Ledger,
  name: string | null,
  sourceId: string,
  clock: Clock,
): {
  ledger: Ledger
  accountId: string
} {
  const resolved = name?.trim() || '未設定'
  const existing = findAccount(ledger, resolved)
  if (existing) return { ledger, accountId: existing.id }
  const account: Account = {
    id: clock.id(),
    name: resolved,
    kind: guessAccountKind(resolved),
    currency: 'JPY',
    sourceId,
    externalAccountId: null,
    archived: false,
    openingBalanceYen: null,
    createdAt: clock.now,
    updatedAt: clock.now,
    revision: 1,
    deletedAt: null,
  }
  return { ledger: { ...ledger, accounts: [...ledger.accounts, account] }, accountId: account.id }
}

function ensureCategory(
  ledger: Ledger,
  name: string,
  kind: CategoryKind,
  parentId: string | null,
  clock: Clock,
): { ledger: Ledger; categoryId: string } {
  const existing = findCategory(ledger, name, kind, parentId)
  if (existing) return { ledger, categoryId: existing.id }
  const category: Category = {
    id: clock.id(),
    name,
    kind,
    parentId,
    sortOrder: ledger.categories.length,
    archived: false,
    createdAt: clock.now,
    updatedAt: clock.now,
    revision: 1,
    deletedAt: null,
  }
  return {
    ledger: { ...ledger, categories: [...ledger.categories, category] },
    categoryId: category.id,
  }
}

function ensureSource(ledger: Ledger, parsed: ImportParseResult): Ledger {
  const id = `src_${parsed.adapterId}`
  if (ledger.importSources.some((source) => source.id === id && source.deletedAt === null)) {
    return ledger
  }
  const source: ImportSource = {
    id,
    adapterId: parsed.adapterId,
    name: parsed.adapterId === 'mf-csv' ? 'マネーフォワードME' : parsed.adapterId,
    delivery: 'file',
    accountId: null,
    institution: parsed.adapterId === 'mf-csv' ? 'マネーフォワードME' : null,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    revision: 1,
    deletedAt: null,
  }
  return { ...ledger, importSources: [...ledger.importSources, source] }
}

function kindOf(type: NormalizedTransaction['type']): CategoryKind {
  return type === 'income' ? 'income' : 'expense'
}

/** An outflow whose description is exactly another live account name. */
function accountIdByName(ledger: Ledger, name: string, sourceAccountId: string): string | null {
  const folded = fold(name)
  if (!folded) return null
  const account = ledger.accounts.find(
    (item) => item.deletedAt === null && fold(item.name) === folded && item.id !== sourceAccountId,
  )
  return account?.id ?? null
}

function resolveCategory(
  ledger: Ledger,
  row: NormalizedTransaction,
  accountId: string,
  adapterId: string,
  clock: Clock,
): { ledger: Ledger; categoryId: string | null; origin: CategoryOrigin | null } {
  if (row.type === 'transfer') return { ledger, categoryId: null, origin: null }
  let current = ledger
  const kind = kindOf(row.type)
  let categoryId: string | null = null
  if (row.categoryLarge) {
    const large = ensureCategory(current, row.categoryLarge, kind, null, clock)
    current = large.ledger
    categoryId = large.categoryId
  }
  if (row.categoryMiddle) {
    const middle = ensureCategory(current, row.categoryMiddle, kind, categoryId, clock)
    current = middle.ledger
    categoryId = middle.categoryId
  }
  if (!categoryId) {
    const ruled = categoryFromRules(current.categoryRules, {
      description: row.description,
      sourceId: adapterId,
      accountId,
    })
    if (ruled) return { ledger: current, categoryId: ruled, origin: 'rule' }
  }
  return {
    ledger: current,
    categoryId,
    origin: categoryId ? 'import' : null,
  }
}

function findExisting(
  ledger: Ledger,
  sourceId: string,
  row: NormalizedTransaction,
): Transaction | undefined {
  return ledger.transactions.find((transaction) => {
    if (transaction.source.sourceId !== sourceId) return false
    if (row.externalId) return transaction.source.externalId === row.externalId
    // A hash-only row must not adopt a row that has its own external id.
    return (
      transaction.source.externalId === null && transaction.source.contentHash === row.contentHash
    )
  })
}

function sameFields(
  transaction: Transaction,
  next: Omit<Transaction, 'id' | 'createdAt' | 'revision'>,
): boolean {
  return (
    transaction.updatedAt === next.updatedAt &&
    transaction.deletedAt === next.deletedAt &&
    transaction.date === next.date &&
    transaction.amountYen === next.amountYen &&
    transaction.type === next.type &&
    transaction.categoryId === next.categoryId &&
    transaction.categoryOrigin === next.categoryOrigin &&
    transaction.accountId === next.accountId &&
    transaction.transferAccountId === next.transferAccountId &&
    transaction.description === next.description &&
    transaction.memo === next.memo &&
    transaction.source.sourceId === next.source.sourceId &&
    transaction.source.externalId === next.source.externalId &&
    transaction.source.contentHash === next.source.contentHash
  )
}

export function applyImport(
  ledger: Ledger,
  parsed: ImportParseResult,
  clock: Clock,
): { ledger: Ledger; report: ImportReport } {
  if (parsed.fileError) return { ledger, report: { ...EMPTY_REPORT } }
  let current = ensureSource(ledger, parsed)
  const sourceId = `src_${parsed.adapterId}`
  const report: ImportReport = { ...EMPTY_REPORT }
  for (const planned of planTransferRows(dedupe(parsed.transactions))) {
    const row = planned.row
    if (planned.counterpart) {
      const existing = findExisting(current, sourceId, row)
      if (!existing || existing.deletedAt) {
        report.skipped += 1
        continue
      }
      current = {
        ...current,
        transactions: current.transactions.map((transaction) =>
          transaction.id === existing.id
            ? {
                ...transaction,
                deletedAt: clock.now,
                updatedAt: clock.now,
                revision: transaction.revision + 1,
              }
            : transaction,
        ),
      }
      report.excluded += 1
      continue
    }
    const account = ensureAccount(current, row.accountName, sourceId, clock)
    current = account.ledger
    const category = resolveCategory(current, row, account.accountId, parsed.adapterId, clock)
    current = category.ledger
    const existing = findExisting(current, sourceId, row)
    if (!row.include) {
      if (!existing || existing.deletedAt) {
        report.skipped += 1
        continue
      }
      current = {
        ...current,
        transactions: current.transactions.map((transaction) =>
          transaction.id === existing.id
            ? {
                ...transaction,
                deletedAt: clock.now,
                updatedAt: clock.now,
                revision: transaction.revision + 1,
              }
            : transaction,
        ),
      }
      report.excluded += 1
      continue
    }
    const categoryId =
      existing?.categoryOrigin === 'user' ? existing.categoryId : category.categoryId
    const categoryOrigin = existing?.categoryOrigin === 'user' ? 'user' : category.origin
    let transferAccountId: string | null = null
    if (row.type === 'transfer') {
      if (planned.destinationAccountName) {
        const destination = ensureAccount(current, planned.destinationAccountName, sourceId, clock)
        current = destination.ledger
        if (destination.accountId !== account.accountId) transferAccountId = destination.accountId
      } else if (existing?.transferAccountId) {
        transferAccountId = existing.transferAccountId
      } else if (row.amountSign < 0) {
        transferAccountId = accountIdByName(current, row.description, account.accountId)
      }
    }
    const next = {
      updatedAt: existing ? existing.updatedAt : clock.now,
      deletedAt: null,
      date: row.date,
      amountYen: row.amountYen,
      type: row.type,
      categoryId,
      categoryOrigin,
      accountId: account.accountId,
      transferAccountId,
      description: row.description,
      memo: row.memo,
      source: {
        sourceId,
        externalId: row.externalId,
        contentHash: row.contentHash,
        importedAt: existing?.source.importedAt ?? clock.now,
      },
    }
    if (existing && sameFields(existing, next)) {
      report.unchanged += 1
      continue
    }
    if (existing) {
      current = {
        ...current,
        transactions: current.transactions.map((transaction) =>
          transaction.id === existing.id
            ? {
                ...transaction,
                ...next,
                updatedAt: clock.now,
                revision: transaction.revision + 1,
              }
            : transaction,
        ),
      }
      report.updated += 1
      continue
    }
    current = {
      ...current,
      transactions: [
        ...current.transactions,
        {
          id: clock.id(),
          createdAt: clock.now,
          revision: 1,
          ...next,
          updatedAt: clock.now,
        },
      ],
    }
    report.inserted += 1
  }
  return { ledger: current, report }
}
