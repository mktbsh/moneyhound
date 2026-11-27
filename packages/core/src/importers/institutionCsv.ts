import { normalizeDate, isIsoDate } from '../dates'
import { contentHash } from '../hash'
import { parseYen } from '../money'
import { normalizeHeader } from '../text'
import type { TransactionType } from '../types'
import { parseCsv } from './csv'
import type { ImportParseResult, NormalizedTransaction } from './types'

export const INSTITUTION_CSV_ADAPTER_ID = 'institution-csv'

/**
 * Header names seen in official statement CSVs from Japanese banks, card
 * issuers, and e-money services. Matching is NFKC-normalized, ignores spaces
 * and quotes, and drops a trailing (円), so 「お引出し金額（円）」 matches
 * 「お引出し金額」. Order is priority within a group.
 *
 * Fixtures are fictional. No real statement was used to write this table.
 */
const ALIASES = {
  date: [
    '日付',
    '年月日',
    '取引日',
    'お取引日',
    '取扱日',
    'お取扱日',
    '取引年月日',
    '入出金日',
    '利用日',
    'ご利用日',
    '利用年月日',
    'ご利用年月日',
  ],
  description: [
    '摘要',
    '摘要内容',
    '内容',
    '取引内容',
    'お取引内容',
    '取扱内容',
    'お取り扱い内容',
    'お取扱内容',
    '利用店名',
    'ご利用店名',
    '利用店名・商品名',
    'ご利用店名・商品名',
    '利用先',
    'ご利用先',
    '店名',
    '取引先',
    '明細',
  ],
  withdrawal: [
    '出金',
    '出金額',
    '出金金額',
    'お引出し',
    'お引出',
    'お引出し金額',
    '引出額',
    '支払い金額',
    '支払金額',
    'お支払金額',
  ],
  deposit: [
    '入金',
    '入金額',
    '入金金額',
    'お預入れ',
    'お預入',
    'お預入れ金額',
    '預入額',
    '預かり金額',
    'お預り金額',
    'お預かり金額',
  ],
  amount: [
    '利用金額',
    'ご利用金額',
    '金額',
    '取引金額',
    'お取引金額',
    '支払い金額',
    '支払金額',
    'お支払金額',
  ],
  balance: ['残高', '差引残高', '取引後残高', 'お取引後残高', '現在高'],
  memo: ['メモ', '備考'],
} as const

type Group = keyof typeof ALIASES

/** How far down to look for the header. Card statements put the holder and card on top. */
const HEADER_SCAN_ROWS = 30

function key(value: string): string {
  return normalizeHeader(value).replace(/\(円\)$/, '')
}

const ALIAS_KEYS = Object.fromEntries(
  (Object.keys(ALIASES) as Group[]).map((group) => [group, ALIASES[group].map(key)]),
) as Record<Group, string[]>

interface Layout {
  headerRow: number
  date: number
  description: number[]
  withdrawal: number
  deposit: number
  amount: number
  balance: number
  memo: number
  /** The header looks like a card or e-money statement (利用日 / 利用金額 / 利用店名). */
  usageStyle: boolean
}

function firstIndex(header: string[], group: Group, taken: Set<number>): number {
  for (const alias of ALIAS_KEYS[group]) {
    const index = header.findIndex((cell, position) => cell === alias && !taken.has(position))
    if (index >= 0) return index
  }
  return -1
}

function layoutOf(row: string[], headerRow: number): Layout | null {
  const header = row.map(key)
  const taken = new Set<number>()
  const claim = (group: Group): number => {
    const index = firstIndex(header, group, taken)
    if (index >= 0) taken.add(index)
    return index
  }
  const date = claim('date')
  if (date < 0) return null
  const deposit = claim('deposit')
  // 支払金額 is a withdrawal next to a deposit column and a single amount otherwise.
  const withdrawal = deposit >= 0 ? claim('withdrawal') : -1
  const amount = withdrawal >= 0 || deposit >= 0 ? -1 : claim('amount')
  if (amount < 0 && withdrawal < 0 && deposit < 0) return null
  const description: number[] = []
  for (;;) {
    const index = claim('description')
    if (index < 0) break
    description.push(index)
  }
  description.sort((a, b) => a - b)
  return {
    headerRow,
    date,
    description,
    withdrawal,
    deposit,
    amount,
    balance: claim('balance'),
    memo: claim('memo'),
    usageStyle: header.some((cell) => cell.includes('利用')),
  }
}

function cell(row: string[], index: number): string {
  if (index < 0) return ''
  return (row[index] ?? '').trim()
}

export interface DetectedInstitutionLayout {
  /** 1-based line of the header row. */
  headerLine: number
  /** Header text of each column the parser uses. Empty when absent. */
  columns: Record<'date' | 'withdrawal' | 'deposit' | 'amount' | 'balance' | 'memo', string> & {
    description: string[]
  }
  /** What a positive single amount means when the caller does not say. */
  defaultPositiveAmountIs: 'income' | 'expense'
}

/** Which header row and columns `parseInstitutionCsv` would read. For diagnostics. */
export function detectInstitutionLayout(text: string): DetectedInstitutionLayout | null {
  const rows = parseCsv(text)
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index++) {
    const layout = layoutOf(rows[index], index)
    if (!layout) continue
    const name = (column: number) => (column >= 0 ? (rows[index][column] ?? '').trim() : '')
    return {
      headerLine: index + 1,
      columns: {
        date: name(layout.date),
        description: layout.description.map(name),
        withdrawal: name(layout.withdrawal),
        deposit: name(layout.deposit),
        amount: name(layout.amount),
        balance: name(layout.balance),
        memo: name(layout.memo),
      },
      defaultPositiveAmountIs: layout.usageStyle ? 'expense' : 'income',
    }
  }
  return null
}

/**
 * Statement dates: 2026/4/2, 2026-04-02, 2026.04.02, 2026年4月2日, 20260402,
 * and Reiwa dates such as R8.4.2 or 令和8年4月2日. A time after the date is ignored.
 */
export function normalizeStatementDate(raw: string): string | null {
  const text = raw.normalize('NFKC').trim().split(/\s+/)[0] ?? ''
  const plain = normalizeDate(text.replace(/\./g, '/'))
  if (plain) return plain
  const kanji = /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/.exec(text)
  if (kanji) return normalizeDate(`${kanji[1]}/${kanji[2]}/${kanji[3]}`)
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}`
    return isIsoDate(iso) ? iso : null
  }
  const reiwa = /^(?:R|令和)(\d{1,2})[./年](\d{1,2})[./月](\d{1,2})日?$/i.exec(text)
  if (reiwa) return normalizeDate(`${2018 + Number(reiwa[1])}/${reiwa[2]}/${reiwa[3]}`)
  return null
}

function signedAmount(
  row: string[],
  layout: Layout,
  positiveAmountIs: 'income' | 'expense',
): number | null | 'missing' {
  if (layout.amount >= 0) {
    const raw = cell(row, layout.amount)
    if (!raw) return 'missing'
    const value = parseYen(raw)
    if (value === null) return null
    return positiveAmountIs === 'expense' ? -value : value
  }
  const out = cell(row, layout.withdrawal)
  const into = cell(row, layout.deposit)
  if (!out && !into) return 'missing'
  const outValue = out ? parseYen(out) : 0
  const inValue = into ? parseYen(into) : 0
  if (outValue === null || inValue === null) return null
  if (outValue !== 0 && inValue !== 0) return null
  return outValue !== 0 ? -Math.abs(outValue) : Math.abs(inValue)
}

/**
 * Official CSV from one bank, card, or e-money account.
 * The file does not name the account, so the caller passes `accountName`.
 * There is no stable row id, so rows match on a content hash (date, amount,
 * direction, description, account, and the running balance when present).
 * Rows are income or expense. A bank row that is really a move between the
 * owner's own accounts is fixed by hand or by a later rule.
 */
export function parseInstitutionCsv(
  text: string,
  fileName: string,
  options: { accountName?: string; positiveAmountIs?: 'income' | 'expense' } = {},
): ImportParseResult {
  const result: ImportParseResult = {
    adapterId: INSTITUTION_CSV_ADAPTER_ID,
    fileName,
    transactions: [],
    errors: [],
  }
  const accountName = options.accountName?.trim() || null
  if (!accountName) {
    result.fileError = '取り込み先の口座を選んでください。'
    return result
  }
  if (text.trim() === '') {
    result.fileError = 'ファイルが空です。'
    return result
  }
  const rows = parseCsv(text)
  let layout: Layout | null = null
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index++) {
    layout = layoutOf(rows[index], index)
    if (layout) break
  }
  if (!layout) {
    result.fileError =
      '明細の見出し行が見つかりませんでした。日付と金額（または出金・入金）の列があるCSVを選んでください。'
    return result
  }
  const positiveAmountIs = options.positiveAmountIs ?? (layout.usageStyle ? 'expense' : 'income')

  for (let rowIndex = layout.headerRow + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    const line = rowIndex + 1
    if (row.every((value) => value.trim() === '')) continue
    const rawDate = cell(row, layout.date)
    // Footer rows (合計, 件数) leave the date empty.
    if (!rawDate) continue
    const date = normalizeStatementDate(rawDate)
    if (!date) {
      result.errors.push({ line, message: '日付の形式が正しくありません' })
      continue
    }
    const amount = signedAmount(row, layout, positiveAmountIs)
    // Carry-over lines (前月繰越) have a date and a balance but no movement.
    if (amount === 'missing') continue
    if (amount === null || amount === 0) {
      result.errors.push({ line, message: '金額が整数ではありません' })
      continue
    }
    const description = [
      ...new Set(layout.description.map((index) => cell(row, index)).filter(Boolean)),
    ].join(' ')
    const type: TransactionType = amount > 0 ? 'income' : 'expense'
    const balance = cell(row, layout.balance)
    const normalized: NormalizedTransaction = {
      date,
      amountYen: Math.abs(amount),
      amountSign: amount > 0 ? 1 : -1,
      type,
      description,
      memo: cell(row, layout.memo),
      categoryLarge: null,
      categoryMiddle: null,
      accountName,
      externalId: null,
      include: true,
      contentHash: contentHash([
        date,
        String(Math.abs(amount)),
        type,
        description,
        accountName,
        balance ? String(parseYen(balance) ?? balance) : '',
      ]),
    }
    result.transactions.push(normalized)
  }
  if (result.transactions.length === 0 && result.errors.length === 0) {
    result.fileError = '明細の行がありません。'
  }
  return result
}
