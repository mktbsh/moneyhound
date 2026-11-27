import { createSignal } from 'solid-js'
import { currentYearMonth, type Ledger } from '@moneyhound/core'
import { messageOf } from '@moneyhound/ui'
import { detectBackend, type LedgerBackend } from '../storage/backend'

export type RouteName = 'summary' | 'transactions' | 'categories' | 'settings'

let backend: LedgerBackend | null = null
function current(): LedgerBackend {
  backend ??= detectBackend()
  return backend
}

const [ledger, setLedger] = createSignal<Ledger | null>(null)
const [ready, setReady] = createSignal(false)
const [loadError, setLoadError] = createSignal<string | null>(null)
const [yearMonth, setYearMonth] = createSignal(currentYearMonth())
const [storageNote, setStorageNote] = createSignal<string | null>(null)
const [saving, setSaving] = createSignal(false)

export { ledger, ready, loadError, yearMonth, setYearMonth, storageNote, saving }

export function storageKind(): LedgerBackend['kind'] {
  return current().kind
}

let starting: Promise<void> | null = null

export function initLedger(): Promise<void> {
  if (!starting) {
    starting = current()
      .load()
      .then((loaded) => {
        setLedger(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        setLoadError(`保存データを読み込めませんでした。${messageOf(error)}`)
      })
      .finally(() => setReady(true))
  }
  return starting
}

/** Saves are serialized so two quick edits cannot race each other's version. */
let queue: Promise<unknown> = Promise.resolve()

export function commitLedger(next: Ledger): Promise<void> {
  const run = queue.then(async () => {
    setSaving(true)
    try {
      const result = await current().save(next)
      setLedger(result.ledger)
      setStorageNote(
        result.conflicts
          ? `別の端末で同時に変更された ${result.conflicts} 件は、新しい方を採用しました。`
          : null,
      )
    } finally {
      setSaving(false)
    }
  })
  queue = run.catch(() => undefined)
  return run
}

/** Re-read the stored ledger, for changes made on another device. */
export async function reloadLedger(): Promise<void> {
  const loaded = await current().load()
  setLedger(loaded)
  setStorageNote(null)
}

export function routeFromHash(hash: string): RouteName {
  const path = hash.replace(/^#/, '')
  if (path.startsWith('/transactions')) return 'transactions'
  if (path.startsWith('/categories')) return 'categories'
  if (path.startsWith('/settings')) return 'settings'
  return 'summary'
}
