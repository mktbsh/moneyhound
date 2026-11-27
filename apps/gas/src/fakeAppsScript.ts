import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** In-memory stand-ins for the Apps Script services Code.js uses. Tests only. */
export interface FakeWorld {
  files: Map<string, { name: string; body: string; trashed: boolean; folder: string }>
  folders: Map<string, { name: string; trashed: boolean }>
  properties: Map<string, string>
  locks: { held: number; acquired: number }
}

export interface Server {
  doGet(): { title: string; file: string }
  mhRead(): { id: string; etag: string; body: string } | null
  mhWrite(
    body: string,
    ifMatch: string | null,
    fileId: string | null,
  ): { id: string; etag: string; body: string }
}

export function loadServer(world: FakeWorld = emptyWorld()): { server: Server; world: FakeWorld } {
  let seq = 0
  const fileApi = (id: string) => {
    const record = world.files.get(id)
    if (!record) throw new Error('not found')
    return {
      getId: () => id,
      isTrashed: () => record.trashed,
      getBlob: () => ({ getDataAsString: () => record.body }),
      setContent: (body: string) => {
        record.body = body
      },
    }
  }
  const folderApi = (id: string) => ({
    isTrashed: () => world.folders.get(id)!.trashed,
    createFile: (name: string, body: string) => {
      const fileId = `file-${++seq}`
      world.files.set(fileId, { name, body, trashed: false, folder: id })
      return fileApi(fileId)
    },
  })
  const DriveApp = {
    getFileById: fileApi,
    getFoldersByName: (name: string) => {
      const ids = [...world.folders].filter(([, f]) => f.name === name).map(([id]) => id)
      let index = 0
      return { hasNext: () => index < ids.length, next: () => folderApi(ids[index++]) }
    },
    createFolder: (name: string) => {
      const id = `folder-${++seq}`
      world.folders.set(id, { name, trashed: false })
      return folderApi(id)
    },
  }
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key: string) => world.properties.get(key) ?? null,
      setProperty: (key: string, value: string) => void world.properties.set(key, value),
    }),
  }
  const LockService = {
    getScriptLock: () => ({
      waitLock: () => {
        world.locks.held += 1
        world.locks.acquired += 1
      },
      releaseLock: () => {
        world.locks.held -= 1
      },
    }),
  }
  const HtmlService = {
    createHtmlOutputFromFile: (file: string) => {
      const output = {
        title: '',
        file,
        setTitle: (title: string) => ((output.title = title), output),
        addMetaTag: () => output,
      }
      return output
    },
  }
  const source = readFileSync(join(import.meta.dirname, 'Code.js'), 'utf8')
  const factory = new Function(
    'DriveApp',
    'PropertiesService',
    'LockService',
    'HtmlService',
    `${source}\nreturn { doGet, mhRead, mhWrite }`,
  )
  const server = factory(DriveApp, PropertiesService, LockService, HtmlService) as Server
  return { server, world }
}

export function emptyWorld(): FakeWorld {
  return {
    files: new Map(),
    folders: new Map(),
    properties: new Map(),
    locks: { held: 0, acquired: 0 },
  }
}

/** A `google.script.run` that calls the fake server asynchronously, like the real bridge. */
export function fakeScriptRun(server: Server) {
  const make = (
    onSuccess: (value: unknown) => void = () => {},
    onFailure: (error: Error) => void = () => {},
  ): Record<string, unknown> => {
    const runner: Record<string, unknown> = {
      withSuccessHandler: (handler: (value: unknown) => void) => make(handler, onFailure),
      withFailureHandler: (handler: (error: Error) => void) => make(onSuccess, handler),
    }
    for (const name of ['mhRead', 'mhWrite'] as const) {
      runner[name] = (...args: unknown[]) => {
        queueMicrotask(() => {
          try {
            // A round trip through JSON, as google.script.run serializes values.
            const value = (server[name] as (...values: unknown[]) => unknown)(...args)
            onSuccess(value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
          } catch (error) {
            onFailure(error as Error)
          }
        })
      }
    }
    return runner
  }
  return make()
}
