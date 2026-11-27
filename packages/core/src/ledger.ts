import { isIsoDate } from './dates'
import { emptyLedger, seedLedger } from './defaults'
import { LedgerError } from './errors'
import { isYenAmount } from './money'
import { fold } from './text'
import {
  SCHEMA_VERSION,
  manualSource,
  type Account,
  type AccountKind,
  type AssetSnapshot,
  type Budget,
  type Category,
  type CategoryKind,
  type CategoryOrigin,
  type CategoryRule,
  type Entity,
  type ImportDelivery,
  type ImportSource,
  type Ledger,
  type RuleOperator,
  type Transaction,
  type TransactionSource,
  type TransactionType,
} from './types'

const ACCOUNT_KINDS: readonly AccountKind[] = [
  'cash',
  'bank',
  'card',
  'emoney',
  'securities',
  'other',
]
const CATEGORY_KINDS: readonly CategoryKind[] = ['income', 'expense']
const TX_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer']
const ORIGINS: readonly CategoryOrigin[] = ['user', 'import', 'rule']
const DELIVERIES: readonly ImportDelivery[] = ['file', 'extension']
const OPERATORS: readonly RuleOperator[] = ['contains', 'regex']
const NAME_MAX = 40
const TEXT_MAX = 500
const PATTERN_MAX = 200

export interface Clock {
  now: string
  id: () => string
}

export interface TransactionInput {
  date: string
  amountYen: number
  type: TransactionType
  categoryId: string | null
  /** Source. Null only for a transfer whose source is unknown. */
  accountId: string | null
  /** Destination. Null only for a transfer whose destination is unknown. */
  transferAccountId: string | null
  description: string
  memo: string
}

export interface CategoryInput {
  name: string
  kind: CategoryKind
  parentId?: string | null
}

export interface AccountInput {
  name: string
  kind: AccountKind
}

export interface RuleInput {
  pattern: string
  operator?: RuleOperator
  categoryId: string
  sourceId?: string | null
  accountId?: string | null
  priority?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entityFrom(raw: Record<string, unknown>): Entity {
  const id = requiredString(raw.id, 'id')
  const revision = raw.revision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    throw new LedgerError('invalid_ledger')
  }
  return {
    id,
    createdAt: requiredString(raw.createdAt, 'createdAt'),
    updatedAt: requiredString(raw.updatedAt, 'updatedAt'),
    revision,
    deletedAt: raw.deletedAt === null ? null : requiredString(raw.deletedAt, 'deletedAt'),
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new LedgerError(`invalid_${field}`)
  return value
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0) throw new LedgerError('invalid_ledger')
  return value
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new LedgerError('invalid_ledger')
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new LedgerError('invalid_ledger')
  return value as T
}

function unique<T extends Entity>(records: T[]): T[] {
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id)) throw new LedgerError('duplicate_id')
    seen.add(record.id)
  }
  return records
}

function readArray(value: unknown, required: boolean): unknown[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value)) throw new LedgerError('invalid_ledger')
  return value
}

function parseAccount(value: unknown): Account {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  const opening = value.openingBalanceYen
  if (opening !== null && (typeof opening !== 'number' || !Number.isInteger(opening))) {
    throw new LedgerError('invalid_ledger')
  }
  return {
    ...entityFrom(value),
    name: requiredString(value.name, 'name'),
    kind: oneOf(value.kind, ACCOUNT_KINDS),
    currency: 'JPY',
    sourceId: optionalString(value.sourceId),
    externalAccountId: optionalString(value.externalAccountId),
    archived: requiredBoolean(value.archived),
    openingBalanceYen: opening,
  }
}

function parseCategory(value: unknown): Category {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  const sortOrder = value.sortOrder
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder))
    throw new LedgerError('invalid_ledger')
  return {
    ...entityFrom(value),
    name: requiredString(value.name, 'name'),
    kind: oneOf(value.kind, CATEGORY_KINDS),
    parentId: optionalString(value.parentId),
    sortOrder,
    archived: requiredBoolean(value.archived),
  }
}

function parseSource(value: unknown): TransactionSource {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  return {
    sourceId: requiredString(value.sourceId, 'sourceId'),
    externalId: optionalString(value.externalId),
    contentHash: typeof value.contentHash === 'string' ? value.contentHash : '',
    importedAt: optionalString(value.importedAt),
  }
}

function parseTransaction(value: unknown): Transaction {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  const amountYen = value.amountYen
  if (typeof amountYen !== 'number' || !isYenAmount(amountYen))
    throw new LedgerError('invalid_amount')
  const origin = value.categoryOrigin
  const type = oneOf(value.type, TX_TYPES)
  const accountId = optionalString(value.accountId)
  const transferAccountId = optionalString(value.transferAccountId)
  if (type === 'transfer') checkTransferSides(type, accountId, transferAccountId)
  else if (!accountId || transferAccountId) throw new LedgerError('invalid_ledger')
  return {
    ...entityFrom(value),
    date: requiredString(value.date, 'date'),
    amountYen,
    type,
    categoryId: optionalString(value.categoryId),
    categoryOrigin: origin === null || origin === undefined ? null : oneOf(origin, ORIGINS),
    accountId,
    transferAccountId,
    description: typeof value.description === 'string' ? value.description : '',
    memo: typeof value.memo === 'string' ? value.memo : '',
    source: parseSource(value.source),
  }
}

function checkTransferSides(
  type: TransactionType,
  accountId: string | null,
  transferAccountId: string | null,
): void {
  if (type !== 'transfer') return
  if (!accountId && !transferAccountId) throw new LedgerError('invalid_transfer')
  if (accountId && accountId === transferAccountId) throw new LedgerError('invalid_transfer')
}

function parseImportSource(value: unknown): ImportSource {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  return {
    ...entityFrom(value),
    adapterId: requiredString(value.adapterId, 'adapterId'),
    name: requiredString(value.name, 'name'),
    delivery: oneOf(value.delivery, DELIVERIES),
    accountId: optionalString(value.accountId),
    institution: optionalString(value.institution),
  }
}

function parseRule(value: unknown): CategoryRule {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  const priority = value.priority
  if (typeof priority !== 'number' || !Number.isInteger(priority))
    throw new LedgerError('invalid_ledger')
  return {
    ...entityFrom(value),
    enabled: requiredBoolean(value.enabled),
    priority,
    operator: oneOf(value.operator, OPERATORS),
    pattern: requiredString(value.pattern, 'pattern'),
    sourceId: optionalString(value.sourceId),
    accountId: optionalString(value.accountId),
    categoryId: requiredString(value.categoryId, 'categoryId'),
  }
}

function parseBudget(value: unknown): Budget {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  const amountYen = value.amountYen
  if (typeof amountYen !== 'number' || !isYenAmount(amountYen))
    throw new LedgerError('invalid_ledger')
  return {
    ...entityFrom(value),
    categoryId: requiredString(value.categoryId, 'categoryId'),
    yearMonth: optionalString(value.yearMonth),
    amountYen,
  }
}

function parseSnapshot(value: unknown): AssetSnapshot {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  const balanceYen = value.balanceYen
  if (typeof balanceYen !== 'number' || !Number.isInteger(balanceYen))
    throw new LedgerError('invalid_ledger')
  return {
    ...entityFrom(value),
    accountId: requiredString(value.accountId, 'accountId'),
    date: requiredString(value.date, 'date'),
    balanceYen,
    note: typeof value.note === 'string' ? value.note : '',
  }
}

export function assertLedger(value: unknown): Ledger {
  if (!isRecord(value)) throw new LedgerError('invalid_ledger')
  if (value.schemaVersion !== SCHEMA_VERSION) throw new LedgerError('unsupported_schema')
  const ledger: Ledger = {
    schemaVersion: SCHEMA_VERSION,
    seeded: value.seeded === true,
    accounts: unique(readArray(value.accounts, true).map(parseAccount)),
    categories: unique(readArray(value.categories, true).map(parseCategory)),
    transactions: unique(readArray(value.transactions, true).map(parseTransaction)),
    importSources: unique(readArray(value.importSources, false).map(parseImportSource)),
    categoryRules: unique(readArray(value.categoryRules, false).map(parseRule)),
    budgets: unique(readArray(value.budgets, false).map(parseBudget)),
    assetSnapshots: unique(readArray(value.assetSnapshots, false).map(parseSnapshot)),
  }
  for (const transaction of ledger.transactions) {
    if (!isIsoDate(transaction.date)) throw new LedgerError('invalid_date')
  }
  return ledger
}

export function loadStoredLedger(value: unknown): Ledger {
  const ledger = assertLedger(value)
  if (!ledger.seeded && ledger.categories.length === 0 && ledger.transactions.length === 0) {
    return seedLedger()
  }
  return { ...ledger, seeded: true }
}

function touch<T extends Entity>(entity: T, now: string, patch: Partial<T>): T {
  return { ...entity, ...patch, updatedAt: now, revision: entity.revision + 1 }
}

function active<T extends Entity & { archived?: boolean }>(records: readonly T[]): T[] {
  return records.filter((record) => record.deletedAt === null && record.archived !== true)
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > NAME_MAX) throw new LedgerError('invalid_name')
  return trimmed
}

function usableAccount(ledger: Ledger, id: string): Account {
  const account = ledger.accounts.find((item) => item.id === id)
  if (!account || account.deletedAt || account.archived) throw new LedgerError('invalid_account')
  return account
}

function usableCategory(ledger: Ledger, id: string, kind: CategoryKind): Category {
  const category = ledger.categories.find((item) => item.id === id)
  if (!category || category.deletedAt || category.archived || category.kind !== kind) {
    throw new LedgerError('invalid_category')
  }
  return category
}

function cleanText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length > TEXT_MAX) throw new LedgerError('invalid_text')
  return trimmed
}

function validateTransaction(ledger: Ledger, input: TransactionInput): TransactionInput {
  if (!isIsoDate(input.date)) throw new LedgerError('invalid_date')
  if (!isYenAmount(input.amountYen)) throw new LedgerError('invalid_amount')
  if (!TX_TYPES.includes(input.type)) throw new LedgerError('invalid_type')
  if (input.type === 'transfer') {
    checkTransferSides(input.type, input.accountId, input.transferAccountId)
    if (input.accountId) usableAccount(ledger, input.accountId)
    if (input.transferAccountId) usableAccount(ledger, input.transferAccountId)
    return {
      ...input,
      categoryId: null,
      description: cleanText(input.description),
      memo: cleanText(input.memo),
    }
  }
  if (!input.accountId) throw new LedgerError('invalid_account')
  usableAccount(ledger, input.accountId)
  if (!input.categoryId) throw new LedgerError('invalid_category')
  usableCategory(ledger, input.categoryId, input.type)
  return {
    ...input,
    transferAccountId: null,
    description: cleanText(input.description),
    memo: cleanText(input.memo),
  }
}

export function addTransaction(ledger: Ledger, input: TransactionInput, clock: Clock): Ledger {
  const valid = validateTransaction(ledger, input)
  const transaction: Transaction = {
    id: clock.id(),
    createdAt: clock.now,
    updatedAt: clock.now,
    revision: 1,
    deletedAt: null,
    date: valid.date,
    amountYen: valid.amountYen,
    type: valid.type,
    categoryId: valid.categoryId,
    categoryOrigin: valid.type === 'transfer' ? null : 'user',
    accountId: valid.accountId,
    transferAccountId: valid.transferAccountId,
    description: valid.description,
    memo: valid.memo,
    source: manualSource(),
  }
  return { ...ledger, transactions: [...ledger.transactions, transaction] }
}

export function updateTransaction(
  ledger: Ledger,
  id: string,
  input: TransactionInput,
  clock: Clock,
): Ledger {
  const existing = ledger.transactions.find((item) => item.id === id && item.deletedAt === null)
  if (!existing) throw new LedgerError('not_found')
  const valid = validateTransaction(ledger, input)
  const categoryOrigin =
    valid.type === 'transfer'
      ? null
      : valid.categoryId !== existing.categoryId
        ? 'user'
        : (existing.categoryOrigin ?? 'user')
  return {
    ...ledger,
    transactions: ledger.transactions.map((item) =>
      item.id === id
        ? touch(item, clock.now, {
            date: valid.date,
            amountYen: valid.amountYen,
            type: valid.type,
            categoryId: valid.categoryId,
            categoryOrigin,
            accountId: valid.accountId,
            transferAccountId: valid.transferAccountId,
            description: valid.description,
            memo: valid.memo,
          })
        : item,
    ),
  }
}

export function deleteTransaction(ledger: Ledger, id: string, clock: Clock): Ledger {
  const existing = ledger.transactions.find((item) => item.id === id && item.deletedAt === null)
  if (!existing) throw new LedgerError('not_found')
  return {
    ...ledger,
    transactions: ledger.transactions.map((item) =>
      item.id === id ? touch(item, clock.now, { deletedAt: clock.now }) : item,
    ),
  }
}

/** Live transfers missing a source or a destination, newest first. */
export function unresolvedTransfers(ledger: Ledger): Transaction[] {
  return visibleTransactions(ledger).filter(
    (transaction) =>
      transaction.type === 'transfer' &&
      (transaction.accountId === null || transaction.transferAccountId === null),
  )
}

/**
 * Set the missing side of a transfer. Only the two account ids change, so the
 * import provenance stays and a later re-import keeps the chosen account.
 */
export function setTransferAccounts(
  ledger: Ledger,
  id: string,
  sides: { accountId: string | null; transferAccountId: string | null },
  clock: Clock,
): Ledger {
  const existing = ledger.transactions.find((item) => item.id === id && item.deletedAt === null)
  if (!existing) throw new LedgerError('not_found')
  if (existing.type !== 'transfer') throw new LedgerError('invalid_type')
  checkTransferSides('transfer', sides.accountId, sides.transferAccountId)
  if (sides.accountId && sides.accountId !== existing.accountId) {
    usableAccount(ledger, sides.accountId)
  }
  if (sides.transferAccountId && sides.transferAccountId !== existing.transferAccountId) {
    usableAccount(ledger, sides.transferAccountId)
  }
  if (
    sides.accountId === existing.accountId &&
    sides.transferAccountId === existing.transferAccountId
  ) {
    return ledger
  }
  return {
    ...ledger,
    transactions: ledger.transactions.map((item) =>
      item.id === id
        ? touch(item, clock.now, {
            accountId: sides.accountId,
            transferAccountId: sides.transferAccountId,
          })
        : item,
    ),
  }
}

export interface UnresolvedTransferGroup {
  /** Stable while the rows stay unresolved: side, known account, folded description. */
  key: string
  missing: 'source' | 'destination'
  /** The side that is already set. */
  knownAccountId: string
  description: string
  transactions: Transaction[]
  totalYen: number
  firstDate: string
  lastDate: string
}

/**
 * One-sided transfers grouped by what is missing, the account that is set,
 * and the description. A monthly card repayment lands in one group.
 * Larger groups first.
 */
export function groupUnresolvedTransfers(ledger: Ledger): UnresolvedTransferGroup[] {
  const groups = new Map<string, UnresolvedTransferGroup>()
  for (const transaction of unresolvedTransfers(ledger)) {
    const missing = transaction.accountId === null ? 'source' : 'destination'
    const knownAccountId = (transaction.accountId ?? transaction.transferAccountId) as string
    const description = transaction.description.trim()
    const key = `${missing}\u001f${knownAccountId}\u001f${fold(description)}`
    const group = groups.get(key)
    if (group) {
      group.transactions.push(transaction)
      group.totalYen += transaction.amountYen
      if (transaction.date < group.firstDate) group.firstDate = transaction.date
      if (transaction.date > group.lastDate) group.lastDate = transaction.date
    } else {
      groups.set(key, {
        key,
        missing,
        knownAccountId,
        description,
        transactions: [transaction],
        totalYen: transaction.amountYen,
        firstDate: transaction.date,
        lastDate: transaction.date,
      })
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.transactions.length - a.transactions.length ||
      b.lastDate.localeCompare(a.lastDate) ||
      a.key.localeCompare(b.key),
  )
}

/**
 * Fill the missing side of several one-sided transfers with one account.
 * Rows that already have both sides are left alone. Throws without changing
 * anything when the account is unusable or equals a row's other side.
 */
export function fillTransferSides(
  ledger: Ledger,
  ids: readonly string[],
  accountId: string,
  clock: Clock,
): Ledger {
  usableAccount(ledger, accountId)
  let next = ledger
  for (const id of ids) {
    const transaction = next.transactions.find((item) => item.id === id && item.deletedAt === null)
    if (!transaction) throw new LedgerError('not_found')
    if (transaction.type !== 'transfer') throw new LedgerError('invalid_type')
    if (transaction.accountId === null) {
      next = setTransferAccounts(
        next,
        id,
        { accountId, transferAccountId: transaction.transferAccountId },
        clock,
      )
    } else if (transaction.transferAccountId === null) {
      next = setTransferAccounts(
        next,
        id,
        { accountId: transaction.accountId, transferAccountId: accountId },
        clock,
      )
    }
  }
  return next
}

/** Latest YYYY-MM that has a live transaction, or null for an empty ledger. */
export function latestYearMonth(ledger: Ledger): string | null {
  let latest: string | null = null
  for (const transaction of ledger.transactions) {
    if (transaction.deletedAt !== null) continue
    const month = transaction.date.slice(0, 7)
    if (latest === null || month > latest) latest = month
  }
  return latest
}

/** True when the month has at least one live transaction. */
export function hasTransactionsIn(ledger: Ledger, yearMonth: string): boolean {
  return ledger.transactions.some(
    (transaction) => transaction.deletedAt === null && transaction.date.startsWith(`${yearMonth}-`),
  )
}

export function addCategory(ledger: Ledger, input: CategoryInput, clock: Clock): Ledger {
  const name = requireName(input.name)
  if (!CATEGORY_KINDS.includes(input.kind)) throw new LedgerError('invalid_category')
  if (
    active(ledger.categories).some(
      (category) => category.kind === input.kind && fold(category.name) === fold(name),
    )
  ) {
    throw new LedgerError('duplicate_name')
  }
  const parentId = input.parentId ?? null
  if (parentId) usableCategory(ledger, parentId, input.kind)
  const sortOrder = ledger.categories.filter((category) => category.kind === input.kind).length
  const category: Category = {
    id: clock.id(),
    name,
    kind: input.kind,
    parentId,
    sortOrder,
    archived: false,
    createdAt: clock.now,
    updatedAt: clock.now,
    revision: 1,
    deletedAt: null,
  }
  return { ...ledger, categories: [...ledger.categories, category] }
}

export function removeCategory(ledger: Ledger, id: string, clock: Clock): Ledger {
  const category = ledger.categories.find((item) => item.id === id && item.deletedAt === null)
  if (!category) throw new LedgerError('not_found')
  const used = ledger.transactions.some(
    (transaction) => transaction.deletedAt === null && transaction.categoryId === id,
  )
  return {
    ...ledger,
    categories: ledger.categories.map((item) =>
      item.id === id
        ? touch(item, clock.now, used ? { archived: true } : { deletedAt: clock.now })
        : item,
    ),
  }
}

export function addAccount(ledger: Ledger, input: AccountInput, clock: Clock): Ledger {
  const name = requireName(input.name)
  if (!ACCOUNT_KINDS.includes(input.kind)) throw new LedgerError('invalid_account')
  if (active(ledger.accounts).some((account) => fold(account.name) === fold(name))) {
    throw new LedgerError('duplicate_name')
  }
  const account: Account = {
    id: clock.id(),
    name,
    kind: input.kind,
    currency: 'JPY',
    sourceId: null,
    externalAccountId: null,
    archived: false,
    openingBalanceYen: null,
    createdAt: clock.now,
    updatedAt: clock.now,
    revision: 1,
    deletedAt: null,
  }
  return { ...ledger, accounts: [...ledger.accounts, account] }
}

export function removeAccount(ledger: Ledger, id: string, clock: Clock): Ledger {
  const account = ledger.accounts.find((item) => item.id === id && item.deletedAt === null)
  if (!account) throw new LedgerError('not_found')
  const used = ledger.transactions.some(
    (transaction) =>
      transaction.deletedAt === null &&
      (transaction.accountId === id || transaction.transferAccountId === id),
  )
  return {
    ...ledger,
    accounts: ledger.accounts.map((item) =>
      item.id === id
        ? touch(item, clock.now, used ? { archived: true } : { deletedAt: clock.now })
        : item,
    ),
  }
}

export function addCategoryRule(ledger: Ledger, input: RuleInput, clock: Clock): Ledger {
  const pattern = input.pattern.trim()
  if (!pattern || pattern.length > PATTERN_MAX) throw new LedgerError('invalid_pattern')
  const operator = input.operator ?? 'contains'
  if (!OPERATORS.includes(operator)) throw new LedgerError('invalid_pattern')
  if (operator === 'regex') {
    try {
      new RegExp(pattern)
    } catch {
      throw new LedgerError('invalid_pattern')
    }
  }
  const category = ledger.categories.find((item) => item.id === input.categoryId)
  if (!category || category.deletedAt || category.archived)
    throw new LedgerError('invalid_category')
  const priorities = ledger.categoryRules.map((rule) => rule.priority)
  const rule: CategoryRule = {
    id: clock.id(),
    enabled: true,
    priority: input.priority ?? (priorities.length ? Math.max(...priorities) + 1 : 0),
    operator,
    pattern,
    sourceId: input.sourceId ?? null,
    accountId: input.accountId ?? null,
    categoryId: input.categoryId,
    createdAt: clock.now,
    updatedAt: clock.now,
    revision: 1,
    deletedAt: null,
  }
  return { ...ledger, categoryRules: [...ledger.categoryRules, rule] }
}

export function removeCategoryRule(ledger: Ledger, id: string, clock: Clock): Ledger {
  const rule = ledger.categoryRules.find((item) => item.id === id && item.deletedAt === null)
  if (!rule) throw new LedgerError('not_found')
  return {
    ...ledger,
    categoryRules: ledger.categoryRules.map((item) =>
      item.id === id ? touch(item, clock.now, { deletedAt: clock.now, enabled: false }) : item,
    ),
  }
}

export function activeAccounts(ledger: Ledger): Account[] {
  return active(ledger.accounts)
}

export function activeCategories(ledger: Ledger, kind?: CategoryKind): Category[] {
  return active(ledger.categories)
    .filter((category) => (kind ? category.kind === kind : true))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja'))
}

export function visibleTransactions(ledger: Ledger): Transaction[] {
  return ledger.transactions
    .filter((transaction) => transaction.deletedAt === null)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

export { emptyLedger, seedLedger }
