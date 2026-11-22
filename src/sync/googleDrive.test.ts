import { describe, expect, it } from 'vitest'
import { GoogleDriveClient } from './googleDrive'
import { PreconditionFailed } from './exchange'

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('GoogleDriveClient', () => {
  it('updates an existing ledger with If-Match and refuses a stale etag', async () => {
    const calls: { url: string; ifMatch: string | null; method: string }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      calls.push({ url, method: init?.method ?? 'GET', ifMatch: headers.get('If-Match') })
      expect(headers.get('Authorization')).toBe('Bearer token')
      if (url.includes('alt=media')) return new Response('{"schemaVersion":1}', { status: 200 })
      if (url.includes('uploadType=media') && headers.get('If-Match') === '"v1"') {
        return jsonResponse({ id: 'file-1', etag: '"v2"' })
      }
      if (url.includes('uploadType=media')) return new Response('precondition', { status: 412 })
      if (url.includes('/files/file-1')) return jsonResponse({ id: 'file-1', etag: '"v1"' })
      return jsonResponse({
        files: [{ id: 'file-1', modifiedTime: '2026-04-01T00:00:00.000Z' }],
      })
    }
    const client = new GoogleDriveClient('token', fetchImpl)
    const remote = await client.read()
    expect(remote).toMatchObject({ id: 'file-1', etag: '"v1"', body: '{"schemaVersion":1}' })
    const written = await client.write('{"schemaVersion":1}', '"v1"', 'file-1')
    expect(written.etag).toBe('"v2"')
    await expect(client.write('{"schemaVersion":1}', '"stale"', 'file-1')).rejects.toBeInstanceOf(
      PreconditionFailed,
    )
    expect(calls.some((call) => call.ifMatch === '"v1"' && call.method === 'PATCH')).toBe(true)
  })
})
