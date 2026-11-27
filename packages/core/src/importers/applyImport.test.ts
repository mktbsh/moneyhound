import { describe, expect, it } from 'bun:test'
import { projectAccountBalances, summarizeMonth } from '../aggregate'
import {
  fillTransferSides,
  groupUnresolvedTransfers,
  seedLedger,
  setTransferAccounts,
  unresolvedTransfers,
} from '../ledger'
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
    const move = fourth.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-move',
    )
    expect(move?.type).toBe('transfer')
    expect(move?.transferAccountId).toBeNull()
  })

  it('pairs both sides of a Money Forward transfer and ignores a lone row', () => {
    const csv = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/04,口座振替,-20000,銀行口座,未分類,未分類,,1,mf-out
1,2026/04/04,口座振替,20000,クレジットカード,未分類,未分類,,1,mf-in
1,2026/04/05,カード引落,-3000,銀行口座,未分類,未分類,,1,mf-lone
1,2026/04/02,コンビニ,-580,現金,食費,食料品,昼食,,mf-food
`
    const parsed = parseMfCsv(csv, 'mf.csv')
    const first = applyImport(seedLedger(), parsed, clock())
    expect(first.report).toMatchObject({ inserted: 3, paired: 1, skipped: 0 })
    const transfers = first.ledger.transactions.filter(
      (transaction) => transaction.type === 'transfer',
    )
    expect(transfers).toHaveLength(2)
    const paired = transfers.find((transaction) => transaction.source.externalId === 'mf-out')
    const lone = transfers.find((transaction) => transaction.source.externalId === 'mf-lone')
    const bank = first.ledger.accounts.find((account) => account.name === '銀行口座')
    const card = first.ledger.accounts.find((account) => account.name === 'クレジットカード')
    expect(paired?.accountId).toBe(bank?.id)
    expect(paired?.transferAccountId).toBe(card?.id)
    expect(lone?.transferAccountId).toBeNull()
    expect(
      first.ledger.transactions.some((transaction) => transaction.source.externalId === 'mf-in'),
    ).toBe(false)
    const april = summarizeMonth(first.ledger, '2026-04')
    expect(april.expenseYen).toBe(580)
    expect(april.transferYen).toBe(23000)
    const flows = Object.fromEntries(
      projectAccountBalances(first.ledger).map((flow) => [flow.accountId, flow]),
    )
    expect(flows[bank!.id]?.transferOutYen).toBe(23000)
    expect(flows[card!.id]?.transferInYen).toBe(20000)
    expect(
      projectAccountBalances(first.ledger).reduce(
        (sum, flow) => sum + flow.transferInYen - flow.transferOutYen,
        0,
      ),
    ).toBe(-3000)

    const second = applyImport(first.ledger, parsed, clock())
    expect(second.report.inserted).toBe(0)
    expect(second.report.paired).toBe(1)
    expect(
      second.ledger.transactions.filter((transaction) => transaction.deletedAt === null),
    ).toHaveLength(
      first.ledger.transactions.filter((transaction) => transaction.deletedAt === null).length,
    )
    expect(
      second.ledger.transactions.find((transaction) => transaction.source.externalId === 'mf-out')
        ?.transferAccountId,
    ).toBe(card?.id)
  })

  it('credits a lone inflow and debits a lone outflow', () => {
    const csv = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/06,給料日の移動,8000,銀行口座,未分類,未分類,,1,mf-in
1,2026/04/07,引き出し,-1500,現金,未分類,未分類,,1,mf-out
`
    const parsed = parseMfCsv(csv, 'mf.csv')
    const first = applyImport(seedLedger(), parsed, clock())
    const inflow = first.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-in',
    )
    const outflow = first.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-out',
    )
    const bank = first.ledger.accounts.find((account) => account.name === '銀行口座')
    const cash = first.ledger.accounts.find((account) => account.name === '現金')
    expect(inflow?.accountId).toBeNull()
    expect(inflow?.transferAccountId).toBe(bank?.id)
    expect(outflow?.accountId).toBe(cash?.id)
    expect(outflow?.transferAccountId).toBeNull()
    const april = summarizeMonth(first.ledger, '2026-04')
    expect(april.incomeYen).toBe(0)
    expect(april.expenseYen).toBe(0)
    const flows = Object.fromEntries(
      projectAccountBalances(first.ledger).map((flow) => [flow.accountId, flow]),
    )
    expect(flows[bank!.id]?.transferInYen).toBe(8000)
    expect(flows[bank!.id]?.balanceYen).toBe(8000)
    expect(flows[cash!.id]?.transferOutYen).toBe(1500)
    expect(flows[cash!.id]?.balanceYen).toBe(-1500)
    const second = applyImport(first.ledger, parsed, clock())
    expect(second.report.inserted).toBe(0)
    expect(second.report.updated).toBe(0)
    expect(
      second.ledger.transactions.find((transaction) => transaction.source.externalId === 'mf-in')
        ?.transferAccountId,
    ).toBe(bank?.id)
  })

  it('uses an existing account when a lone transfer description names it', () => {
    const csv = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/10,現金,-4000,銀行口座,未分類,未分類,,1,mf-cash
`
    const result = applyImport(seedLedger(), parseMfCsv(csv, 'mf.csv'), clock())
    const row = result.ledger.transactions.find(
      (transaction) => transaction.source.externalId === 'mf-cash',
    )
    expect(row?.transferAccountId).toBe('acct_cash')
  })
})

describe('fixing one-sided imported transfers', () => {
  const LONE = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/04,カード引落,-20000,銀行口座,未分類,未分類,,1,mf-out
1,2026/04/05,入金,5000,現金,未分類,未分類,,1,mf-in
`

  it('lists both rows, keeps the chosen side through re-import, and validates input', () => {
    const parsed = parseMfCsv(LONE, 'mf.csv')
    const imported = applyImport(seedLedger(), parsed, clock()).ledger
    const open = unresolvedTransfers(imported)
    expect(open.map((row) => row.source.externalId).sort()).toEqual(['mf-in', 'mf-out'])

    const out = open.find((row) => row.source.externalId === 'mf-out')!
    const inflow = open.find((row) => row.source.externalId === 'mf-in')!
    const fixClock = { now: '2026-04-09T00:00:00.000Z', id: () => 'unused' }
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
    const fixedOut = fixed.transactions.find((row) => row.id === out.id)!
    expect(fixedOut).toMatchObject({
      accountId: 'acct_bank',
      transferAccountId: 'acct_card',
      revision: out.revision + 1,
      updatedAt: fixClock.now,
      source: out.source,
    })
    // The bank sent 20000 to the card and 5000 to cash.
    const balances = new Map(
      projectAccountBalances(fixed).map((item) => [item.accountId, item.balanceYen]),
    )
    expect(balances.get('acct_card')).toBe(20000)
    expect(balances.get('acct_bank')).toBe(-25000)

    const again = applyImport(fixed, parsed, clock())
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
})

describe('grouped fixes for one-sided transfers', () => {
  const MONTHLY = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
0,2026/01/27,ミドリカード,-30000,銀行口座,未分類,未分類,,1,m1
0,2026/02/27,ミドリカード,-28000,銀行口座,未分類,未分類,,1,m2
0,2026/03/27,ﾐﾄﾞﾘｶｰﾄﾞ,-31000,銀行口座,未分類,未分類,,1,m3
0,2026/03/10,ATM,-10000,銀行口座,未分類,未分類,,1,m4
0,2026/03/11,入金,5000,現金,未分類,未分類,,1,m5
`

  it('groups by side, account, and folded description and fills a group at once', () => {
    const ledger = applyImport(seedLedger(), parseMfCsv(MONTHLY, 'mf.csv'), clock()).ledger
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
    const fixClock = { now: '2026-04-09T00:00:00.000Z', id: () => 'unused' }
    const fixed = fillTransferSides(
      ledger,
      card.transactions.map((row) => row.id),
      'acct_card',
      fixClock,
    )
    expect(unresolvedTransfers(fixed)).toHaveLength(2)
    expect(
      fixed.transactions
        .filter((row) => card.transactions.some((item) => item.id === row.id))
        .every((row) => row.accountId === 'acct_bank' && row.transferAccountId === 'acct_card'),
    ).toBe(true)

    const inflow = groups[1]
    const both = fillTransferSides(
      fixed,
      inflow.transactions.map((row) => row.id),
      'acct_bank',
      fixClock,
    )
    expect(both.transactions.find((row) => row.id === inflow.transactions[0].id)).toMatchObject({
      accountId: 'acct_bank',
      transferAccountId: 'acct_cash',
    })

    // The account on the set side cannot also be the missing side.
    expect(() =>
      fillTransferSides(
        ledger,
        card.transactions.map((row) => row.id),
        'acct_bank',
        fixClock,
      ),
    ).toThrow('invalid_transfer')
    expect(() =>
      fillTransferSides(
        ledger,
        card.transactions.map((row) => row.id),
        'missing',
        fixClock,
      ),
    ).toThrow('invalid_account')

    const again = applyImport(both, parseMfCsv(MONTHLY, 'mf.csv'), clock())
    expect(again.report).toMatchObject({ inserted: 0, updated: 0 })
    expect(unresolvedTransfers(again.ledger)).toHaveLength(1)
  })
})
