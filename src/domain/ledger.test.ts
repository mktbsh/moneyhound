import { describe, expect, it } from 'vitest'
import { addTransaction, deleteTransaction, seedLedger, updateTransaction } from './ledger'

const input = {
  date: '2026-04-02',
  amountYen: 1200,
  type: 'expense' as const,
  categoryId: 'cat_food',
  accountId: 'acct_cash',
  transferAccountId: null,
  description: '昼食',
  memo: '',
}

describe('ledger mutations', () => {
  it('edits and soft-deletes a transaction', () => {
    const clock = { now: '2026-04-02T00:00:00.000Z', id: () => 'tx' }
    const created = addTransaction(seedLedger(), input, clock)
    const edited = updateTransaction(
      created,
      'tx',
      { ...input, amountYen: 1500 },
      { now: '2026-04-03T00:00:00.000Z', id: () => 'nope' },
    )
    expect(edited.transactions[0]?.amountYen).toBe(1500)
    expect(edited.transactions[0]?.revision).toBe(2)
    expect(edited.transactions[0]?.categoryOrigin).toBe('user')
    const removed = deleteTransaction(edited, 'tx', {
      now: '2026-04-04T00:00:00.000Z',
      id: () => 'nope',
    })
    expect(removed.transactions[0]?.deletedAt).toBe('2026-04-04T00:00:00.000Z')
  })

  it('requires a different destination account for a transfer', () => {
    expect(() =>
      addTransaction(
        seedLedger(),
        {
          ...input,
          type: 'transfer',
          categoryId: null,
          transferAccountId: 'acct_cash',
        },
        { now: '2026-04-02T00:00:00.000Z', id: () => 'tx' },
      ),
    ).toThrow(/invalid_transfer/)
  })
})
