import { describe, expect, it } from 'vitest'
import { canonical } from './canonical'
import { addTransaction, seedLedger, updateTransaction } from './ledger'
import { mergeLedgers } from './merge'
import type { Ledger } from './types'

const expense = {
  date: '2026-04-02',
  amountYen: 1000,
  type: 'expense' as const,
  categoryId: 'cat_food',
  accountId: 'acct_cash',
  transferAccountId: null,
  description: 'パン',
  memo: '',
}

describe('mergeLedgers', () => {
  it('keeps identical seed data from two devices without conflicts', () => {
    const merged = mergeLedgers(null, seedLedger(), seedLedger())
    expect(merged.conflicts).toEqual([])
    expect(canonical(merged.ledger)).toBe(canonical(seedLedger()))
  })

  it('keeps edits from both devices when they touch different records', () => {
    const base = seedLedger()
    const local = addTransaction(base, expense, {
      now: '2026-04-02T00:00:00.000Z',
      id: () => 'local-tx',
    })
    const remote = addTransaction(
      base,
      { ...expense, amountYen: 400, description: '電車', categoryId: 'cat_transport' },
      { now: '2026-04-03T00:00:00.000Z', id: () => 'remote-tx' },
    )
    const merged = mergeLedgers(base, local, remote)
    const ids = merged.ledger.transactions.map((transaction) => transaction.id).sort()
    expect(ids).toEqual(['local-tx', 'remote-tx'])
    expect(merged.conflicts).toEqual([])
  })

  it('uses revision, then updatedAt, when the same record changed on both sides', () => {
    const base = addTransaction(seedLedger(), expense, {
      now: '2026-04-01T00:00:00.000Z',
      id: () => 'tx',
    })
    const local = updateTransaction(
      base,
      'tx',
      { ...expense, amountYen: 1500 },
      {
        now: '2026-04-02T00:00:00.000Z',
        id: () => 'unused',
      },
    )
    const remoteHigherRevision: Ledger = {
      ...base,
      transactions: base.transactions.map((transaction) =>
        transaction.id === 'tx'
          ? { ...transaction, amountYen: 1800, revision: 5, updatedAt: '2026-04-01T01:00:00.000Z' }
          : transaction,
      ),
    }
    const byRevision = mergeLedgers(base, local, remoteHigherRevision)
    expect(
      byRevision.ledger.transactions.find((transaction) => transaction.id === 'tx')?.amountYen,
    ).toBe(1800)
    expect(byRevision.conflicts).toHaveLength(1)

    const remoteLater = updateTransaction(
      base,
      'tx',
      { ...expense, amountYen: 1700 },
      {
        now: '2026-05-01T00:00:00.000Z',
        id: () => 'unused',
      },
    )
    const byTime = mergeLedgers(base, local, remoteLater)
    expect(
      byTime.ledger.transactions.find((transaction) => transaction.id === 'tx')?.amountYen,
    ).toBe(1700)
  })

  it('does not treat a missing row as a delete', () => {
    const base = addTransaction(seedLedger(), expense, {
      now: '2026-04-01T00:00:00.000Z',
      id: () => 'tx',
    })
    const local: Ledger = { ...base, transactions: [] }
    const merged = mergeLedgers(base, local, base)
    expect(merged.ledger.transactions.map((transaction) => transaction.id)).toContain('tx')
  })

  it('propagates a tombstone when it is the newer edit', () => {
    const base = addTransaction(seedLedger(), expense, {
      now: '2026-04-01T00:00:00.000Z',
      id: () => 'tx',
    })
    const local: Ledger = {
      ...base,
      transactions: base.transactions.map((transaction) =>
        transaction.id === 'tx'
          ? {
              ...transaction,
              deletedAt: '2026-04-03T00:00:00.000Z',
              updatedAt: '2026-04-03T00:00:00.000Z',
              revision: 2,
            }
          : transaction,
      ),
    }
    const merged = mergeLedgers(base, local, base)
    expect(
      merged.ledger.transactions.find((transaction) => transaction.id === 'tx')?.deletedAt,
    ).toBe('2026-04-03T00:00:00.000Z')
  })
})
