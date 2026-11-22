export class LedgerError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'LedgerError'
    this.code = code
  }
}
