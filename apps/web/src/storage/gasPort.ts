import { PreconditionFailed, type DrivePort, type RemoteFile } from '@moneyhound/core'

/** The part of `google.script.run` this app uses. */
export interface ScriptRunner {
  withSuccessHandler(handler: (value: unknown) => void): ScriptRunner
  withFailureHandler(handler: (error: Error) => void): ScriptRunner
  [server: string]: unknown
}

/** Server functions in apps/gas/src/Code.js. */
export const SERVER = { read: 'mhRead', write: 'mhWrite' } as const

function call<T>(run: ScriptRunner, name: string, args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const runner = run
      .withSuccessHandler((value) => resolve(value as T))
      .withFailureHandler((error) => {
        const message = error?.message ?? String(error)
        reject(message.includes('precondition_failed') ? new PreconditionFailed() : error)
      })
    const fn = runner[name]
    if (typeof fn !== 'function') {
      reject(new Error(`gas_missing_${name}`))
      return
    }
    ;(fn as (...values: unknown[]) => void).apply(runner, args)
  })
}

/**
 * Drive file behind the Apps Script web app. The server keeps a version
 * counter as the etag and rejects a write whose `ifMatch` is stale.
 */
export function gasDrivePort(run: ScriptRunner): DrivePort {
  return {
    read: () => call<RemoteFile | null>(run, SERVER.read, []),
    write: (body, ifMatch, fileId) => call<RemoteFile>(run, SERVER.write, [body, ifMatch, fileId]),
  }
}
