import { canonical } from '../domain/canonical'
import { assertLedger } from '../domain/ledger'
import { LedgerError } from '../domain/errors'
import { mergeLedgers, type Conflict } from '../domain/merge'
import type { Ledger } from '../domain/types'

export interface SyncPlan {
  ledger: Ledger
  conflicts: Conflict[]
  /** True when the merged ledger differs from the remote file and should be uploaded. */
  write: boolean
}

export function planSync(base: Ledger | null, local: Ledger, remote: Ledger | null): SyncPlan {
  if (!remote) return { ledger: local, conflicts: [], write: true }
  const merged = mergeLedgers(base, local, remote)
  return {
    ledger: merged.ledger,
    conflicts: merged.conflicts,
    write: canonical(merged.ledger) !== canonical(remote),
  }
}

export function parseRemoteLedger(body: string): Ledger {
  try {
    return assertLedger(JSON.parse(body))
  } catch (error) {
    if (error instanceof LedgerError) throw error
    throw new LedgerError('remote_unreadable')
  }
}
