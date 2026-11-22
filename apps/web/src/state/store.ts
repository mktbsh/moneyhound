import { useSyncExternalStore } from 'react'
import { currentYearMonth, type Ledger } from '@moneyhound/core'
import { loadLedger, saveLedger } from '../storage/db'

export type RouteName = 'summary' | 'transactions' | 'categories' | 'settings'

interface Snapshot {
  ready: boolean
  loadError: string | null
  ledger: Ledger | null
  yearMonth: string
  syncNote: string | null
}

let snapshot: Snapshot = {
  ready: false,
  loadError: null,
  ledger: null,
  yearMonth: currentYearMonth(),
  syncNote: null,
}

const listeners = new Set<() => void>()
let starting: Promise<void> | null = null

function emit() {
  listeners.forEach((listener) => listener())
}

function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch }
  emit()
}

export function getSnapshot(): Snapshot {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function initLedger(): Promise<void> {
  if (!starting) {
    starting = loadLedger()
      .then((ledger) => {
        update({ ledger, ready: true, loadError: null })
      })
      .catch(() => {
        update({ ready: true, loadError: '保存データを読み込めませんでした。' })
      })
  }
  return starting
}

export async function commitLedger(ledger: Ledger): Promise<void> {
  await saveLedger(ledger)
  update({ ledger })
}

export async function reloadLedger(): Promise<void> {
  const ledger = await loadLedger()
  update({ ledger })
}

export function setYearMonth(yearMonth: string) {
  update({ yearMonth })
}

export function setSyncNote(syncNote: string | null) {
  update({ syncNote })
}

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function routeFromHash(hash: string): RouteName {
  const path = hash.replace(/^#/, '')
  if (path.startsWith('/transactions')) return 'transactions'
  if (path.startsWith('/categories')) return 'categories'
  if (path.startsWith('/settings')) return 'settings'
  return 'summary'
}
