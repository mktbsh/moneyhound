import { decodeCsvBytes } from './encoding'
import { INSTITUTION_CSV_ADAPTER_ID, parseInstitutionCsv } from './institutionCsv'
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

export const institutionCsvImporter: ImporterAdapter = {
  id: INSTITUTION_CSV_ADAPTER_ID,
  label: '金融機関のCSV（銀行・カード・電子マネー）',
  delivery: 'file',
  parse(input) {
    const decoded = decodeCsvBytes(input.bytes)
    return parseInstitutionCsv(decoded.text, input.fileName, {
      accountName: input.accountName,
      positiveAmountIs: input.positiveAmountIs,
    })
  },
}

/** Registered parsers. The browser extension is a later adapter. */
export const importers: readonly ImporterAdapter[] = [mfCsvImporter, institutionCsvImporter]

/** Display name for the import source record each adapter writes. */
export const IMPORT_SOURCE_NAMES: Readonly<Record<string, string>> = {
  'mf-csv': 'マネーフォワードME',
  [INSTITUTION_CSV_ADAPTER_ID]: '金融機関CSV',
}

/**
 * Slots reserved for the post-Money-Forward import path.
 * `institution-csv` is official CSV/OFX the owner downloads.
 * `browser-extension` reads a statement page the owner already has open.
 * Neither path may collect credentials or automate login.
 */
export const PLANNED_ADAPTERS = [
  { id: 'mf-csv', delivery: 'file', status: 'parser' },
  { id: 'institution-csv', delivery: 'file', status: 'parser' },
  { id: 'browser-extension', delivery: 'extension', status: 'planned' },
] as const

export function getImporter(id: string): ImporterAdapter | undefined {
  return importers.find((importer) => importer.id === id)
}
