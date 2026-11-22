import { contentHash } from '../hash'
import { normalizeDate } from '../dates'
import { parseYen } from '../money'
import { normalizeHeader } from '../text'
import type { TransactionType } from '../types'
import { parseCsv } from './csv'
import type { ImportParseResult, NormalizedTransaction } from './types'

/**
 * Money Forward ME 「収入・支出詳細」 columns.
 * Header matching is NFKC-normalized, so 金額（円） and 金額(円) are the same column.
 * Column set and the Shift_JIS/UTF-8 decode order are adapted from
 * ossannote2025/mf-csv-viewer (MIT). See THIRD_PARTY_NOTICES.md.
 */
const COLUMNS = {
  isTarget: '計算対象',
  date: '日付',
  content: '内容',
  amount: '金額(円)',
  institution: '保有金融機関',
  large: '大項目',
  middle: '中項目',
  memo: 'メモ',
  isTransfer: '振替',
  id: 'ID',
} as const

type ColumnKey = keyof typeof COLUMNS
const REQUIRED: ColumnKey[] = ['date', 'content', 'amount', 'id']

function cell(row: string[], index: number): string {
  if (index < 0) return ''
  return (row[index] ?? '').trim()
}

function flag(raw: string, fallback: boolean): boolean {
  if (!raw) return fallback
  return raw.normalize('NFKC').trim() === '1'
}

/** mf-csv-viewer prefixes formula-like cells with a quote on its own export. */
function unguard(value: string, ownExport: boolean): string {
  if (!ownExport) return value
  return /^'+[=+\-@\t\r]/.test(value) ? value.slice(1).trim() : value
}

function blankCategory(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '未分類') return null
  return trimmed
}

export function parseMfCsv(text: string, fileName: string): ImportParseResult {
  const result: ImportParseResult = {
    adapterId: 'mf-csv',
    fileName,
    transactions: [],
    errors: [],
  }
  if (text.trim() === '') {
    result.fileError = 'ファイルが空です。'
    return result
  }
  const rows = parseCsv(text)
  if (rows.length === 0) {
    result.fileError = 'ファイルにデータがありません。'
    return result
  }
  const header = rows[0].map((column) => normalizeHeader(column))
  const index = {} as Record<ColumnKey, number>
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    index[key] = header.indexOf(normalizeHeader(COLUMNS[key]))
  }
  const missing = REQUIRED.filter((key) => index[key] < 0)
  if (missing.length > 0) {
    result.fileError = `マネーフォワードMEの「収入・支出詳細」CSVではないようです。不足列: ${missing
      .map((key) => COLUMNS[key])
      .join('、')}`
    return result
  }
  const ownExport = header.includes(normalizeHeader('除外ルール'))

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    const line = rowIndex + 1
    if (row.every((value) => value.trim() === '')) continue
    const externalId = cell(row, index.id)
    if (!externalId) {
      result.errors.push({ line, message: 'IDが空です' })
      continue
    }
    const date = normalizeDate(cell(row, index.date))
    if (!date) {
      result.errors.push({ line, message: '日付の形式が正しくありません' })
      continue
    }
    const amount = parseYen(cell(row, index.amount))
    if (amount === null || amount === 0) {
      result.errors.push({ line, message: '金額が整数ではありません' })
      continue
    }
    const description = unguard(cell(row, index.content), ownExport)
    const accountName = unguard(cell(row, index.institution), ownExport) || null
    const categoryLarge = blankCategory(unguard(cell(row, index.large), ownExport))
    const categoryMiddle = blankCategory(unguard(cell(row, index.middle), ownExport))
    const memo = unguard(cell(row, index.memo), ownExport)
    const transfer = flag(cell(row, index.isTransfer), false)
    const type: TransactionType = transfer ? 'transfer' : amount > 0 ? 'income' : 'expense'
    const normalized: NormalizedTransaction = {
      date,
      amountYen: Math.abs(amount),
      type,
      description,
      memo,
      categoryLarge,
      categoryMiddle,
      accountName,
      externalId,
      include: flag(cell(row, index.isTarget), true),
      contentHash: contentHash([
        date,
        String(Math.abs(amount)),
        type,
        description,
        accountName ?? '',
        categoryLarge ?? '',
        categoryMiddle ?? '',
      ]),
    }
    result.transactions.push(normalized)
  }
  if (result.transactions.length === 0 && result.errors.length === 0) {
    result.fileError = '明細の行がありません。'
  }
  return result
}
