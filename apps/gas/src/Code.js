/**
 * moneyhound Apps Script web app.
 *
 * The ledger is one JSON file, My Drive/moneyhound/ledger.json. The page
 * (index.html, built by apps/web) holds the logic; this file only serves it
 * and reads or writes that file. A version counter in script properties is
 * the etag: a write based on an older version is refused with
 * `precondition_failed`, and the page merges and retries.
 *
 * Scope is drive.file only (appsscript.json). DriveApp then sees only files
 * this script created.
 */

/* eslint-disable no-unused-vars -- Apps Script calls doGet, mhRead, and mhWrite by name. */

var LEDGER_FOLDER = 'moneyhound'
var LEDGER_FILE = 'ledger.json'
var PROP_FILE_ID = 'ledgerFileId'
var PROP_VERSION = 'ledgerVersion'
var SCHEMA_VERSION = 2
var LOCK_WAIT_MS = 20000

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('moneyhound')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
}

function props_() {
  return PropertiesService.getScriptProperties()
}

function ledgerFile_() {
  var id = props_().getProperty(PROP_FILE_ID)
  if (!id) return null
  try {
    var file = DriveApp.getFileById(id)
    return file.isTrashed() ? null : file
  } catch {
    return null
  }
}

function version_() {
  return props_().getProperty(PROP_VERSION) || '0'
}

function folder_() {
  var found = DriveApp.getFoldersByName(LEDGER_FOLDER)
  while (found.hasNext()) {
    var folder = found.next()
    if (!folder.isTrashed()) return folder
  }
  return DriveApp.createFolder(LEDGER_FOLDER)
}

/** Refuse anything that is not a schema 2 ledger, so a bad client cannot wipe the file. */
function assertLedgerBody_(body) {
  var parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('invalid_ledger')
  }
  if (
    !parsed ||
    parsed.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(parsed.accounts) ||
    !Array.isArray(parsed.categories) ||
    !Array.isArray(parsed.transactions)
  ) {
    throw new Error('invalid_ledger')
  }
}

/** @returns {{ id: string, etag: string, body: string } | null} */
function mhRead() {
  var file = ledgerFile_()
  if (!file) return null
  return { id: file.getId(), etag: version_(), body: file.getBlob().getDataAsString('UTF-8') }
}

/**
 * Create the file when there is none and `ifMatch` is null. Otherwise
 * `ifMatch` must equal the current version.
 * @returns {{ id: string, etag: string, body: string }}
 */
function mhWrite(body, ifMatch, fileId) {
  assertLedgerBody_(body)
  var lock = LockService.getScriptLock()
  lock.waitLock(LOCK_WAIT_MS)
  try {
    var file = ledgerFile_()
    var current = version_()
    if (file) {
      if (ifMatch !== current || (fileId && fileId !== file.getId())) {
        throw new Error('precondition_failed')
      }
      file.setContent(body)
    } else {
      if (ifMatch) throw new Error('precondition_failed')
      file = folder_().createFile(LEDGER_FILE, body, 'application/json')
      props_().setProperty(PROP_FILE_ID, file.getId())
    }
    var next = String(Number(current) + 1)
    props_().setProperty(PROP_VERSION, next)
    return { id: file.getId(), etag: next, body: '' }
  } finally {
    lock.releaseLock()
  }
}
