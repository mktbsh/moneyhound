/** Fold user-entered text so contains-rules ignore width and case. */
export function fold(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .replace(/["'\s]/g, '')
    .toUpperCase()
}
