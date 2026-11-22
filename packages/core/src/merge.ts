import { canonical } from './canonical'
import { SCHEMA_VERSION, type Entity, type Ledger } from './types'

export type LedgerCollection =
  | 'accounts'
  | 'categories'
  | 'transactions'
  | 'importSources'
  | 'categoryRules'
  | 'budgets'
  | 'assetSnapshots'

export interface Conflict {
  collection: LedgerCollection
  id: string
  resolution: 'local' | 'remote'
  reason: 'revision' | 'updatedAt' | 'canonical'
}

function indexById<T extends Entity>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]))
}

function chooseWinner<T extends Entity>(
  local: T,
  remote: T,
): { record: T; resolution: 'local' | 'remote'; reason: Conflict['reason'] } {
  if (local.revision !== remote.revision) {
    const localWins = local.revision > remote.revision
    return {
      record: localWins ? local : remote,
      resolution: localWins ? 'local' : 'remote',
      reason: 'revision',
    }
  }
  if (local.updatedAt !== remote.updatedAt) {
    const localWins = local.updatedAt > remote.updatedAt
    return {
      record: localWins ? local : remote,
      resolution: localWins ? 'local' : 'remote',
      reason: 'updatedAt',
    }
  }
  const localWins = canonical(local) >= canonical(remote)
  return {
    record: localWins ? local : remote,
    resolution: localWins ? 'local' : 'remote',
    reason: 'canonical',
  }
}

/**
 * Three-way merge. Absence is not a delete: only a tombstone (`deletedAt`) removes a row.
 * When both sides changed the same id, the higher revision wins, then the later `updatedAt`.
 */
export function mergeCollection<T extends Entity>(
  base: readonly T[] | null,
  local: readonly T[],
  remote: readonly T[],
  collection: LedgerCollection,
): { records: T[]; conflicts: Conflict[] } {
  const baseMap = indexById(base ?? [])
  const localMap = indexById(local)
  const remoteMap = indexById(remote)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const record of [...local, ...remote, ...(base ?? [])]) {
    if (seen.has(record.id)) continue
    seen.add(record.id)
    ids.push(record.id)
  }
  const records: T[] = []
  const conflicts: Conflict[] = []

  for (const id of ids) {
    const baseRecord = baseMap.get(id)
    const localRecord = localMap.get(id)
    const remoteRecord = remoteMap.get(id)
    if (localRecord && remoteRecord && canonical(localRecord) === canonical(remoteRecord)) {
      records.push(localRecord)
      continue
    }
    const localChanged = localRecord
      ? !baseRecord || canonical(localRecord) !== canonical(baseRecord)
      : false
    const remoteChanged = remoteRecord
      ? !baseRecord || canonical(remoteRecord) !== canonical(baseRecord)
      : false
    if (localChanged && remoteChanged && localRecord && remoteRecord) {
      const winner = chooseWinner(localRecord, remoteRecord)
      records.push(winner.record)
      conflicts.push({
        collection,
        id,
        resolution: winner.resolution,
        reason: winner.reason,
      })
      continue
    }
    if (localChanged && localRecord) {
      records.push(localRecord)
      continue
    }
    if (remoteChanged && remoteRecord) {
      records.push(remoteRecord)
      continue
    }
    if (localRecord) records.push(localRecord)
    else if (remoteRecord) records.push(remoteRecord)
    else if (baseRecord) records.push(baseRecord)
  }

  return { records, conflicts }
}

export function mergeLedgers(
  base: Ledger | null,
  local: Ledger,
  remote: Ledger,
): { ledger: Ledger; conflicts: Conflict[] } {
  const accounts = mergeCollection(
    base?.accounts ?? null,
    local.accounts,
    remote.accounts,
    'accounts',
  )
  const categories = mergeCollection(
    base?.categories ?? null,
    local.categories,
    remote.categories,
    'categories',
  )
  const transactions = mergeCollection(
    base?.transactions ?? null,
    local.transactions,
    remote.transactions,
    'transactions',
  )
  const importSources = mergeCollection(
    base?.importSources ?? null,
    local.importSources,
    remote.importSources,
    'importSources',
  )
  const categoryRules = mergeCollection(
    base?.categoryRules ?? null,
    local.categoryRules,
    remote.categoryRules,
    'categoryRules',
  )
  const budgets = mergeCollection(base?.budgets ?? null, local.budgets, remote.budgets, 'budgets')
  const assetSnapshots = mergeCollection(
    base?.assetSnapshots ?? null,
    local.assetSnapshots,
    remote.assetSnapshots,
    'assetSnapshots',
  )
  return {
    ledger: {
      schemaVersion: SCHEMA_VERSION,
      seeded: local.seeded || remote.seeded || Boolean(base?.seeded),
      accounts: accounts.records,
      categories: categories.records,
      transactions: transactions.records,
      importSources: importSources.records,
      categoryRules: categoryRules.records,
      budgets: budgets.records,
      assetSnapshots: assetSnapshots.records,
    },
    conflicts: [
      ...accounts.conflicts,
      ...categories.conflicts,
      ...transactions.conflicts,
      ...importSources.conflicts,
      ...categoryRules.conflicts,
      ...budgets.conflicts,
      ...assetSnapshots.conflicts,
    ],
  }
}
