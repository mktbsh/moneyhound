export const SCHEMA_VERSION = 2 as const
export const APP_ID = 'moneyhound' as const
export const MANUAL_SOURCE_ID = 'manual' as const

/** Fixed clock for built-in seed rows so two devices seed identical records. */
export const SEED_TIME = '1970-01-01T00:00:00.000Z'

export type SchemaVersion = typeof SCHEMA_VERSION
export type IsoDate = string
export type IsoDateTime = string
export type TransactionType = 'income' | 'expense' | 'transfer'
export type CategoryKind = 'income' | 'expense'
export type AccountKind = 'cash' | 'bank' | 'card' | 'emoney' | 'securities' | 'other'
export type CategoryOrigin = 'user' | 'import' | 'rule'
export type ImportDelivery = 'file' | 'extension'
export type RuleOperator = 'contains' | 'regex'

export interface Entity {
  id: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  revision: number
  deletedAt: IsoDateTime | null
}

export interface Account extends Entity {
  name: string
  kind: AccountKind
  currency: 'JPY'
  /** Import source this account is fed by, when any. */
  sourceId: string | null
  /** Institution account id, when a statement provides one. */
  externalAccountId: string | null
  archived: boolean
  /** Used by later balance projection. Null until the owner sets one. */
  openingBalanceYen: number | null
}

export interface Category extends Entity {
  name: string
  kind: CategoryKind
  /** Subcategory parent. A statement's middle category maps here. */
  parentId: string | null
  sortOrder: number
  archived: boolean
}

/**
 * Provenance for idempotent re-import.
 * Match on (sourceId, externalId) when the source has a stable id,
 * otherwise (sourceId, contentHash).
 */
export interface TransactionSource {
  sourceId: string
  externalId: string | null
  contentHash: string
  importedAt: IsoDateTime | null
}

export interface Transaction extends Entity {
  date: IsoDate
  /** Absolute yen. The type carries the direction. */
  amountYen: number
  type: TransactionType
  categoryId: string | null
  /**
   * `user` means the owner chose the category and re-import must not replace it.
   * Transfers have no category.
   */
  categoryOrigin: CategoryOrigin | null
  /**
   * Account the money leaves (expense) or enters (income).
   * For a transfer, the source. Null when an imported inflow has no known source.
   * Income and expense always set this.
   */
  accountId: string | null
  /**
   * Destination account for a transfer. Null when an imported outflow has no
   * destination. A transfer must set at least one of `accountId` and this field,
   * and the two ids must differ when both are set.
   */
  transferAccountId: string | null
  /** Payee or statement description. Category rules read this. */
  description: string
  memo: string
  source: TransactionSource
}

export interface ImportSource extends Entity {
  /** Adapter id, for example `institution-csv`. */
  adapterId: string
  name: string
  delivery: ImportDelivery
  /** Optional default account for this source. */
  accountId: string | null
  institution: string | null
}

export interface CategoryRule extends Entity {
  enabled: boolean
  /** Lower runs first. */
  priority: number
  operator: RuleOperator
  pattern: string
  /** When set, the rule only applies to rows from this source id. */
  sourceId: string | null
  /** When set, the rule only applies to rows on this account. */
  accountId: string | null
  categoryId: string
}

/** Phase 3. Present so backups and sync do not need a schema break. */
export interface Budget extends Entity {
  categoryId: string
  /** Null means the same amount every month. */
  yearMonth: string | null
  amountYen: number
}

/** Phase 4. Point-in-time balance for an account. */
export interface AssetSnapshot extends Entity {
  accountId: string
  date: IsoDate
  balanceYen: number
  note: string
}

export interface Ledger {
  schemaVersion: SchemaVersion
  seeded: boolean
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  importSources: ImportSource[]
  categoryRules: CategoryRule[]
  budgets: Budget[]
  assetSnapshots: AssetSnapshot[]
}

export function manualSource(): TransactionSource {
  return {
    sourceId: MANUAL_SOURCE_ID,
    externalId: null,
    contentHash: '',
    importedAt: null,
  }
}
