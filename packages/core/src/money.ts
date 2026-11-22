const MAX_YEN = 100_000_000_000

export function isYenAmount(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_YEN
}

/** Parse a yen field. Commas, yen signs, and fullwidth digits are accepted. */
export function parseYen(raw: string): number | null {
  const normalized = raw
    .normalize('NFKC')
    .replace(/[,¥￥\\\s円]/g, '')
    .replace(/[−‐–ー]/g, '-')
  if (!/^[-+]?\d+$/.test(normalized)) return null
  const value = Number(normalized)
  if (!Number.isSafeInteger(value)) return null
  return value
}

export function formatYen(yen: number): string {
  const sign = yen < 0 ? '-' : ''
  const digits = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(Math.abs(yen))
  return `${sign}${digits}円`
}
