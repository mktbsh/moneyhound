import { loadStoredLedger, seedLedger } from '../domain/ledger'
import type { Ledger } from '../domain/types'

const DB_NAME = 'moneyhound'
const DB_VERSION = 1
const STORE = 'kv'

export interface SyncState {
  base: Ledger | null
  fileId: string | null
  etag: string | null
  lastSyncedAt: string | null
  lastConflictCount: number
}

export function emptySyncState(): SyncState {
  return {
    base: null,
    fileId: null,
    etag: null,
    lastSyncedAt: null,
    lastConflictCount: 0,
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'))
    })
  } finally {
    db.close()
  }
}

export async function loadLedger(): Promise<Ledger> {
  const stored = await withStore<unknown>('readonly', (store) => store.get('ledger'))
  if (stored === undefined) {
    const seeded = seedLedger()
    await saveLedger(seeded)
    return seeded
  }
  return loadStoredLedger(stored)
}

export async function saveLedger(ledger: Ledger): Promise<void> {
  await withStore('readwrite', (store) => store.put(ledger, 'ledger'))
}

export async function loadSyncState(): Promise<SyncState> {
  const stored = await withStore<SyncState | undefined>('readonly', (store) => store.get('sync'))
  return stored ?? emptySyncState()
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await withStore('readwrite', (store) => store.put(state, 'sync'))
}
