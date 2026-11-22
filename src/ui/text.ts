import { LedgerError } from '../domain/errors'

const LEDGER_MESSAGES: Record<string, string> = {
  invalid_amount: '金額は1円以上の整数で入力してください。',
  invalid_date: '日付が正しくありません。',
  invalid_category: 'カテゴリを選んでください。',
  invalid_account: '口座を選んでください。',
  invalid_transfer: '振替先は、出どころとは別の口座にしてください。',
  invalid_name: '名前は1〜40文字で入力してください。',
  duplicate_name: '同じ名前がすでにあります。',
  invalid_pattern: 'ルールの条件を確認してください。',
  invalid_text: '内容は500文字以内にしてください。',
  invalid_backup: 'このファイルは moneyhound のバックアップではありません。',
  unsupported_schema: 'このバックアップの形式には、このバージョンでは対応していません。',
  not_found: '対象が見つかりませんでした。',
  invalid_ledger: 'データ形式が正しくありません。',
  remote_unreadable: 'ドライブ上の台帳を読み取れなかったため、上書きしませんでした。',
  google_not_configured: 'Google クライアント ID が未設定です。',
  gis_load_failed: 'Google のログイン画面を読み込めませんでした。',
  google_auth_cancelled: 'Google ログインをキャンセルしました。',
  google_auth_failed: 'Google ログインに失敗しました。',
  google_scope_rejected: '許可された権限が drive.file ではありません。',
}

export function messageOf(error: unknown): string {
  if (error instanceof LedgerError) return LEDGER_MESSAGES[error.code] ?? '保存できませんでした。'
  if (error instanceof Error) {
    if (error.message.startsWith('drive_')) return 'Google ドライブとの通信に失敗しました。'
    return LEDGER_MESSAGES[error.message] ?? '処理に失敗しました。'
  }
  return '処理に失敗しました。'
}

export const ACCOUNT_KIND_LABEL = {
  cash: '現金',
  bank: '銀行',
  card: 'カード',
  emoney: '電子マネー',
  securities: '証券',
  other: 'その他',
} as const
