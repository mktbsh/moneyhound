import { loadLedger, loadSyncState, saveLedger, saveSyncState } from '../storage/db'
import { exchangeLedgers, type DrivePort, type ExchangeResult } from './exchange'

export async function syncLedger(
  drive: DrivePort,
  now = new Date().toISOString(),
): Promise<ExchangeResult> {
  const local = await loadLedger()
  const state = await loadSyncState()
  const result = await exchangeLedgers(state.base, local, drive)
  await saveLedger(result.ledger)
  await saveSyncState({
    base: result.ledger,
    fileId: result.fileId,
    etag: result.etag,
    lastSyncedAt: now,
    lastConflictCount: result.conflicts.length,
  })
  return result
}
