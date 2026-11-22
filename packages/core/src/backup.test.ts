import { describe, expect, it } from 'bun:test'
import { exportBackup, importBackup } from './backup'
import { LedgerError } from './errors'
import { addTransaction, assertLedger, seedLedger } from './ledger'

describe('backup', () => {
  it('round-trips a ledger and rejects other shapes', () => {
    const ledger = addTransaction(
      seedLedger(),
      {
        date: '2026-04-02',
        amountYen: 1200,
        type: 'expense',
        categoryId: 'cat_food',
        accountId: 'acct_cash',
        transferAccountId: null,
        description: '弁当',
        memo: 'メモ',
      },
      { now: '2026-04-02T00:00:00.000Z', id: () => 'tx' },
    )
    const text = exportBackup(ledger, '2026-04-02T03:00:00.000Z')
    expect(importBackup(text).transactions).toHaveLength(1)
    expect(() => importBackup('{')).toThrow(LedgerError)
    expect(() => importBackup(JSON.stringify({ app: 'other', schemaVersion: 1, ledger }))).toThrow(
      LedgerError,
    )
    expect(() =>
      importBackup(JSON.stringify({ app: 'moneyhound', schemaVersion: 1, ledger })),
    ).toThrowError(/unsupported_schema/)
  })

  it('fills reserved collections when they are omitted', () => {
    const seeded = seedLedger()
    const partial = {
      schemaVersion: 2,
      seeded: true,
      accounts: seeded.accounts,
      categories: seeded.categories,
      transactions: [],
    }
    const ledger = assertLedger(partial)
    expect(ledger.budgets).toEqual([])
    expect(ledger.assetSnapshots).toEqual([])
    expect(ledger.categoryRules).toEqual([])
  })
})
