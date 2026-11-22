import { describe, expect, it } from 'vitest'
import { summarizeMonth } from '../aggregate'
import { seedLedger } from '../ledger'
import { applyImport } from './applyImport'
import { parseMfCsv } from './mfCsv'

const clock = () => {
  let n = 0
  return { now: '2026-04-08T00:00:00.000Z', id: () => `new-${++n}` }
}

const CSV = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/02,コンビニ,-580,現金,食費,食料品,昼食,,mf-food
1,2026/04/03,給与,200000,銀行口座,給与,未分類,,,mf-pay
1,2026/04/04,カード引落,-20000,銀行口座,未分類,未分類,,1,mf-move
1,2026/04/05,スターバックス,-450,現金,未分類,未分類,,,mf-cafe
0,2026/04/06,対象外,-10,現金,食費,未分類,,,mf-skip
`

describe('applyImport', () => {
  it('inserts once, reapplies without duplicates, and keeps user categories', () => {
    const parsed = parseMfCsv(CSV, 'mf.csv')
    const rules = seedLedger()
    const withRule = {
      ...rules,
      categoryRules: [
        {
          id: 'rule-cafe',
          enabled: true,
          priority: 0,
          operator: 'contains' as const,
          pattern: 'スターバックス',
          sourceId: 'mf-csv',
          accountId: null,
          categoryId: 'cat_leisure',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          revision: 1,
          deletedAt: null,
        },
      ],
    }
    const first = applyImport(withRule, parsed, clock())
    expect(first.report).toMatchObject({ inserted: 4, unchanged: 0, excluded: 0, skipped: 1 })
    const food = first.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-food',
    )
    expect(food?.categoryOrigin).toBe('import')
    expect(first.ledger.categories.find((category) => category.id === food?.categoryId)?.name).toBe(
      '食料品',
    )
    expect(
      first.ledger.categories.find((category) => category.id === food?.categoryId)?.parentId,
    ).toBe('cat_food')
    const cafe = first.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-cafe',
    )
    expect(cafe?.categoryId).toBe('cat_leisure')
    expect(cafe?.categoryOrigin).toBe('rule')
    const april = summarizeMonth(first.ledger, '2026-04')
    expect(april.incomeYen).toBe(200000)
    expect(april.expenseYen).toBe(580 + 450)
    expect(april.transferYen).toBe(20000)

    const locked = {
      ...first.ledger,
      transactions: first.ledger.transactions.map((transaction) =>
        transaction.source.externalId === 'mf-food'
          ? { ...transaction, categoryId: 'cat_daily', categoryOrigin: 'user' as const }
          : transaction,
      ),
    }
    const changed = parseMfCsv(CSV.replace('-580', '-600'), 'mf.csv')
    const second = applyImport(locked, changed, clock())
    expect(second.report.updated).toBe(1)
    expect(second.report.unchanged).toBe(3)
    const foodAgain = second.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-food',
    )
    expect(foodAgain?.amountYen).toBe(600)
    expect(foodAgain?.categoryId).toBe('cat_daily')

    const excluded = parseMfCsv(
      CSV.replace('-580', '-600').replace('1,2026/04/02', '0,2026/04/02'),
      'mf.csv',
    )
    const third = applyImport(second.ledger, excluded, clock())
    expect(third.report.excluded).toBe(1)
    expect(
      third.ledger.transactions.find((transaction) => transaction.source.externalId === 'mf-food')
        ?.deletedAt,
    ).toBe('2026-04-08T00:00:00.000Z')
    const fourth = applyImport(third.ledger, excluded, clock())
    expect(fourth.report.skipped).toBeGreaterThan(0)
    expect(
      fourth.ledger.transactions.filter(
        (transaction) => transaction.source.externalId === 'mf-food',
      ),
    ).toHaveLength(1)
  })
})
