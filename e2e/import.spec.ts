import { expect, test } from '@playwright/test'

// Fictional rows only.
// Like a real MF export, transfer rows are 計算対象=0.
const MF_CSV = `計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
1,2026/04/02,コンビニ,-580,現金,食費,食料品,,,mf-e2e-food
1,2026/04/03,給与,200000,銀行口座,給与,未分類,,,mf-e2e-pay
1,2026/04/05,手入力の昼食,-900,なし,食費,未分類,,0,mf-e2e-none
0,2026/03/27,カード引落,-18000,銀行口座,未分類,未分類,,1,mf-e2e-out-3
0,2026/04/27,カード引落,-20000,銀行口座,未分類,未分類,,1,mf-e2e-out-4
0,2026/04/06,ATM,-10000,銀行口座,未分類,未分類,,1,mf-e2e-atm-out
0,2026/04/06,ATM,10000,現金,未分類,未分類,,1,mf-e2e-atm-in
`

const CARD_CSV = `カード名称,ミドリカード

ご利用日,ご利用店名,ご利用金額
2026年4月3日,コンビニ ミドリ,580
2026年4月5日,オンラインストア,"12,000"
`

function csv(name: string, text: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') }
}

test('imports a Money Forward CSV once and fixes the one-sided transfer', async ({ page }) => {
  await page.goto('/#/settings')
  const panel = page.getByTestId('statement-import')
  await panel.getByTestId('import-adapter').selectOption('mf-csv')
  await panel.getByTestId('import-statement').setInputFiles(csv('mf.csv', MF_CSV))
  await expect(panel.getByTestId('import-summary')).toHaveText(
    '追加 6件 · 更新 0件 · 振替の入金側 1件',
  )
  await expect(panel.getByTestId('import-unresolved')).toContainText('2 件')
  await panel.getByTestId('confirm-statement-import').click()
  await expect(panel.getByTestId('import-message')).toContainText('mf.csv を取り込みました')
  // MF's なし (no account) is booked on 現金, not a new account.
  await expect(page.getByTestId('account-list')).not.toContainText('なし')

  // The same file again adds nothing.
  await panel.getByTestId('import-statement').setInputFiles(csv('mf.csv', MF_CSV))
  await expect(panel.getByTestId('import-summary')).toContainText('追加 0件 · 更新 0件')
  await expect(panel.getByTestId('confirm-statement-import')).toBeDisabled()

  // One-sided transfers are optional to fix, so the transactions screen does not nag.
  await page.getByRole('link', { name: '明細' }).click()
  await expect(page.getByTestId('unresolved-transfers')).toHaveCount(0)
  await page.getByRole('link', { name: '設定' }).click()
  const unresolved = page.getByTestId('unresolved-transfers')
  await expect(unresolved.getByTestId('unresolved-count')).toHaveText('2')
  await unresolved.getByTestId('toggle-unresolved').click()
  const row = unresolved.getByRole('listitem').filter({ hasText: 'カード引落' })
  await expect(row).toContainText('銀行口座 → 振替先未設定')
  await expect(row).toContainText('38,000円')
  await row.getByTestId('resolve-account').selectOption({ label: 'クレジットカード' })
  await expect(row.getByTestId('resolve-save')).toHaveText('2件の振替先にする')
  await row.getByTestId('resolve-save').click()
  await expect(page.getByTestId('unresolved-transfers')).toHaveCount(0)

  // Re-import keeps the chosen destination.
  await panel.getByTestId('import-statement').setInputFiles(csv('mf.csv', MF_CSV))
  await expect(panel.getByTestId('import-summary')).toContainText('追加 0件 · 更新 0件')
  await expect(panel.getByTestId('import-unresolved')).toHaveCount(0)
})

test('imports a card statement into the chosen account', async ({ page }) => {
  await page.goto('/#/settings')
  const panel = page.getByTestId('statement-import')
  await panel.getByTestId('import-adapter').selectOption('institution-csv')
  await panel.getByTestId('import-account').selectOption({ label: 'クレジットカード' })
  await panel.getByTestId('import-statement').setInputFiles(csv('card.csv', CARD_CSV))
  await expect(panel.getByTestId('import-summary')).toHaveText('追加 2件 · 更新 0件')
  await panel.getByTestId('confirm-statement-import').click()
  await expect(panel.getByTestId('import-message')).toContainText('card.csv を取り込みました')

  await page.getByRole('link', { name: '明細' }).click()
  await page.getByTestId('jump-latest-month').click()
  await expect(page.getByTestId('month-label')).toHaveText('2026年4月')
  const list = page.getByTestId('transaction-list')
  await expect(list).toContainText('オンラインストア')
  await expect(list.getByRole('listitem').filter({ hasText: 'オンラインストア' })).toContainText(
    'クレジットカード',
  )
  await expect(list.getByRole('listitem').filter({ hasText: 'オンラインストア' })).toContainText(
    '-12,000円',
  )
})

test('shows why a file was not read', async ({ page }) => {
  await page.goto('/#/settings')
  const panel = page.getByTestId('statement-import')
  await panel.getByTestId('import-adapter').selectOption('mf-csv')
  await panel.getByTestId('import-statement').setInputFiles(csv('card.csv', CARD_CSV))
  await expect(panel.getByRole('alert')).toContainText('収入・支出詳細')
  await expect(panel.getByTestId('confirm-statement-import')).toBeDisabled()
})
