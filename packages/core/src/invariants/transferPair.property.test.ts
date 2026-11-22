import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { projectAccountBalances, summarizeMonth } from '../aggregate'
import { canonical } from '../canonical'
import { emptyLedger } from '../ledger'
import { applyImport } from '../importers/applyImport'
import type { NormalizedTransaction } from '../importers/types'

/**
 * Holds imported transfer pairing to `verification/lean/Moneyhound/TransferPair.lean`
 * (`paired_balance_zero`, `pair_idempotent`) and to `applyImport`.
 * A paired Money Forward transfer must move yen between two accounts once,
 * stay out of income and expense, and import again as the same ledger.
 */

const RUNS = 60

function clock(prefix: string) {
  let n = 0
  return { now: '2026-04-08T00:00:00.000Z', id: () => `${prefix}-${n++}` }
}

function transferRow(input: {
  id: string
  accountName: string
  amountYen: number
  amountSign: -1 | 1
  date: string
  description: string
}): NormalizedTransaction {
  return {
    date: input.date,
    amountYen: input.amountYen,
    amountSign: input.amountSign,
    type: 'transfer',
    description: input.description,
    memo: '',
    categoryLarge: null,
    categoryMiddle: null,
    accountName: input.accountName,
    externalId: input.id,
    contentHash: input.id,
    include: true,
  }
}

describe('imported transfer pairs', () => {
  it('conserves balance and stays idempotent', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountYen: fc.integer({ min: 1, max: 50_000 }),
            description: fc.constantFrom('移動', '引落', 'チャージ'),
            lone: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (specs) => {
          const rows: NormalizedTransaction[] = []
          let loneYen = 0
          specs.forEach((spec, index) => {
            const date = `2026-04-${String(index + 1).padStart(2, '0')}`
            rows.push(
              transferRow({
                id: `out-${index}`,
                accountName: `源${index}`,
                amountYen: spec.amountYen,
                amountSign: -1,
                date,
                description: spec.description,
              }),
            )
            if (!spec.lone) {
              rows.push(
                transferRow({
                  id: `in-${index}`,
                  accountName: `先${index}`,
                  amountYen: spec.amountYen,
                  amountSign: 1,
                  date,
                  description: spec.description,
                }),
              )
            } else {
              loneYen += spec.amountYen
            }
          })
          const parsed = {
            adapterId: 'mf-csv',
            fileName: 'pairs.csv',
            transactions: rows,
            errors: [],
          }
          const first = applyImport(emptyLedger(), parsed, clock('a'))
          const live = first.ledger.transactions.filter(
            (transaction) => transaction.deletedAt === null,
          )
          expect(live).toHaveLength(specs.length)
          expect(live.every((transaction) => transaction.type === 'transfer')).toBe(true)
          const paired = specs.filter((spec) => !spec.lone).length
          expect(live.filter((transaction) => transaction.transferAccountId).length).toBe(paired)
          const april = summarizeMonth(first.ledger, '2026-04')
          expect(april.incomeYen).toBe(0)
          expect(april.expenseYen).toBe(0)
          const net = projectAccountBalances(first.ledger).reduce(
            (sum, flow) => sum + flow.transferInYen - flow.transferOutYen,
            0,
          )
          expect(net + loneYen).toBe(0)
          const second = applyImport(first.ledger, parsed, clock('b'))
          expect(second.report.inserted).toBe(0)
          expect(canonical(second.ledger)).toBe(canonical(first.ledger))
        },
      ),
      { numRuns: RUNS },
    )
  })

  it('credits a lone inflow and debits a lone outflow', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountYen: fc.integer({ min: 1, max: 50_000 }),
            direction: fc.constantFrom('in' as const, 'out' as const),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (specs) => {
          const rows = specs.map((spec, index) =>
            transferRow({
              id: `${spec.direction}-${index}`,
              accountName: `口座${index}`,
              amountYen: spec.amountYen,
              amountSign: spec.direction === 'in' ? 1 : -1,
              date: `2026-04-${String(index + 1).padStart(2, '0')}`,
              description: '振替',
            }),
          )
          const parsed = {
            adapterId: 'mf-csv',
            fileName: 'lones.csv',
            transactions: rows,
            errors: [],
          }
          const first = applyImport(emptyLedger(), parsed, clock('c'))
          const april = summarizeMonth(first.ledger, '2026-04')
          expect(april.incomeYen).toBe(0)
          expect(april.expenseYen).toBe(0)
          const flows = projectAccountBalances(first.ledger)
          specs.forEach((spec, index) => {
            const account = first.ledger.accounts.find((item) => item.name === `口座${index}`)
            const flow = flows.find((item) => item.accountId === account?.id)
            const stored = first.ledger.transactions.find(
              (transaction) => transaction.source.externalId === `${spec.direction}-${index}`,
            )
            if (spec.direction === 'in') {
              expect(stored?.accountId).toBeNull()
              expect(stored?.transferAccountId).toBe(account?.id)
              expect(flow?.balanceYen).toBe(spec.amountYen)
            } else {
              expect(stored?.accountId).toBe(account?.id)
              expect(stored?.transferAccountId).toBeNull()
              expect(flow?.balanceYen).toBe(-spec.amountYen)
            }
          })
          const second = applyImport(first.ledger, parsed, clock('d'))
          expect(second.report.inserted).toBe(0)
          expect(canonical(second.ledger)).toBe(canonical(first.ledger))
        },
      ),
      { numRuns: RUNS },
    )
  })
})
