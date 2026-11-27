import {
  exchangeLedgers,
  loadStoredLedger,
  parseRemoteLedger,
  PreconditionFailed,
  seedLedger,
  type DrivePort,
  type Ledger,
} from '@moneyhound/core'
import { loadLocalLedger, saveLocalLedger } from './db'
import { gasDrivePort, type ScriptRunner } from './gasPort'

export interface SaveResult {
  ledger: Ledger
  /** Records another device changed at the same time. The newer revision won. */
  conflicts: number
}

export interface LedgerBackend {
  kind: 'drive' | 'local'
  load(): Promise<Ledger>
  save(next: Ledger): Promise<SaveResult>
}

export function localBackend(): LedgerBackend {
  return {
    kind: 'local',
    load: loadLocalLedger,
    async save(next) {
      await saveLocalLedger(next)
      return { ledger: next, conflicts: 0 }
    },
  }
}

/**
 * The Drive file is the only copy. Each save sends the whole ledger with the
 * version it was based on. If another device saved in between, the core
 * three-way merge (`exchangeLedgers`) combines both and the result is shown.
 */
export function driveBackend(port: DrivePort): LedgerBackend {
  let base: Ledger | null = null
  let etag: string | null = null
  let fileId: string | null = null

  return {
    kind: 'drive',
    async load() {
      const remote = await port.read()
      if (!remote) {
        const seeded = seedLedger()
        const written = await port.write(JSON.stringify(seeded), null, null)
        base = seeded
        etag = written.etag
        fileId = written.id
        return seeded
      }
      const parsed = parseRemoteLedger(remote.body)
      const ledger = loadStoredLedger(parsed)
      base = ledger
      etag = remote.etag
      fileId = remote.id
      return ledger
    },
    async save(next) {
      // Fast path: nothing changed remotely since our last read or write.
      if (etag !== null && fileId !== null) {
        try {
          const written = await port.write(JSON.stringify(next), etag, fileId)
          base = next
          etag = written.etag
          return { ledger: next, conflicts: 0 }
        } catch (error) {
          if (!(error instanceof PreconditionFailed)) throw error
        }
      }
      const result = await exchangeLedgers(base, next, port)
      base = result.ledger
      etag = result.etag
      fileId = result.fileId
      return { ledger: result.ledger, conflicts: result.conflicts.length }
    },
  }
}

/** Apps Script serves the page with `google.script.run`. Anything else is local development. */
export function detectBackend(win: Window = window): LedgerBackend {
  const run = win.google?.script?.run as ScriptRunner | undefined
  return run ? driveBackend(gasDrivePort(run)) : localBackend()
}
