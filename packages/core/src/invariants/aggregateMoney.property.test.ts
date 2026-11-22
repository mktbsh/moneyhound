import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { projectAccountBalances, summarizeMonth } from '../aggregate'
import { emptyLedger } from '../ledger'
import type { Account, Ledger, Transaction } from '../types'

/**
 * Holds `summarizeMonth` and `projectAccountBalances` to
 * `verification/lean/Moneyhound/Aggregate.lean`:
 * transfers and tombstones stay out of income, expense, and balance;
 * category buckets add up to those totals in exact integer yen;
 * paired transfers are balance-neutral; a null destination only debits the source;
 * a null source only credits the destination.
 */

const RUNS = 80
const MONTH = '2026-04'

const amountArb = fc.integer({ min: 1, max: 5_000_000 })

function transaction(input: {
  id: string
  date: string
  amountYen: number
  type: Transaction['type']
  deleted: boolean
  categoryId: string | null
  accountId: string | null
  transferAccountId: string | null
}): Transaction {
  return {
    id: input.id,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    revision: 1,
    deletedAt: input.deleted ? '2026-04-02T00:00:00.000Z' : null,
    date: input.date,
    amountYen: input.amountYen,
    type: input.type,
    categoryId: input.categoryId,
    categoryOrigin: input.type === 'transfer' ? null : 'user',
    accountId: input.accountId,
    transferAccountId: input.transferAccountId,
    description: 'fixture',
    memo: '',
    source: { sourceId: 'manual', externalId: null, contentHash: '', importedAt: null },
  }
}

function account(id: string, opening: number | null, deleted: boolean): Account {
  return {
    id,
    name: id,
    kind: 'bank',
    currency: 'JPY',
    sourceId: null,
    externalAccountId: null,
    archived: false,
    openingBalanceYen: opening,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    deletedAt: deleted ? '2026-02-01T00:00:00.000Z' : null,
  }
}

function ledgerOf(accounts: Account[], transactions: Transaction[]): Ledger {
  return { ...emptyLedger(), accounts, transactions }
}

function monthTotals(transactions: readonly Transaction[], yearMonth: string) {
  let income = 0n
  let expense = 0n
  let transfer = 0n
  const incomeBy = new Map<string, bigint>()
  const expenseBy = new Map<string, bigint>()
  for (const item of transactions) {
    if (item.deletedAt !== null) continue
    if (item.date.slice(0, 7) !== yearMonth) continue
    const amount = BigInt(item.amountYen)
    if (item.type === 'income') {
      income += amount
      const key = item.categoryId ?? ''
      incomeBy.set(key, (incomeBy.get(key) ?? 0n) + amount)
    } else if (item.type === 'expense') {
      expense += amount
      const key = item.categoryId ?? ''
      expenseBy.set(key, (expenseBy.get(key) ?? 0n) + amount)
    } else {
      transfer += amount
    }
  }
  return { income, expense, balance: income - expense, transfer, incomeBy, expenseBy }
}

function bucketSum(rows: { amountYen: number }[]): bigint {
  return rows.reduce((sum, row) => sum + BigInt(row.amountYen), 0n)
}

const txArb = fc.record({
  date: fc.constantFrom('2026-04-03', '2026-04-20', '2026-05-01', '2026-03-15'),
  amountYen: amountArb,
  type: fc.constantFrom('income' as const, 'expense' as const, 'transfer' as const),
  deleted: fc.boolean(),
  categoryId: fc.constantFrom('cat_food', 'cat_salary', null),
  accountId: fc.constantFrom('a', 'b', 'c'),
  dest: fc.constantFrom('a', 'b', 'c', null),
})

describe('month totals and transfer balances', () => {
  it('matches the integer sum of included income and expense, and ignores transfers', () => {
    fc.assert(
      fc.property(
        fc.array(txArb, { minLength: 0, maxLength: 16 }),
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 3, maxLength: 3 }),
        (rows, openings) => {
          const accounts = ['a', 'b', 'c'].map((id, index) =>
            account(id, openings[index] ?? 0, false),
          )
          const transactions = rows.map((row, index) =>
            transaction({
              id: `t${index}`,
              date: row.date,
              amountYen: row.amountYen,
              type: row.type,
              deleted: row.deleted,
              categoryId: row.type === 'transfer' ? null : row.categoryId,
              accountId: row.accountId,
              transferAccountId:
                row.type === 'transfer' && row.dest !== row.accountId ? row.dest : null,
            }),
          )
          const ledger = ledgerOf(accounts, transactions)
          const summary = summarizeMonth(ledger, MONTH)
          const expected = monthTotals(transactions, MONTH)
          expect(BigInt(summary.incomeYen)).toBe(expected.income)
          expect(BigInt(summary.expenseYen)).toBe(expected.expense)
          expect(BigInt(summary.balanceYen)).toBe(expected.balance)
          expect(BigInt(summary.transferYen)).toBe(expected.transfer)
          expect(summary.balanceYen).toBe(summary.incomeYen - summary.expenseYen)
          expect(bucketSum(summary.incomeByCategory)).toBe(expected.income)
          expect(bucketSum(summary.expenseByCategory)).toBe(expected.expense)
          for (const value of [
            summary.incomeYen,
            summary.expenseYen,
            summary.balanceYen,
            summary.transferYen,
          ]) {
            expect(Number.isSafeInteger(value)).toBe(true)
          }

          const withoutTransfers = ledgerOf(
            accounts,
            transactions.map((item) =>
              item.type === 'transfer' ? { ...item, deletedAt: '2026-04-02T00:00:00.000Z' } : item,
            ),
          )
          const stripped = summarizeMonth(withoutTransfers, MONTH)
          expect(stripped.incomeYen).toBe(summary.incomeYen)
          expect(stripped.expenseYen).toBe(summary.expenseYen)
          expect(stripped.balanceYen).toBe(summary.balanceYen)
        },
      ),
      { numRuns: RUNS },
    )
  })

  it('keeps paired transfers neutral and debits a missing destination only once', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountYen: amountArb,
            source: fc.constantFrom(0, 1, 2, -1),
            dest: fc.constantFrom(0, 1, 2, -1),
            deleted: fc.boolean(),
            sourceDeleted: fc.boolean(),
            destDeleted: fc.boolean(),
          }),
          { maxLength: 10 },
        ),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 3, maxLength: 3 }),
        (rows, openings) => {
          const ids = ['a', 'b', 'c']
          const accounts = ids.map((id, index) => account(id, openings[index] ?? 0, false))
          const transactions = rows.map((row, index) => {
            let source = row.source < 0 ? null : (ids[row.source] ?? 'a')
            let dest = row.dest < 0 ? null : (ids[row.dest] ?? null)
            if (source && dest === source) dest = null
            if (!source && !dest) source = 'a'
            return transaction({
              id: `p${index}`,
              date: '2026-04-04',
              amountYen: row.amountYen,
              type: 'transfer',
              deleted: row.deleted,
              categoryId: null,
              accountId: source,
              transferAccountId: dest,
            })
          })
          if (rows.some((row) => row.sourceDeleted)) {
            const sourceIndex = rows.find((row) => row.sourceDeleted)?.source ?? 0
            const target = accounts[sourceIndex]
            if (target) accounts[sourceIndex] = { ...target, deletedAt: '2026-02-01T00:00:00.000Z' }
          }
          const ledger = ledgerOf(accounts, transactions)
          const live = new Set(
            ledger.accounts.filter((item) => item.deletedAt === null).map((item) => item.id),
          )
          let expected = 0n
          for (const item of transactions) {
            if (item.deletedAt !== null || item.type !== 'transfer') continue
            const amount = BigInt(item.amountYen)
            if (item.accountId && live.has(item.accountId)) expected -= amount
            if (
              item.transferAccountId &&
              live.has(item.transferAccountId) &&
              item.transferAccountId !== item.accountId
            ) {
              expected += amount
            }
          }
          const flows = projectAccountBalances(ledger)
          const actual = flows.reduce(
            (sum, flow) => sum + BigInt(flow.transferInYen) - BigInt(flow.transferOutYen),
            0n,
          )
          expect(actual).toBe(expected)
          for (const flow of flows) {
            const opening = BigInt(
              ledger.accounts.find((item) => item.id === flow.accountId)?.openingBalanceYen ?? 0,
            )
            expect(BigInt(flow.balanceYen)).toBe(
              opening +
                BigInt(flow.incomeYen) -
                BigInt(flow.expenseYen) +
                BigInt(flow.transferInYen) -
                BigInt(flow.transferOutYen),
            )
          }
          const paired = transactions.every(
            (item) =>
              item.deletedAt !== null ||
              (item.accountId !== null &&
                item.transferAccountId !== null &&
                item.transferAccountId !== item.accountId &&
                live.has(item.accountId) &&
                live.has(item.transferAccountId)),
          )
          if (paired) expect(actual).toBe(0n)
        },
      ),
      { numRuns: RUNS },
    )
  })
})
