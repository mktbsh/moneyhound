import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { canonical } from '../canonical'
import { addTransaction, emptyLedger, seedLedger } from '../ledger'
import { applyImport } from '../importers/applyImport'
import type { ImportParseResult, NormalizedTransaction } from '../importers/types'
import type { Ledger } from '../types'

/**
 * Holds `applyImport` to the match-key theorems in `verification/lean/Moneyhound/Import.lean`:
 * `dedupe_unique`, `countKey_applyImport_le`, `applyImport_reimport_same_cell`, `reimport_countKey`.
 * A second import of the same rows must not insert another transaction.
 */

const RUNS = 80

function clock(prefix: string, now: string) {
  let n = 0
  return { now, id: () => `${prefix}-${n++}` }
}

const text = fc
  .array(fc.constantFrom(...'abcABCあいスタ'.split('')), { minLength: 0, maxLength: 10 })
  .map((chars) => chars.join(''))

const rowArb: fc.Arbitrary<NormalizedTransaction> = fc.record({
  date: fc.constantFrom('2026-04-02', '2026-04-15', '2026-05-01', '2026-03-31'),
  amountYen: fc.integer({ min: 1, max: 2_000_000 }),
  amountSign: fc.constantFrom(-1 as const, 1 as const),
  type: fc.constantFrom('income', 'expense', 'transfer'),
  description: text,
  memo: fc.constant(''),
  categoryLarge: fc.constantFrom('食費', '給与', '日用品', null),
  categoryMiddle: fc.constant(null),
  accountName: fc.constantFrom('現金', '銀行', 'カード', 'Cash', 'cash', '', null),
  externalId: fc.constantFrom('e1', 'e2', 'e3', 'e4', null),
  contentHash: fc.constantFrom('h1', 'h2', 'h3', 'h4'),
  include: fc.boolean(),
})

function parsed(rows: NormalizedTransaction[], fileError?: string): ImportParseResult {
  return {
    adapterId: 'mf-csv',
    fileName: 'fixture.csv',
    transactions: rows,
    errors: [],
    ...(fileError ? { fileError } : {}),
  }
}

function withCafeRule(ledger: Ledger): Ledger {
  return {
    ...ledger,
    categoryRules: [
      {
        id: 'rule-cafe',
        enabled: true,
        priority: 0,
        operator: 'contains',
        pattern: 'スタ',
        sourceId: null,
        accountId: null,
        categoryId: 'cat_leisure',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
        deletedAt: null,
      },
    ],
  }
}

function externalCounts(ledger: Ledger): Map<string, number> {
  const counts = new Map<string, number>()
  for (const transaction of ledger.transactions) {
    const externalId = transaction.source.externalId
    if (transaction.source.sourceId !== 'src_mf-csv' || !externalId) continue
    counts.set(externalId, (counts.get(externalId) ?? 0) + 1)
  }
  return counts
}

describe('applyImport match keys', () => {
  it('does not let a hash-only row replace an external id that shares its hash', () => {
    const rows: NormalizedTransaction[] = [
      {
        date: '2026-04-02',
        amountYen: 1,
        amountSign: 1,
        type: 'income',
        description: '',
        memo: '',
        categoryLarge: '食費',
        categoryMiddle: null,
        accountName: '現金',
        externalId: 'e1',
        contentHash: 'h4',
        include: true,
      },
      {
        date: '2026-04-02',
        amountYen: 1,
        amountSign: 1,
        type: 'income',
        description: '',
        memo: '',
        categoryLarge: '食費',
        categoryMiddle: null,
        accountName: '現金',
        externalId: null,
        contentHash: 'h4',
        include: true,
      },
    ]
    const file = parsed(rows)
    const first = applyImport(emptyLedger(), file, clock('a', '2026-04-08T00:00:00.000Z'))
    const second = applyImport(first.ledger, file, clock('b', '2026-04-09T00:00:00.000Z'))
    expect(first.ledger.transactions).toHaveLength(2)
    expect(second.report.inserted).toBe(0)
    expect(canonical(second.ledger)).toBe(canonical(first.ledger))
    expect(
      first.ledger.transactions.some((transaction) => transaction.source.externalId === 'e1'),
    ).toBe(true)
  })

  it('re-imports the same rows without a second transaction', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { minLength: 0, maxLength: 12 }),
        fc.boolean(),
        fc.boolean(),
        (rows, seeded, useRule) => {
          const base = seeded ? seedLedger() : emptyLedger()
          const start = seeded
            ? addTransaction(
                useRule ? withCafeRule(base) : base,
                {
                  date: '2026-04-01',
                  amountYen: 120,
                  type: 'expense',
                  categoryId: 'cat_food',
                  accountId: 'acct_cash',
                  transferAccountId: null,
                  description: '手入力',
                  memo: '',
                },
                clock('manual', '2026-04-01T00:00:00.000Z'),
              )
            : base
          const file = parsed(rows)
          const first = applyImport(start, file, clock('a', '2026-04-08T00:00:00.000Z'))
          const second = applyImport(first.ledger, file, clock('b', '2026-04-09T00:00:00.000Z'))
          expect(second.report.inserted).toBe(0)
          expect(canonical(second.ledger)).toBe(canonical(first.ledger))
          for (const count of externalCounts(second.ledger).values()) expect(count).toBe(1)
          if (seeded) {
            expect(
              second.ledger.transactions.filter((transaction) =>
                transaction.id.startsWith('manual'),
              ),
            ).toHaveLength(1)
          }
        },
      ),
      { numRuns: RUNS },
    )
  })

  it('keeps one transaction when one file repeats an external id', () => {
    fc.assert(
      fc.property(rowArb, fc.integer({ min: 1, max: 9_999 }), (row, extra) => {
        fc.pre(row.externalId !== null && row.include)
        const file = parsed([
          row,
          { ...row, amountYen: row.amountYen + extra, description: `${row.description}x` },
        ])
        const result = applyImport(seedLedger(), file, clock('a', '2026-04-08T00:00:00.000Z'))
        const matches = result.ledger.transactions.filter(
          (transaction) => transaction.source.externalId === row.externalId,
        )
        expect(matches).toHaveLength(1)
        expect(matches[0]?.amountYen).toBe(row.amountYen + extra)
        const again = applyImport(result.ledger, file, clock('b', '2026-04-09T00:00:00.000Z'))
        expect(again.report.inserted).toBe(0)
        expect(
          again.ledger.transactions.filter(
            (transaction) => transaction.source.externalId === row.externalId,
          ),
        ).toHaveLength(1)
      }),
      { numRuns: RUNS },
    )
  })

  it('leaves the ledger untouched when the file itself failed', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 4 }), (rows) => {
        const ledger = seedLedger()
        const result = applyImport(
          ledger,
          parsed(rows, 'unreadable'),
          clock('a', '2026-04-08T00:00:00.000Z'),
        )
        expect(result.ledger).toBe(ledger)
        expect(result.report).toEqual({
          inserted: 0,
          updated: 0,
          unchanged: 0,
          excluded: 0,
          skipped: 0,
        })
      }),
      { numRuns: 20 },
    )
  })
})
