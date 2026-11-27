import { describe, expect, it } from 'bun:test'
import { projectAccountBalances, summarizeMonth } from '../aggregate'
import {
  fillTransferSides,
  groupUnresolvedTransfers,
  seedLedger,
  setTransferAccounts,
  unresolvedTransfers,
} from '../ledger'
import type { CategoryRule } from '../types'
import { applyImport } from './applyImport'
import type { ImportParseResult, NormalizedTransaction } from './types'

const clock = () => {
  let n = 0
  return { now: '2026-04-08T00:00:00.000Z', id: () => `new-${++n}` }
}

const fixClock = { now: '2026-04-09T00:00:00.000Z', id: () => 'unused' }

/** Fictional normalized row. Signed amount: negative leaves the account. */
function row(
  externalId: string,
  date: string,
  signed: number,
  accountName: string,
  description: string,
  extra: Partial<NormalizedTransaction> = {},
): NormalizedTransaction {
  const type = extra.type ?? (signed > 0 ? 'income' : 'expense')
  return {
    date,
    amountYen: Math.abs(signed),
    amountSign: signed > 0 ? 1 : -1,
    type,
    description,
    memo: '',
    categoryLarge: null,
    categoryMiddle: null,
    accountName,
    externalId,
    contentHash: `${externalId}-hash`,
    include: true,
    ...extra,
  }
}

function file(rows: NormalizedTransaction[]): ImportParseResult {
  return { adapterId: 'test-csv', fileName: 'fixture.csv', transactions: rows, errors: [] }
}

const cafeRule: CategoryRule = {
  id: 'rule-cafe',
  enabled: true,
  priority: 0,
  operator: 'contains',
  pattern: 'スターバックス',
  sourceId: 'test-csv',
  accountId: null,
  categoryId: 'cat_leisure',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 1,
  deletedAt: null,
}

describe('applyImport', () => {
  const rows = [
    row('food', '2026-04-02', -580, '現金', 'コンビニ', {
      categoryLarge: '食費',
      categoryMiddle: '食料品',
    }),
    row('pay', '2026-04-03', 200000, '銀行口座', '給与', { categoryLarge: '給与' }),
    row('cafe', '2026-04-05', -450, '現金', 'スターバックス'),
    row('skip', '2026-04-06', -10, '現金', '対象外', { include: false }),
  ]

  it('inserts once, reapplies without duplicates, and keeps user categories', () => {
    const base = { ...seedLedger(), categoryRules: [cafeRule] }
    const first = applyImport(base, file(rows), clock())
    expect(first.report).toEqual({
      inserted: 3,
      updated: 0,
      unchanged: 0,
      excluded: 0,
      skipped: 1,
    })
    const food = first.ledger.transactions.find((item) => item.source.externalId === 'food')!
    const middle = first.ledger.categories.find((category) => category.id === food.categoryId)!
    expect(food.categoryOrigin).toBe('import')
    expect(middle.name).toBe('食料品')
    expect(middle.parentId).toBe('cat_food')
    const cafe = first.ledger.transactions.find((item) => item.source.externalId === 'cafe')!
    expect(cafe.categoryId).toBe('cat_leisure')
    expect(cafe.categoryOrigin).toBe('rule')
    expect(summarizeMonth(first.ledger, '2026-04')).toMatchObject({
      incomeYen: 200000,
      expenseYen: 580 + 450,
    })

    const again = applyImport(first.ledger, file(rows), clock())
    expect(again.report).toMatchObject({ inserted: 0, updated: 0, unchanged: 3 })

    const locked = {
      ...first.ledger,
      transactions: first.ledger.transactions.map((item) =>
        item.id === food.id
          ? { ...item, categoryId: 'cat_daily', categoryOrigin: 'user' as const }
          : item,
      ),
    }
    const changed = rows.map((item) =>
      item.externalId === 'food' ? { ...item, amountYen: 600 } : item,
    )
    const second = applyImport(locked, file(changed), clock())
    expect(second.report).toMatchObject({ updated: 1, unchanged: 2 })
    const foodAgain = second.ledger.transactions.find((item) => item.id === food.id)!
    expect(foodAgain.amountYen).toBe(600)
    expect(foodAgain.categoryId).toBe('cat_daily')

    const excluded = changed.map((item) =>
      item.externalId === 'food' ? { ...item, include: false } : item,
    )
    const third = applyImport(second.ledger, file(excluded), clock())
    expect(third.report.excluded).toBe(1)
    expect(third.ledger.transactions.find((item) => item.id === food.id)?.deletedAt).toBe(
      '2026-04-08T00:00:00.000Z',
    )
    const fourth = applyImport(third.ledger, file(excluded), clock())
    expect(fourth.report.skipped).toBe(2)
    expect(
      fourth.ledger.transactions.filter((item) => item.source.externalId === 'food'),
    ).toHaveLength(1)
  })

  it('books a transfer one-sided: an outflow debits, an inflow credits', () => {
    const transfers = [
      row('out', '2026-04-07', -1500, '現金', '引き出し', { type: 'transfer' }),
      row('in', '2026-04-06', 8000, '銀行口座', '移動', { type: 'transfer' }),
    ]
    const first = applyImport(seedLedger(), file(transfers), clock())
    const outflow = first.ledger.transactions.find((item) => item.source.externalId === 'out')!
    const inflow = first.ledger.transactions.find((item) => item.source.externalId === 'in')!
    expect(outflow).toMatchObject({ accountId: 'acct_cash', transferAccountId: null })
    expect(inflow).toMatchObject({ accountId: null, transferAccountId: 'acct_bank' })
    expect(summarizeMonth(first.ledger, '2026-04')).toMatchObject({
      incomeYen: 0,
      expenseYen: 0,
      transferYen: 9500,
    })
    const balances = new Map(
      projectAccountBalances(first.ledger).map((flow) => [flow.accountId, flow.balanceYen]),
    )
    expect(balances.get('acct_cash')).toBe(-1500)
    expect(balances.get('acct_bank')).toBe(8000)
    const second = applyImport(first.ledger, file(transfers), clock())
    expect(second.report).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 })
  })
})

describe('fixing one-sided transfers', () => {
  const transfers = [
    row('out', '2026-04-04', -20000, '銀行口座', 'カード引落', { type: 'transfer' }),
    row('in', '2026-04-05', 5000, '現金', '入金', { type: 'transfer' }),
  ]

  it('keeps the chosen side through re-import and validates input', () => {
    const imported = applyImport(seedLedger(), file(transfers), clock()).ledger
    const open = unresolvedTransfers(imported)
    expect(open.map((item) => item.source.externalId).sort()).toEqual(['in', 'out'])
    const out = open.find((item) => item.source.externalId === 'out')!
    const inflow = open.find((item) => item.source.externalId === 'in')!

    let fixed = setTransferAccounts(
      imported,
      out.id,
      { accountId: out.accountId, transferAccountId: 'acct_card' },
      fixClock,
    )
    fixed = setTransferAccounts(
      fixed,
      inflow.id,
      { accountId: 'acct_bank', transferAccountId: inflow.transferAccountId },
      fixClock,
    )
    expect(unresolvedTransfers(fixed)).toEqual([])
    expect(fixed.transactions.find((item) => item.id === out.id)).toMatchObject({
      accountId: 'acct_bank',
      transferAccountId: 'acct_card',
      revision: out.revision + 1,
      updatedAt: fixClock.now,
      source: out.source,
    })
    const balances = new Map(
      projectAccountBalances(fixed).map((flow) => [flow.accountId, flow.balanceYen]),
    )
    expect(balances.get('acct_card')).toBe(20000)
    expect(balances.get('acct_bank')).toBe(-25000)

    const again = applyImport(fixed, file(transfers), clock())
    expect(again.report).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 })
    expect(unresolvedTransfers(again.ledger)).toEqual([])

    expect(() =>
      setTransferAccounts(
        fixed,
        out.id,
        { accountId: 'acct_bank', transferAccountId: 'acct_bank' },
        fixClock,
      ),
    ).toThrow('invalid_transfer')
    expect(() =>
      setTransferAccounts(fixed, out.id, { accountId: null, transferAccountId: null }, fixClock),
    ).toThrow('invalid_transfer')
    expect(() =>
      setTransferAccounts(
        fixed,
        out.id,
        { accountId: 'acct_bank', transferAccountId: 'missing' },
        fixClock,
      ),
    ).toThrow('invalid_account')
    expect(
      setTransferAccounts(
        fixed,
        out.id,
        { accountId: 'acct_bank', transferAccountId: 'acct_card' },
        fixClock,
      ),
    ).toBe(fixed)
  })

  it('groups by side, account, and folded description and fills a group at once', () => {
    const monthly = [
      row('m1', '2026-01-27', -30000, '銀行口座', 'ミドリカード', { type: 'transfer' }),
      row('m2', '2026-02-27', -28000, '銀行口座', 'ミドリカード', { type: 'transfer' }),
      row('m3', '2026-03-27', -31000, '銀行口座', 'ﾐﾄﾞﾘｶｰﾄﾞ', { type: 'transfer' }),
      row('m4', '2026-03-10', -10000, '銀行口座', 'ATM', { type: 'transfer' }),
      row('m5', '2026-03-11', 5000, '現金', '入金', { type: 'transfer' }),
    ]
    const ledger = applyImport(seedLedger(), file(monthly), clock()).ledger
    const groups = groupUnresolvedTransfers(ledger)
    expect(groups.map((group) => [group.missing, group.transactions.length])).toEqual([
      ['destination', 3],
      ['source', 1],
      ['destination', 1],
    ])
    const card = groups[0]
    expect(card).toMatchObject({
      knownAccountId: 'acct_bank',
      totalYen: 89000,
      firstDate: '2026-01-27',
      lastDate: '2026-03-27',
    })
    const ids = card.transactions.map((item) => item.id)
    const fixed = fillTransferSides(ledger, ids, 'acct_card', fixClock)
    expect(unresolvedTransfers(fixed)).toHaveLength(2)
    expect(
      fixed.transactions
        .filter((item) => ids.includes(item.id))
        .every((item) => item.accountId === 'acct_bank' && item.transferAccountId === 'acct_card'),
    ).toBe(true)

    const inflow = groups[1]
    const both = fillTransferSides(
      fixed,
      inflow.transactions.map((item) => item.id),
      'acct_bank',
      fixClock,
    )
    expect(both.transactions.find((item) => item.id === inflow.transactions[0].id)).toMatchObject({
      accountId: 'acct_bank',
      transferAccountId: 'acct_cash',
    })

    // The account on the set side cannot also be the missing side.
    expect(() => fillTransferSides(ledger, ids, 'acct_bank', fixClock)).toThrow('invalid_transfer')
    expect(() => fillTransferSides(ledger, ids, 'missing', fixClock)).toThrow('invalid_account')

    const again = applyImport(both, file(monthly), clock())
    expect(again.report).toMatchObject({ inserted: 0, updated: 0 })
    expect(unresolvedTransfers(again.ledger)).toHaveLength(1)
  })
})
