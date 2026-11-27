import { loadStoredLedger, seedLedger, type Ledger } from '@moneyhound/core'

const DB_NAME = 'moneyhound'
const DB_VERSION = 1
const STORE = 'kv'

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

/** Local development and e2e only. Production keeps the ledger in Drive via Apps Script. */
export async function loadLocalLedger(): Promise<Ledger> {
  const stored = await withStore<unknown>('readonly', (store) => store.get('ledger'))
  if (stored === undefined) {
    const seeded = seedLedger()
    await saveLocalLedger(seeded)
    return seeded
  }
  return loadStoredLedger(stored)
}

export async function saveLocalLedger(ledger: Ledger): Promise<void> {
  await withStore('readwrite', (store) => store.put(ledger, 'ledger'))
}
