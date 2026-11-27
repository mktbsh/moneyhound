import { decodeCsvBytes } from './encoding'
import { INSTITUTION_CSV_ADAPTER_ID, parseInstitutionCsv } from './institutionCsv'
import type { ImporterAdapter } from './types'

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
export const importers: readonly ImporterAdapter[] = [institutionCsvImporter]

/** Display name for the import source record each adapter writes. */
export const IMPORT_SOURCE_NAMES: Readonly<Record<string, string>> = {
  [INSTITUTION_CSV_ADAPTER_ID]: '金融機関CSV',
}

/**
 * Import paths. Money Forward CSV is deliberately not supported.
 * `institution-csv` is official CSV the owner downloads.
 * `browser-extension` reads a statement page the owner already has open.
 * Neither path may collect credentials or automate login.
 */
export const PLANNED_ADAPTERS = [
  { id: 'institution-csv', delivery: 'file', status: 'parser' },
  { id: 'browser-extension', delivery: 'extension', status: 'planned' },
] as const

export function getImporter(id: string): ImporterAdapter | undefined {
  return importers.find((importer) => importer.id === id)
}
