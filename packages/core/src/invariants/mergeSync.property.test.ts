import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { canonical } from '../canonical'
import { emptyLedger } from '../ledger'
import { mergeCollection } from '../merge'
import { planSync } from '../sync/plan'
import { manualSource, type Ledger, type Transaction } from '../types'

/**
 * Holds `mergeCollection` and `planSync` to `verification/lean/Moneyhound/Merge.lean`:
 * `mergeOne_no_loss`, `mergeOne_absence_keeps_ours`, `mergeOne_absence_keeps_remote`,
 * `mergeOne_base_survives`, `mergeOne_higher_revision`, `mergeOne_later_updatedAt`,
 * `mergeOne_tombstone_kept`, `mergeOne_idempotent`, `mergeOne_commutative`.
 * `exchangeLedgers` is the Drive retry loop around this merge and is not modeled.
 */

const RUNS = 100

interface Row {
  id: string
  createdAt: string
  updatedAt: string
  revision: number
  deletedAt: string | null
  amountYen: number
}

function stamp(day: number): string {
  return `2026-04-${String(day).padStart(2, '0')}T00:00:00.000Z`
}

const baseRowArb: fc.Arbitrary<Row> = fc
  .record({
    id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
    revision: fc.integer({ min: 1, max: 4 }),
    day: fc.integer({ min: 1, max: 9 }),
    amountYen: fc.integer({ min: 1, max: 50_000 }),
    deleted: fc.boolean(),
  })
  .map((row) => ({
    id: row.id,
    createdAt: stamp(1),
    updatedAt: stamp(row.day),
    revision: row.revision,
    deletedAt: row.deleted ? stamp(row.day) : null,
    amountYen: row.amountYen,
  }))

const editArb = fc.record({
  kind: fc.constantFrom('keep', 'amount', 'tombstone', 'drop'),
  bump: fc.integer({ min: 1, max: 5 }),
  day: fc.integer({ min: 10, max: 27 }),
  amountYen: fc.integer({ min: 1, max: 50_000 }),
})

function applyEdit(row: Row, edit: { kind: string; bump: number; day: number; amountYen: number }) {
  if (edit.kind === 'drop') return null
  if (edit.kind === 'keep') return row
  if (edit.kind === 'tombstone') {
    return {
      ...row,
      deletedAt: stamp(edit.day),
      updatedAt: stamp(edit.day),
      revision: row.revision + edit.bump,
    }
  }
  return {
    ...row,
    amountYen: edit.amountYen,
    deletedAt: null,
    updatedAt: stamp(edit.day),
    revision: row.revision + edit.bump,
  }
}

function byId(rows: readonly Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [row.id, row]))
}

function changed(base: Row | undefined, side: Row | undefined): boolean {
  if (!side) return false
  if (!base) return true
  return canonical(side) !== canonical(base)
}

function toTransaction(row: Row): Transaction {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
    deletedAt: row.deletedAt,
    date: '2026-04-02',
    amountYen: row.amountYen,
    type: 'expense',
    categoryId: null,
    categoryOrigin: null,
    accountId: 'acct',
    transferAccountId: null,
    description: 'merge',
    memo: '',
    source: manualSource(),
  }
}

function ledgerFrom(rows: readonly Row[]): Ledger {
  return { ...emptyLedger(), transactions: rows.map(toTransaction) }
}

describe('sync merge', () => {
  it('keeps every id, prefers the higher revision, and does not treat absence as deletion', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(baseRowArb, {
          minLength: 1,
          maxLength: 6,
          selector: (row) => row.id,
        }),
        fc.array(editArb, { minLength: 6, maxLength: 6 }),
        fc.array(editArb, { minLength: 6, maxLength: 6 }),
        fc.array(baseRowArb, { maxLength: 2 }),
        (baseRows, localEdits, remoteEdits, extras) => {
          const base = baseRows
          const local: Row[] = []
          const remote: Row[] = []
          base.forEach((row, index) => {
            const left = applyEdit(row, localEdits[index] ?? localEdits[0]!)
            const right = applyEdit(row, remoteEdits[index] ?? remoteEdits[0]!)
            if (left) local.push(left)
            if (right) remote.push(right)
          })
          const seenExtra = new Set<string>()
          for (const extra of extras) {
            if (base.some((row) => row.id === extra.id) || seenExtra.has(extra.id)) continue
            seenExtra.add(extra.id)
            local.push({ ...extra, id: `l-${extra.id}` })
            remote.push({ ...extra, id: `r-${extra.id}`, amountYen: extra.amountYen + 1 })
          }
          const merged = mergeCollection(base, local, remote, 'transactions')
          const seen = new Set(merged.records.map((row) => row.id))
          const union = new Set([...base, ...local, ...remote].map((row) => row.id))
          expect(seen).toEqual(union)
          expect(merged.records).toHaveLength(union.size)

          const baseMap = byId(base)
          const localMap = byId(local)
          const remoteMap = byId(remote)
          const resultMap = byId(merged.records)
          for (const id of union) {
            const result = resultMap.get(id)
            expect(result).toBeDefined()
            if (!result) continue
            const inputs = [baseMap.get(id), localMap.get(id), remoteMap.get(id)].filter(
              (row): row is Row => row !== undefined,
            )
            expect(inputs.some((row) => canonical(row) === canonical(result))).toBe(true)
            const baseRow = baseMap.get(id)
            const left = localMap.get(id)
            const right = remoteMap.get(id)
            if (left && canonical(left) === canonical(baseRow) && !right && baseRow) {
              expect(canonical(result)).toBe(canonical(baseRow))
            }
            if (!left && !right && baseRow) expect(canonical(result)).toBe(canonical(baseRow))
            const leftChanged = changed(baseRow, left)
            const rightChanged = changed(baseRow, right)
            if (
              left &&
              right &&
              leftChanged &&
              rightChanged &&
              canonical(left) !== canonical(right)
            ) {
              if (left.revision !== right.revision) {
                const winner = left.revision > right.revision ? left : right
                expect(canonical(result)).toBe(canonical(winner))
                if (winner.deletedAt) expect(result.deletedAt).toBe(winner.deletedAt)
              } else if (left.updatedAt !== right.updatedAt) {
                const winner = left.updatedAt > right.updatedAt ? left : right
                expect(canonical(result)).toBe(canonical(winner))
              }
            }
          }

          const swapped = mergeCollection(base, remote, local, 'transactions')
          const swappedMap = byId(swapped.records)
          expect([...resultMap.keys()].sort()).toEqual([...swappedMap.keys()].sort())
          for (const [id, row] of resultMap) {
            expect(canonical(swappedMap.get(id)!)).toBe(canonical(row))
          }

          const same = mergeCollection(local, local, local, 'transactions')
          expect(same.records.map((row) => canonical(row))).toEqual(
            local.map((row) => canonical(row)),
          )
        },
      ),
      { numRuns: RUNS },
    )
  })

  it('does not upload when local and remote are already the same ledger', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(baseRowArb, { minLength: 0, maxLength: 4, selector: (row) => row.id }),
        (rows) => {
          const ledger = ledgerFrom(rows)
          const plan = planSync(ledger, ledger, ledger)
          expect(plan.write).toBe(false)
          expect(canonical(plan.ledger)).toBe(canonical(ledger))
          expect(plan.conflicts).toEqual([])
          const extra = ledgerFrom([
            ...rows,
            {
              id: 'added',
              createdAt: stamp(1),
              updatedAt: stamp(2),
              revision: 1,
              deletedAt: null,
              amountYen: 10,
            },
          ])
          expect(planSync(ledger, extra, ledger).write).toBe(true)
          expect(
            planSync(ledger, extra, ledger).ledger.transactions.map((row) => row.id),
          ).toContain('added')
        },
      ),
      { numRuns: 40 },
    )
  })
})
