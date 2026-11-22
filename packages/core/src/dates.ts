const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const YEAR_MONTH = /^(\d{4})-(\d{2})$/

export function isIsoDate(value: string): boolean {
  const match = DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= last
}

export function isYearMonth(value: string): boolean {
  const match = YEAR_MONTH.exec(value)
  if (!match) return false
  const month = Number(match[2])
  return month >= 1 && month <= 12
}

/** Accepts YYYY-MM-DD and YYYY/M/D. Returns null when the calendar day does not exist. */
export function normalizeDate(raw: string): string | null {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw.trim())
  if (!match) return null
  const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return isIsoDate(iso) ? iso : null
}

export function yearMonthOf(date: string): string {
  return date.slice(0, 7)
}

export function currentYearMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [yearText, monthText] = yearMonth.split('-')
  const index = Number(yearText) * 12 + (Number(monthText) - 1) + delta
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

export function formatIsoDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${year}/${Number(month)}/${Number(day)}`
}

export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-')
  return `${year}年${Number(month)}月`
}

export function defaultDateForMonth(yearMonth: string, now = new Date()): string {
  const today = todayIso(now)
  if (yearMonthOf(today) === yearMonth) return today
  return `${yearMonth}-01`
}
