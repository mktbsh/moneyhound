import { assertLedger } from './ledger'
import { LedgerError } from './errors'
import { APP_ID, SCHEMA_VERSION, type Ledger } from './types'

export interface BackupDocument {
  app: typeof APP_ID
  schemaVersion: typeof SCHEMA_VERSION
  exportedAt: string
  ledger: Ledger
}

export function exportBackup(ledger: Ledger, exportedAt: string): string {
  const document: BackupDocument = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    ledger: assertLedger(ledger),
  }
  return JSON.stringify(document, null, 2)
}

export function importBackup(text: string): Ledger {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new LedgerError('invalid_backup')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new LedgerError('invalid_backup')
  const document = parsed as Record<string, unknown>
  if (document.app !== APP_ID) throw new LedgerError('invalid_backup')
  if (document.schemaVersion !== SCHEMA_VERSION) throw new LedgerError('unsupported_schema')
  const ledger = assertLedger(document.ledger)
  return { ...ledger, seeded: true }
}
