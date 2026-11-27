import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DRIVE_FOLDER_NAME,
  DRIVE_LEDGER_NAME,
  GOOGLE_DRIVE_SCOPE,
  seedLedger,
} from '@moneyhound/core'
import { loadServer } from './fakeAppsScript'

const body = (note = '') => JSON.stringify({ ...seedLedger(), note })

describe('Apps Script manifest', () => {
  it('requests drive.file and nothing else, and only the owner can open the app', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'appsscript.json'), 'utf8'),
    )
    expect(manifest.oauthScopes).toEqual([GOOGLE_DRIVE_SCOPE])
    expect(manifest.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'MYSELF' })
  })
})

describe('Code.js', () => {
  it('serves the single page', () => {
    const { server } = loadServer()
    expect(server.doGet()).toMatchObject({ file: 'index', title: 'moneyhound' })
  })

  it('creates moneyhound/ledger.json once, then updates it with a version check', () => {
    const { server, world } = loadServer()
    expect(server.mhRead()).toBeNull()
    const created = server.mhWrite(body('a'), null, null)
    expect(created.etag).toBe('1')
    expect([...world.folders.values()]).toEqual([{ name: DRIVE_FOLDER_NAME, trashed: false }])
    expect(world.files.get(created.id)?.name).toBe(DRIVE_LEDGER_NAME)

    expect(server.mhRead()).toEqual({ id: created.id, etag: '1', body: body('a') })
    const updated = server.mhWrite(body('b'), '1', created.id)
    expect(updated).toEqual({ id: created.id, etag: '2', body: '' })
    expect(server.mhRead()?.body).toBe(body('b'))

    // A writer that read version 1 is refused and nothing changes.
    expect(() => server.mhWrite(body('stale'), '1', created.id)).toThrow('precondition_failed')
    expect(() => server.mhWrite(body('new'), null, null)).toThrow('precondition_failed')
    expect(() => server.mhWrite(body('other'), '2', 'file-other')).toThrow('precondition_failed')
    expect(server.mhRead()).toEqual({ id: created.id, etag: '2', body: body('b') })
    expect(world.locks.held).toBe(0)
  })

  it('refuses a body that is not a schema 2 ledger', () => {
    const { server, world } = loadServer()
    expect(() => server.mhWrite('not json', null, null)).toThrow('invalid_ledger')
    expect(() => server.mhWrite(JSON.stringify({ schemaVersion: 1 }), null, null)).toThrow(
      'invalid_ledger',
    )
    expect(() =>
      server.mhWrite(JSON.stringify({ ...seedLedger(), transactions: null }), null, null),
    ).toThrow('invalid_ledger')
    expect(world.files.size).toBe(0)
    expect(world.locks.acquired).toBe(0)
  })

  it('reuses an existing moneyhound folder and treats a trashed ledger as missing', () => {
    const { server, world } = loadServer()
    world.folders.set('folder-existing', { name: 'moneyhound', trashed: false })
    const first = server.mhWrite(body(), null, null)
    expect(world.files.get(first.id)?.folder).toBe('folder-existing')
    world.files.get(first.id)!.trashed = true
    expect(server.mhRead()).toBeNull()
  })
})
