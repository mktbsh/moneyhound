import { describe, expect, it } from 'bun:test'
import { projectAccountBalances, summarizeMonth } from '../aggregate'
import { addAccount, seedLedger } from '../ledger'
import { applyImport } from './applyImport'
import { normalizeStatementDate, parseInstitutionCsv } from './institutionCsv'
import { getImporter } from './registry'

const clock = () => {
  let n = 0
  return { now: '2026-04-30T00:00:00.000Z', id: () => `new-${++n}` }
}

// Fictional rows. Layout follows a typical bank statement export.
const BANK = `日付,摘要,お引出し金額（円）,お預入れ金額（円）,差引残高（円）,メモ
2026/04/01,前月繰越,,,"120,000",
2026/04/02,カード ミドリ,"3,200",,"116,800",
2026/04/10,給与 サンプル商事,,"250,000","366,800",4月分
2026/04/10,ATM,"10,000",,"356,800",
2026/04/10,ATM,"10,000",,"346,800",
,合計,"23,200","250,000",,
`

// Fictional card statement with holder lines above the header.
const CARD = `カード名称,ミドリカード
お支払日,2026/05/27

ご利用日,ご利用店名,ご利用金額,支払区分,今回お支払金額
2026年4月3日,コンビニ ミドリ,580,1回,580
2026年4月5日,オンラインストア,"12,000",1回,"12,000"
2026年4月8日,返品 オンラインストア,-2000,1回,-2000
`

describe('normalizeStatementDate', () => {
  it('reads the date forms statements use', () => {
    expect(normalizeStatementDate('2026/4/2')).toBe('2026-04-02')
    expect(normalizeStatementDate('2026.04.02')).toBe('2026-04-02')
    expect(normalizeStatementDate('2026年4月2日')).toBe('2026-04-02')
    expect(normalizeStatementDate('20260402')).toBe('2026-04-02')
    expect(normalizeStatementDate('R8.4.2')).toBe('2026-04-02')
    expect(normalizeStatementDate('令和8年4月2日')).toBe('2026-04-02')
    expect(normalizeStatementDate('2026/04/02 13:45')).toBe('2026-04-02')
    expect(normalizeStatementDate('２０２６／４／２')).toBe('2026-04-02')
    expect(normalizeStatementDate('2026/02/30')).toBeNull()
    expect(normalizeStatementDate('前月繰越')).toBeNull()
  })
})

describe('parseInstitutionCsv', () => {
  it('reads withdrawal and deposit columns of a bank statement', () => {
    const parsed = parseInstitutionCsv(BANK, 'bank.csv', { accountName: 'ミドリ銀行' })
    expect(parsed.fileError).toBeUndefined()
    expect(parsed.errors).toEqual([])
    expect(parsed.transactions.map((row) => [row.date, row.type, row.amountYen])).toEqual([
      ['2026-04-02', 'expense', 3200],
      ['2026-04-10', 'income', 250000],
      ['2026-04-10', 'expense', 10000],
      ['2026-04-10', 'expense', 10000],
    ])
    expect(parsed.transactions[1]).toMatchObject({
      description: '給与 サンプル商事',
      memo: '4月分',
      accountName: 'ミドリ銀行',
      externalId: null,
      include: true,
    })
    // Same day, same amount, different running balance: two distinct rows.
    expect(parsed.transactions[2].contentHash).not.toBe(parsed.transactions[3].contentHash)
  })

  it('finds a card header below holder lines and reads positive amounts as spending', () => {
    const parsed = parseInstitutionCsv(CARD, 'card.csv', { accountName: 'ミドリカード' })
    expect(parsed.fileError).toBeUndefined()
    expect(parsed.errors).toEqual([])
    expect(parsed.transactions.map((row) => [row.description, row.type, row.amountYen])).toEqual([
      ['コンビニ ミドリ', 'expense', 580],
      ['オンラインストア', 'expense', 12000],
      ['返品 オンラインストア', 'income', 2000],
    ])
  })

  it('reads a single signed amount as the caller says', () => {
    const csv = `取引日,取引内容,金額\n2026/04/02,チャージ,3000\n2026/04/03,カフェ,-450\n`
    const bank = parseInstitutionCsv(csv, 'x.csv', { accountName: 'A' })
    expect(bank.transactions.map((row) => row.type)).toEqual(['income', 'expense'])
    const card = parseInstitutionCsv(csv, 'x.csv', {
      accountName: 'A',
      positiveAmountIs: 'expense',
    })
    expect(card.transactions.map((row) => row.type)).toEqual(['expense', 'income'])
  })

  it('joins split description columns', () => {
    const csv = `日付,摘要,摘要内容,支払い金額,預かり金額,差引残高\n2026/4/2,振込,ミドリ商店,"1,000",,"9,000"\n`
    const parsed = parseInstitutionCsv(csv, 'x.csv', { accountName: 'A' })
    expect(parsed.transactions[0]).toMatchObject({
      description: '振込 ミドリ商店',
      type: 'expense',
      amountYen: 1000,
    })
  })

  it('reports a bad date and refuses a file without a header or an account', () => {
    const bad = parseInstitutionCsv('日付,内容,金額\n4月2日,x,100\n', 'x.csv', {
      accountName: 'A',
    })
    expect(bad.errors).toEqual([{ line: 2, message: '日付の形式が正しくありません' }])
    expect(parseInstitutionCsv('a,b\n1,2\n', 'x.csv', { accountName: 'A' }).fileError).toContain(
      '見出し行',
    )
    expect(parseInstitutionCsv(BANK, 'x.csv').fileError).toBe('取り込み先の口座を選んでください。')
    expect(parseInstitutionCsv('', 'x.csv', { accountName: 'A' }).fileError).toBe(
      'ファイルが空です。',
    )
  })

  it('decodes bytes through the registered adapter', () => {
    const importer = getImporter('institution-csv')
    const parsed = importer!.parse({
      bytes: new TextEncoder().encode(`﻿${CARD}`),
      fileName: 'card.csv',
      accountName: 'ミドリカード',
      positiveAmountIs: 'expense',
    })
    expect(parsed.adapterId).toBe('institution-csv')
    expect(parsed.transactions).toHaveLength(3)
  })
})

describe('applyImport with an institution CSV', () => {
  it('books rows on the chosen account and does not duplicate them on re-import', () => {
    const base = addAccount(seedLedger(), { name: 'ミドリ銀行', kind: 'bank' }, clock())
    const account = base.accounts.find((item) => item.name === 'ミドリ銀行')!
    const parsed = parseInstitutionCsv(BANK, 'bank.csv', { accountName: 'ミドリ銀行' })
    const first = applyImport(base, parsed, clock())
    expect(first.report).toMatchObject({ inserted: 4, updated: 0, unchanged: 0 })
    expect(first.ledger.accounts).toHaveLength(base.accounts.length)
    expect(
      first.ledger.transactions.every(
        (row) => row.accountId === account.id && row.source.sourceId === 'src_institution-csv',
      ),
    ).toBe(true)
    expect(first.ledger.importSources.find((item) => item.id === 'src_institution-csv')?.name).toBe(
      '金融機関CSV',
    )
    const april = summarizeMonth(first.ledger, '2026-04')
    expect(april).toMatchObject({ incomeYen: 250000, expenseYen: 23200 })
    const balance = projectAccountBalances(first.ledger).find(
      (item) => item.accountId === account.id,
    )
    expect(balance?.balanceYen).toBe(250000 - 23200)

    const again = applyImport(first.ledger, parsed, clock())
    expect(again.report).toMatchObject({ inserted: 0, updated: 0, unchanged: 4 })
    expect(again.ledger.transactions).toHaveLength(4)
  })
})
