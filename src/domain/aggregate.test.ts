import { describe, expect, it } from 'vitest'
import { projectAccountBalances, summarizeMonth } from './aggregate'
import { addTransaction, seedLedger } from './ledger'

const clock = (now: string, id: string) => ({ now, id: () => id })

describe('summarizeMonth', () => {
  it('excludes transfers and tombstones from income and expense', () => {
    let ledger = seedLedger()
    ledger = addTransaction(
      ledger,
      {
        date: '2026-04-02',
        amountYen: 1000,
        type: 'expense',
        categoryId: 'cat_food',
        accountId: 'acct_card',
        transferAccountId: null,
        description: '昼食',
        memo: '',
      },
      clock('2026-04-02T00:00:00.000Z', 'tx-expense'),
    )
    ledger = addTransaction(
      ledger,
      {
        date: '2026-04-03',
        amountYen: 200000,
        type: 'income',
        categoryId: 'cat_salary',
        accountId: 'acct_bank',
        transferAccountId: null,
        description: '給与',
        memo: '',
      },
      clock('2026-04-03T00:00:00.000Z', 'tx-income'),
    )
    ledger = addTransaction(
      ledger,
      {
        date: '2026-04-04',
        amountYen: 5000,
        type: 'transfer',
        categoryId: null,
        accountId: 'acct_bank',
        transferAccountId: 'acct_card',
        description: 'カード引落',
        memo: '',
      },
      clock('2026-04-04T00:00:00.000Z', 'tx-transfer'),
    )
    ledger = addTransaction(
      ledger,
      {
        date: '2026-04-05',
        amountYen: 999,
        type: 'expense',
        categoryId: 'cat_daily',
        accountId: 'acct_cash',
        transferAccountId: null,
        description: '削除予定',
        memo: '',
      },
      clock('2026-04-05T00:00:00.000Z', 'tx-deleted'),
    )
    ledger = {
      ...ledger,
      transactions: ledger.transactions.map((transaction) =>
        transaction.id === 'tx-deleted'
          ? { ...transaction, deletedAt: '2026-04-06T00:00:00.000Z' }
          : transaction,
      ),
    }

    const april = summarizeMonth(ledger, '2026-04')
    expect(april.incomeYen).toBe(200000)
    expect(april.expenseYen).toBe(1000)
    expect(april.balanceYen).toBe(199000)
    expect(april.transferYen).toBe(5000)
    expect(april.expenseByCategory).toEqual([{ categoryId: 'cat_food', amountYen: 1000 }])
    expect(summarizeMonth(ledger, '2026-05').expenseYen).toBe(0)
  })

  it('moves transfer amounts between accounts without counting them as spending', () => {
    let ledger = seedLedger()
    ledger = addTransaction(
      ledger,
      {
        date: '2026-04-02',
        amountYen: 5000,
        type: 'expense',
        categoryId: 'cat_food',
        accountId: 'acct_card',
        transferAccountId: null,
        description: '食費',
        memo: '',
      },
      clock('2026-04-02T00:00:00.000Z', 'tx-card'),
    )
    ledger = addTransaction(
      ledger,
      {
        date: '2026-04-10',
        amountYen: 5000,
        type: 'transfer',
        categoryId: null,
        accountId: 'acct_bank',
        transferAccountId: 'acct_card',
        description: '引落',
        memo: '',
      },
      clock('2026-04-10T00:00:00.000Z', 'tx-pay'),
    )
    const flows = Object.fromEntries(
      projectAccountBalances(ledger).map((flow) => [flow.accountId, flow.balanceYen]),
    )
    expect(flows.acct_card).toBe(0)
    expect(flows.acct_bank).toBe(-5000)
    expect(flows.acct_cash).toBe(0)
  })
})
