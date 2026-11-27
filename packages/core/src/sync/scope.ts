/** The only Google scope this app may request. Do not widen it. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file' as const

/** Must match LEDGER_FOLDER and LEDGER_FILE in apps/gas/src/Code.js. */
export const DRIVE_FOLDER_NAME = 'moneyhound'
export const DRIVE_LEDGER_NAME = 'ledger.json'
