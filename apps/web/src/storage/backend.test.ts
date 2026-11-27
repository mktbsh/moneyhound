import { describe, expect, it } from 'bun:test'
import { addTransaction, seedLedger, type Ledger } from '@moneyhound/core'
import { fakeScriptRun, loadServer } from '../../../gas/src/fakeAppsScript'
import { driveBackend } from './backend'
import { gasDrivePort, type ScriptRunner } from './gasPort'

let n = 0
const clock = (now: string) => ({ now, id: () => `id-${++n}` })

function add(ledger: Ledger, description: string, now: string): Ledger {
  return addTransaction(
    ledger,
    {
      date: '2026-04-02',
      amountYen: 100,
      type: 'expense',
      categoryId: 'cat_food',
      accountId: 'acct_cash',
      transferAccountId: null,
      description,
      memo: '',
    },
    clock(now),
  )
}

function device(server: ReturnType<typeof loadServer>['server']) {
  return driveBackend(gasDrivePort(fakeScriptRun(server) as unknown as ScriptRunner))
}

describe('driveBackend over Apps Script', () => {
  it('creates the Drive file on first open and saves later edits', async () => {
    const { server } = loadServer()
    const phone = device(server)
    const opened = await phone.load()
    expect(opened).toEqual(seedLedger())
    expect(server.mhRead()?.etag).toBe('1')

    const saved = await phone.save(add(opened, '昼食', '2026-04-02T01:00:00.000Z'))
    expect(saved.conflicts).toBe(0)
    expect(server.mhRead()?.etag).toBe('2')
    expect(JSON.parse(server.mhRead()!.body).transactions).toHaveLength(1)
  })

  it('merges instead of overwriting when another device saved in between', async () => {
    const { server } = loadServer()
    const phone = device(server)
    const laptop = device(server)
    const base = await phone.load()
    await laptop.load()

    await phone.save(add(base, 'スマホで入力', '2026-04-02T01:00:00.000Z'))
    // The laptop still has the old version and saves its own edit.
    const merged = await laptop.save(add(base, 'PCで入力', '2026-04-02T02:00:00.000Z'))
    const descriptions = merged.ledger.transactions.map((row) => row.description).sort()
    expect(descriptions).toEqual(['PCで入力', 'スマホで入力'])
    expect(JSON.parse(server.mhRead()!.body).transactions).toHaveLength(2)

    // The phone's next save is based on a stale version and is merged too.
    const again = await phone.save(add(base, 'もう一件', '2026-04-02T03:00:00.000Z'))
    expect(again.ledger.transactions).toHaveLength(3)
    expect(server.mhRead()?.etag).toBe('4')
  })

  it('refuses to read a Drive file that is not a ledger', async () => {
    const { server, world } = loadServer()
    server.mhWrite(JSON.stringify(seedLedger()), null, null)
    const [id] = [...world.files.keys()]
    world.files.get(id)!.body = '{"broken":'
    await expect(device(server).load()).rejects.toThrow('remote_unreadable')
  })
})
