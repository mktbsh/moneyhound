import { decodeCsvBytes } from './encoding'
import { parseMfCsv } from './mfCsv'
import type { ImporterAdapter } from './types'

export const mfCsvImporter: ImporterAdapter = {
  id: 'mf-csv',
  label: 'マネーフォワードME（収入・支出詳細）',
  delivery: 'file',
  parse(input) {
    const decoded = decodeCsvBytes(input.bytes)
    return parseMfCsv(decoded.text, input.fileName)
  },
}

/** Registered parsers. Institution CSV and the browser extension are later adapters. */
export const importers: readonly ImporterAdapter[] = [mfCsvImporter]

/**
 * Slots reserved for the post-Money-Forward import path.
 * `institution-csv` is official CSV/OFX the owner downloads.
 * `browser-extension` reads a statement page the owner already has open.
 * Neither path may collect credentials or automate login.
 */
export const PLANNED_ADAPTERS = [
  { id: 'mf-csv', delivery: 'file', status: 'parser' },
  { id: 'institution-csv', delivery: 'file', status: 'planned' },
  { id: 'browser-extension', delivery: 'extension', status: 'planned' },
] as const

export function getImporter(id: string): ImporterAdapter | undefined {
  return importers.find((importer) => importer.id === id)
}
