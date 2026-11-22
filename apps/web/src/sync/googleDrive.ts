import {
  DRIVE_APP_PROPERTY,
  DRIVE_FOLDER_NAME,
  DRIVE_LEDGER_NAME,
  PreconditionFailed,
  type DrivePort,
  type RemoteFile,
} from '@moneyhound/core'

interface ListedFile {
  id: string
  modifiedTime?: string
  createdTime?: string
}

interface FileMeta {
  id: string
  etag?: string
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class GoogleDriveClient implements DrivePort {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async read(): Promise<RemoteFile | null> {
    const files = await this.list(
      `appProperties has { key='app' and value='${DRIVE_APP_PROPERTY}' } and appProperties has { key='role' and value='ledger' } and trashed=false`,
    )
    if (files.length === 0) return null
    const chosen = [...files].sort((a, b) =>
      (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''),
    )[0]
    if (!chosen) return null
    const meta = await this.metadata(chosen.id)
    const body = await this.download(chosen.id)
    return { id: chosen.id, etag: meta.etag ?? '', body }
  }

  async write(body: string, ifMatch: string | null, fileId: string | null): Promise<RemoteFile> {
    if (fileId) {
      return this.update(fileId, body, ifMatch)
    }
    const folderId = await this.ensureFolder()
    return this.create(folderId, body)
  }

  private async ensureFolder(): Promise<string> {
    const query = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false and appProperties has { key='app' and value='${DRIVE_APP_PROPERTY}' }`
    const existing = await this.list(query)
    if (existing.length > 0) {
      const oldest = [...existing].sort((a, b) =>
        (a.createdTime ?? '').localeCompare(b.createdTime ?? ''),
      )[0]
      if (oldest) return oldest.id
    }
    const created = await this.json<FileMeta>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { app: DRIVE_APP_PROPERTY, role: 'folder' },
      }),
    })
    return created.id
  }

  private async create(folderId: string, body: string): Promise<RemoteFile> {
    const boundary = 'moneyhound'
    const metadata = {
      name: DRIVE_LEDGER_NAME,
      mimeType: 'application/json',
      parents: [folderId],
      appProperties: { app: DRIVE_APP_PROPERTY, role: 'ledger' },
    }
    const payload = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      body,
      `--${boundary}--`,
      '',
    ].join('\r\n')
    const meta = await this.json<FileMeta>(`${UPLOAD}/files?uploadType=multipart&fields=id,etag`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: payload,
    })
    return { id: meta.id, etag: meta.etag ?? '', body }
  }

  private async update(fileId: string, body: string, ifMatch: string | null): Promise<RemoteFile> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=UTF-8' }
    if (ifMatch) headers['If-Match'] = ifMatch
    const meta = await this.json<FileMeta>(
      `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,etag`,
      { method: 'PATCH', headers, body },
    )
    return { id: meta.id, etag: meta.etag ?? ifMatch ?? '', body }
  }

  private async metadata(fileId: string): Promise<FileMeta> {
    return this.json<FileMeta>(`${API}/files/${encodeURIComponent(fileId)}?fields=id,etag`)
  }

  private async download(fileId: string): Promise<string> {
    const response = await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)
    return response.text()
  }

  private async list(query: string): Promise<ListedFile[]> {
    const url = new URL(`${API}/files`)
    url.searchParams.set('q', query)
    url.searchParams.set('fields', 'files(id,modifiedTime,createdTime)')
    url.searchParams.set('spaces', 'drive')
    url.searchParams.set('pageSize', '20')
    const body = await this.json<{ files?: ListedFile[] }>(url.toString())
    return body.files ?? []
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.request(url, init)
    return (await response.json()) as T
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${this.token}`)
    const response = await this.fetchImpl(url, { ...init, headers })
    if (response.status === 412) throw new PreconditionFailed()
    if (!response.ok) {
      throw new Error(`drive_${response.status}`)
    }
    return response
  }
}
