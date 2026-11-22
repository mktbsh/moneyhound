import type { ImportDelivery, TransactionType } from '../types'

/**
 * One normalized row from any importer.
 * Adapters parse source files or extension payloads into this shape.
 * They do not touch the ledger.
 */
export interface NormalizedTransaction {
  date: string
  amountYen: number
  /**
   * Sign of the source amount before it was made absolute.
   * For a Money Forward transfer, -1 means money leaves `accountName`
   * and 1 means money arrives there. Income is 1 and expense is -1.
   */
  amountSign: -1 | 1
  type: TransactionType
  description: string
  memo: string
  /** 大項目. Null or 未分類 lets category rules decide. */
  categoryLarge: string | null
  /** 中項目. Stored as a child category when present. */
  categoryMiddle: string | null
  accountName: string | null
  externalId: string | null
  /** Fingerprint of the normalized identity fields. Occurrence suffix is added for duplicates. */
  contentHash: string
  /** False when the source marks the row as excluded (MF 計算対象=0). */
  include: boolean
}

export interface ImportRowError {
  line: number
  message: string
}

export interface ImportParseResult {
  adapterId: string
  fileName: string
  transactions: NormalizedTransaction[]
  errors: ImportRowError[]
  fileError?: string
}

export interface ImportInput {
  bytes: Uint8Array
  fileName: string
}

/**
 * Parser adapter. Phase 2 UI calls `parse`, then `applyImport`.
 * Delivery is file (official CSV/OFX the owner downloaded) or extension
 * (a future Chrome extension reading a page the owner already opened).
 * Adapters must not collect or replay credentials.
 */
export interface ImporterAdapter {
  id: string
  label: string
  delivery: ImportDelivery
  parse(input: ImportInput): ImportParseResult
}
