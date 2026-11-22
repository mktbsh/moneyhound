import { fold } from '../text'
import type { NormalizedTransaction } from './types'

/**
 * Money Forward's 「収入・支出詳細」CSV has no destination column.
 * A linked transfer is two rows: same absolute amount, same date, `振替=1`,
 * opposite signs, and different `保有金融機関`. The negative row is the source.
 * See `pairTransfers` and the notes in AGENTS.md.
 *
 * The date window is the same calendar day. The fictional MF sample that
 * mirrors a real export pairs both sides on one day; a wider window would
 * join unrelated movements that happen to share an amount.
 */
export const TRANSFER_PAIR_DAY_WINDOW = 0

export interface PlannedImportRow {
  row: NormalizedTransaction
  /** The other side of a paired transfer. This row is not inserted. */
  counterpart: boolean
  /** Account name to credit, when this outflow row was paired or named. */
  destinationAccountName: string | null
}

function accountKey(name: string | null): string {
  return fold(name ?? '')
}

function sameDay(left: string, right: string): boolean {
  if (TRANSFER_PAIR_DAY_WINDOW !== 0) return false
  return left === right
}

function canPair(source: NormalizedTransaction, dest: NormalizedTransaction): boolean {
  return (
    source.type === 'transfer' &&
    dest.type === 'transfer' &&
    source.include &&
    dest.include &&
    source.amountSign < 0 &&
    dest.amountSign > 0 &&
    source.amountYen === dest.amountYen &&
    sameDay(source.date, dest.date) &&
    accountKey(source.accountName) !== '' &&
    accountKey(dest.accountName) !== '' &&
    accountKey(source.accountName) !== accountKey(dest.accountName)
  )
}

/**
 * Plan which transfer rows become one ledger transfer and which are the other side.
 * Outflow rows are kept. A matching inflow row is marked `counterpart` and not inserted.
 * When several inflows fit, the one with the same description wins; otherwise the earliest.
 */
export function planTransferRows(rows: readonly NormalizedTransaction[]): PlannedImportRow[] {
  const used = new Set<number>()
  const destinationByIndex = new Map<number, string>()
  const inflows = rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.type === 'transfer' && item.row.include && item.row.amountSign > 0)

  rows.forEach((row, index) => {
    if (row.type !== 'transfer' || !row.include || row.amountSign >= 0) return
    const open = inflows.filter((item) => !used.has(item.index) && canPair(row, item.row))
    const sameDescription = open.filter(
      (item) => fold(item.row.description) === fold(row.description),
    )
    const chosen = (sameDescription[0] ?? open[0])?.row
    const chosenIndex = (sameDescription[0] ?? open[0])?.index
    if (chosen && chosenIndex !== undefined && chosen.accountName) {
      used.add(chosenIndex)
      destinationByIndex.set(index, chosen.accountName)
    }
  })

  return rows.map((row, index) => ({
    row,
    counterpart: used.has(index),
    destinationAccountName: destinationByIndex.get(index) ?? null,
  }))
}
