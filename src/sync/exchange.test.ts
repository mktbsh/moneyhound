import { describe, expect, it } from 'vitest'
import { addTransaction, seedLedger } from '../domain/ledger'
import { exchangeLedgers, PreconditionFailed, type DrivePort, type RemoteFile } from './exchange'
import { planSync } from './plan'
import { GOOGLE_DRIVE_SCOPE } from './scope'

const expense = {
  date: '2026-04-02',
  amountYen: 1000,
  type: 'expense' as const,
  categoryId: 'cat_food',
  accountId: 'acct_cash',
  transferAccountId: null,
  description: 'パン',
  memo: '',
}

class FakeDrive implements DrivePort {
  writes: string[] = []
  file: RemoteFile | null
  constructor(
    file: RemoteFile | null,
    private readonly failTimes = 0,
  ) {
    this.file = file
  }

  async read(): Promise<RemoteFile | null> {
    return this.file ? { ...this.file } : null
  }

  async write(body: string, ifMatch: string | null): Promise<RemoteFile> {
    this.writes.push(ifMatch ?? '')
    if (this.writes.length <= this.failTimes) {
      this.file = {
        id: 'ledger-file',
        etag: `etag-${this.writes.length}`,
        body: this.file?.body ?? body,
      }
      throw new PreconditionFailed()
    }
    this.file = { id: this.file?.id ?? 'ledger-file', etag: 'etag-final', body }
    return { ...this.file }
  }
}

describe('sync exchange', () => {
  it('merges a concurrent remote edit instead of overwriting it', async () => {
    const base = seedLedger()
    const local = addTransaction(base, expense, {
      now: '2026-04-02T00:00:00.000Z',
      id: () => 'local-tx',
    })
    const remoteLedger = addTransaction(
      base,
      { ...expense, description: '電車', categoryId: 'cat_transport', amountYen: 400 },
      { now: '2026-04-03T00:00:00.000Z', id: () => 'remote-tx' },
    )
    const drive = new FakeDrive({
      id: 'ledger-file',
      etag: '"v1"',
      body: JSON.stringify(remoteLedger),
    })
    const result = await exchangeLedgers(base, local, drive)
    const ids = result.ledger.transactions.map((transaction) => transaction.id).sort()
    expect(ids).toEqual(['local-tx', 'remote-tx'])
    expect(drive.writes).toEqual(['"v1"'])
    const uploaded = JSON.parse((await drive.read())!.body) as { transactions: { id: string }[] }
    expect(uploaded.transactions.map((transaction) => transaction.id).sort()).toEqual([
      'local-tx',
      'remote-tx',
    ])
  })

  it('re-reads after a precondition failure and keeps the newer remote row', async () => {
    const base = seedLedger()
    const local = addTransaction(base, expense, {
      now: '2026-04-02T00:00:00.000Z',
      id: () => 'local-tx',
    })
    const firstRemote = addTransaction(
      base,
      { ...expense, description: '先', amountYen: 10, categoryId: 'cat_daily' },
      { now: '2026-04-03T00:00:00.000Z', id: () => 'remote-old' },
    )
    const secondRemote = addTransaction(
      firstRemote,
      { ...expense, description: '後', amountYen: 20, categoryId: 'cat_daily' },
      { now: '2026-04-04T00:00:00.000Z', id: () => 'remote-new' },
    )
    const drive = new FakeDrive({
      id: 'ledger-file',
      etag: '"v1"',
      body: JSON.stringify(firstRemote),
    })
    drive.write = async (body, ifMatch) => {
      drive.writes.push(ifMatch ?? '')
      if (drive.writes.length === 1) {
        drive.file = { id: 'ledger-file', etag: '"v2"', body: JSON.stringify(secondRemote) }
        throw new PreconditionFailed()
      }
      const file = { id: 'ledger-file', etag: '"v3"', body }
      drive.file = file
      return file
    }
    const result = await exchangeLedgers(base, local, drive)
    const ids = result.ledger.transactions.map((transaction) => transaction.id).sort()
    expect(ids).toEqual(['local-tx', 'remote-new', 'remote-old'])
    expect(result.wrote).toBe(true)
  })

  it('does not upload when the remote ledger is already the merge result', () => {
    const ledger = seedLedger()
    const plan = planSync(ledger, ledger, ledger)
    expect(plan.write).toBe(false)
    expect(plan.conflicts).toEqual([])
  })
})

describe('oauth scope', () => {
  it('is limited to drive.file', () => {
    expect(GOOGLE_DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file')
  })
})
