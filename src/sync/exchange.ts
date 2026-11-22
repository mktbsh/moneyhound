import { LedgerError } from '../domain/errors'
import type { Ledger } from '../domain/types'
import type { Conflict } from '../domain/merge'
import { parseRemoteLedger, planSync } from './plan'

export class PreconditionFailed extends Error {
  constructor() {
    super('precondition_failed')
    this.name = 'PreconditionFailed'
  }
}

export interface RemoteFile {
  id: string
  etag: string
  body: string
}

export interface DrivePort {
  read(): Promise<RemoteFile | null>
  /**
   * Create when fileId is null. Update when fileId and ifMatch are set.
   * Throw PreconditionFailed when the remote etag changed.
   */
  write(body: string, ifMatch: string | null, fileId: string | null): Promise<RemoteFile>
}

export interface ExchangeResult {
  ledger: Ledger
  conflicts: Conflict[]
  fileId: string
  etag: string
  wrote: boolean
}

/**
 * Merge local with the latest remote, then upload only the merged result.
 * A failed precondition re-reads and merges again so a concurrent device is not overwritten.
 */
export async function exchangeLedgers(
  base: Ledger | null,
  local: Ledger,
  drive: DrivePort,
  attempts = 3,
): Promise<ExchangeResult> {
  let remote = await drive.read()
  let lastConflicts: Conflict[] = []
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remoteLedger = remote ? parseRemoteLedger(remote.body) : null
    const plan = planSync(base, local, remoteLedger)
    lastConflicts = plan.conflicts
    if (!plan.write && remote) {
      return {
        ledger: plan.ledger,
        conflicts: plan.conflicts,
        fileId: remote.id,
        etag: remote.etag,
        wrote: false,
      }
    }
    try {
      const written = await drive.write(
        JSON.stringify(plan.ledger),
        remote?.etag ?? null,
        remote?.id ?? null,
      )
      return {
        ledger: plan.ledger,
        conflicts: plan.conflicts,
        fileId: written.id,
        etag: written.etag,
        wrote: true,
      }
    } catch (error) {
      if (!(error instanceof PreconditionFailed) || attempt === attempts - 1) throw error
      remote = await drive.read()
      if (!remote) throw new LedgerError('remote_missing')
    }
  }
  return {
    ledger: local,
    conflicts: lastConflicts,
    fileId: remote?.id ?? '',
    etag: remote?.etag ?? '',
    wrote: false,
  }
}
