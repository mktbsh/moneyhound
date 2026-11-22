import { yearMonthOf } from './dates'
import type { Ledger, Transaction } from './types'

export interface CategoryTotal {
  categoryId: string | null
  amountYen: number
}

export interface MonthSummary {
  yearMonth: string
  incomeYen: number
  expenseYen: number
  /** Income minus expense. Transfers are not included. */
  balanceYen: number
  transferYen: number
  expenseByCategory: CategoryTotal[]
  incomeByCategory: CategoryTotal[]
}

export interface AccountFlow {
  accountId: string
  incomeYen: number
  expenseYen: number
  transferInYen: number
  transferOutYen: number
  /** Opening balance plus income minus expense plus transfers in minus transfers out. */
  balanceYen: number
}

function active(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.deletedAt === null)
}

function addAmount(totals: Map<string | null, number>, categoryId: string | null, amount: number) {
  totals.set(categoryId, (totals.get(categoryId) ?? 0) + amount)
}

function sortedTotals(totals: Map<string | null, number>): CategoryTotal[] {
  return [...totals.entries()]
    .map(([categoryId, amountYen]) => ({ categoryId, amountYen }))
    .sort(
      (a, b) => b.amountYen - a.amountYen || (a.categoryId ?? '').localeCompare(b.categoryId ?? ''),
    )
}

export function summarizeMonth(ledger: Ledger, yearMonth: string): MonthSummary {
  const expense = new Map<string | null, number>()
  const income = new Map<string | null, number>()
  let incomeYen = 0
  let expenseYen = 0
  let transferYen = 0

  for (const transaction of active(ledger.transactions)) {
    if (yearMonthOf(transaction.date) !== yearMonth) continue
    if (transaction.type === 'income') {
      incomeYen += transaction.amountYen
      addAmount(income, transaction.categoryId, transaction.amountYen)
    } else if (transaction.type === 'expense') {
      expenseYen += transaction.amountYen
      addAmount(expense, transaction.categoryId, transaction.amountYen)
    } else {
      transferYen += transaction.amountYen
    }
  }

  return {
    yearMonth,
    incomeYen,
    expenseYen,
    balanceYen: incomeYen - expenseYen,
    transferYen,
    expenseByCategory: sortedTotals(expense),
    incomeByCategory: sortedTotals(income),
  }
}

/**
 * Account balances for a later asset screen.
 * A transfer debits `accountId` and credits `transferAccountId`.
 * A null destination only debits the source.
 * An imported inflow with an unknown source stores the same account in both
 * fields. That account is credited and not debited. `addTransaction` rejects
 * that shape; only import writes it.
 */
export function projectAccountBalances(ledger: Ledger): AccountFlow[] {
  return ledger.accounts
    .filter((account) => account.deletedAt === null)
    .map((account) => {
      let incomeYen = 0
      let expenseYen = 0
      let transferInYen = 0
      let transferOutYen = 0
      for (const transaction of active(ledger.transactions)) {
        if (transaction.type === 'income' && transaction.accountId === account.id) {
          incomeYen += transaction.amountYen
        } else if (transaction.type === 'expense' && transaction.accountId === account.id) {
          expenseYen += transaction.amountYen
        } else if (
          transaction.type === 'transfer' &&
          transaction.accountId === account.id &&
          transaction.transferAccountId !== account.id
        ) {
          transferOutYen += transaction.amountYen
        } else if (
          transaction.type === 'transfer' &&
          transaction.transferAccountId === account.id
        ) {
          transferInYen += transaction.amountYen
        }
      }
      const opening = account.openingBalanceYen ?? 0
      return {
        accountId: account.id,
        incomeYen,
        expenseYen,
        transferInYen,
        transferOutYen,
        balanceYen: opening + incomeYen - expenseYen + transferInYen - transferOutYen,
      }
    })
}
