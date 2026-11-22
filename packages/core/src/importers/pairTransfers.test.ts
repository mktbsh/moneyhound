import { describe, expect, it } from 'bun:test'
import { planTransferRows } from './pairTransfers'
import type { NormalizedTransaction } from './types'

function row(
  patch: Partial<NormalizedTransaction> & Pick<NormalizedTransaction, 'externalId'>,
): NormalizedTransaction {
  return {
    date: '2026-04-04',
    amountYen: 1000,
    amountSign: -1,
    type: 'transfer',
    description: '口座振替',
    memo: '',
    categoryLarge: null,
    categoryMiddle: null,
    accountName: '銀行',
    contentHash: patch.externalId ?? 'h',
    include: true,
    ...patch,
  }
}

describe('planTransferRows', () => {
  it('prefers the inflow with the same description', () => {
    const planned = planTransferRows([
      row({ externalId: 'out', accountName: '銀行', amountSign: -1, description: '給料日の移動' }),
      row({
        externalId: 'other',
        accountName: 'カード',
        amountSign: 1,
        description: '別の移動',
      }),
      row({
        externalId: 'match',
        accountName: '財布',
        amountSign: 1,
        description: '給料日の移動',
      }),
    ])
    expect(planned.find((item) => item.row.externalId === 'out')?.destinationAccountName).toBe(
      '財布',
    )
    expect(planned.find((item) => item.row.externalId === 'match')?.counterpart).toBe(true)
    expect(planned.find((item) => item.row.externalId === 'other')?.counterpart).toBe(false)
  })
})
