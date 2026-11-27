import { describe, expect, it } from 'bun:test'
import { decodeCsvBytes } from './encoding'
import { parseMfCsv } from './mfCsv'
import { mfCsvImporter } from './registry'

const CSV = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/02,コンビニ,-580,現金,食費,食料品,"昼,食",,mf-food
1,2026/04/03,給与,200000,銀行口座,給与,未分類,,,mf-pay
1,2026/04/04,カード引落,-20000,銀行口座,未分類,未分類,,1,mf-move
0,2026/04/05,対象外,-10,現金,食費,未分類,,,mf-skip
1,2026/02/31,壊れた日付,-10,現金,食費,未分類,,,mf-bad
`

describe('Money Forward CSV', () => {
  it('normalizes income, expense, transfer, and excluded rows', () => {
    const parsed = parseMfCsv(CSV, 'sample.csv')
    expect(parsed.fileError).toBeUndefined()
    expect(parsed.errors.map((error) => error.message)).toEqual(['日付の形式が正しくありません'])
    const food = parsed.transactions.find((row) => row.externalId === 'mf-food')
    expect(food).toMatchObject({
      date: '2026-04-02',
      amountYen: 580,
      type: 'expense',
      description: 'コンビニ',
      memo: '昼,食',
      categoryLarge: '食費',
      categoryMiddle: '食料品',
      accountName: '現金',
      include: true,
    })
    expect(parsed.transactions.find((row) => row.externalId === 'mf-pay')).toMatchObject({
      type: 'income',
      amountYen: 200000,
      categoryMiddle: null,
    })
    expect(parsed.transactions.find((row) => row.externalId === 'mf-move')).toMatchObject({
      type: 'transfer',
      amountYen: 20000,
      amountSign: -1,
      accountName: '銀行口座',
    })
    expect(food?.amountSign).toBe(-1)
    expect(parsed.transactions.find((row) => row.externalId === 'mf-pay')?.amountSign).toBe(1)
    expect(parsed.transactions.find((row) => row.externalId === 'mf-skip')?.include).toBe(false)
  })

  it('books MF rows with no account (なし) on 現金', () => {
    const csv = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/04,手入力,-300,なし,食費,未分類,,0,mf-none
1,2026/04/06,手入力,-100,,食費,未分類,,0,mf-blank
`
    const rows = parseMfCsv(csv, 'mf.csv').transactions
    expect(rows.map((row) => row.accountName)).toEqual(['現金', null])
  })

  it('keeps transfers even though Money Forward marks them 計算対象=0', () => {
    const csv = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
0,2026/04/04,カード引落,-20000,銀行口座,未分類,未分類,,1,mf-out
0,2026/04/04,入金,20000,クレジットカード,未分類,未分類,,1,mf-in
0,2026/04/05,対象外の支出,-300,現金,食費,未分類,,0,mf-off
`
    const rows = parseMfCsv(csv, 'mf.csv').transactions
    expect(rows.map((row) => [row.externalId, row.type, row.include])).toEqual([
      ['mf-out', 'transfer', true],
      ['mf-in', 'transfer', true],
      ['mf-off', 'expense', false],
    ])
  })

  it('rejects a file that is not the income/expense detail export', () => {
    const parsed = parseMfCsv('日付,金額\n2026-01-01,10\n', 'other.csv')
    expect(parsed.fileError).toContain('収入・支出詳細')
  })

  it('decodes Shift_JIS bytes through the adapter', () => {
    const bytes = Uint8Array.from([
      147, 250, 149, 116, 44, 147, 224, 151, 101, 44, 139, 224, 138, 122, 129, 105, 137, 126, 129,
      106, 44, 73, 68, 10, 50, 48, 50, 54, 47, 48, 49, 47, 48, 50, 44, 144, 72, 131, 112, 131, 147,
      44, 45, 49, 57, 56, 44, 109, 102, 45, 49, 10,
    ])
    expect(decodeCsvBytes(bytes).encoding).toBe('shift_jis')
    const parsed = mfCsvImporter.parse({ bytes, fileName: 'sjis.csv' })
    expect(parsed.transactions[0]).toMatchObject({
      description: '食パン',
      amountYen: 198,
      type: 'expense',
      externalId: 'mf-1',
    })
  })
})
