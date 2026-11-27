import { expect, type Page, test } from '@playwright/test'

// Fictional rows only.
const CARD_CSV = `カード名称,ミドリカード

ご利用日,ご利用店名,ご利用金額
2026年4月3日,コンビニ ミドリ,580
2026年4月5日,オンラインストア,"12,000"
`

const BANK_CSV = `日付,摘要,お引出し金額（円）,お預入れ金額（円）,差引残高（円）
2026/04/01,前月繰越,,,"120,000"
2026/04/10,給与 サンプル商事,,"250,000","370,000"
2026/04/12,家賃,"80,000",,"290,000"
`

function csv(name: string, text: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') }
}

async function importInto(page: Page, account: string, name: string, text: string) {
  await page.goto('/#/settings')
  const panel = page.getByTestId('statement-import')
  await panel.getByTestId('import-account').selectOption({ label: account })
  await panel.getByTestId('import-statement').setInputFiles(csv(name, text))
  return panel
}

test('imports a card statement into the chosen account', async ({ page }) => {
  const panel = await importInto(page, 'クレジットカード', 'card.csv', CARD_CSV)
  await expect(panel.getByTestId('import-adapter')).toHaveCount(0)
  await expect(panel.getByTestId('import-summary')).toHaveText('追加 2件 · 更新 0件')
  await panel.getByTestId('confirm-statement-import').click()
  await expect(panel.getByTestId('import-message')).toContainText('card.csv を取り込みました')

  await page.getByRole('link', { name: '明細' }).click()
  await page.getByTestId('jump-latest-month').click()
  await expect(page.getByTestId('month-label')).toHaveText('2026年4月')
  const store = page.getByTestId('transaction-list').getByRole('listitem').filter({
    hasText: 'オンラインストア',
  })
  await expect(store).toContainText('クレジットカード')
  await expect(store).toContainText('-12,000円')
})

test('imports a bank statement once', async ({ page }) => {
  let panel = await importInto(page, '銀行口座', 'bank.csv', BANK_CSV)
  await expect(panel.getByTestId('import-summary')).toHaveText('追加 2件 · 更新 0件')
  await panel.getByTestId('confirm-statement-import').click()
  await expect(panel.getByTestId('import-message')).toContainText('bank.csv を取り込みました')

  panel = await importInto(page, '銀行口座', 'bank.csv', BANK_CSV)
  await expect(panel.getByTestId('import-summary')).toContainText('追加 0件 · 更新 0件')
  await expect(panel.getByTestId('confirm-statement-import')).toBeDisabled()

  await page.getByRole('link', { name: '月次' }).click()
  await page.getByTestId('jump-latest-month').click()
  await expect(page.getByTestId('total-income')).toHaveText('250,000円')
  await expect(page.getByTestId('total-expense')).toHaveText('80,000円')
})

test('shows why a file was not read', async ({ page }) => {
  const panel = await importInto(page, '銀行口座', 'other.csv', 'a,b\n1,2\n')
  await expect(panel.getByRole('alert')).toContainText('見出し行')
  await expect(panel.getByTestId('confirm-statement-import')).toBeDisabled()
})

test('fills the missing side of similar one-sided transfers at once', async ({ page }) => {
  await page.goto('/#/transactions')
  for (const amount of ['18000', '20000']) {
    await page.getByTestId('add-transaction').click()
    await page.getByRole('radio', { name: '振替' }).check()
    await page.getByTestId('amount').fill(amount)
    await page.getByTestId('account').selectOption({ label: '銀行口座' })
    await page.getByTestId('transfer-account').selectOption({ label: '振替先未設定' })
    await page.getByTestId('description').fill('カード引落')
    await page.getByTestId('save-transaction').click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  // Optional to fix, so the transactions screen does not nag.
  await expect(page.getByTestId('unresolved-transfers')).toHaveCount(0)

  await page.getByRole('link', { name: '設定' }).click()
  const unresolved = page.getByTestId('unresolved-transfers')
  await expect(unresolved.getByTestId('unresolved-count')).toHaveText('2')
  await unresolved.getByTestId('toggle-unresolved').click()
  const group = unresolved.getByRole('listitem').filter({ hasText: 'カード引落' })
  await expect(group).toContainText('銀行口座 → 振替先未設定')
  await expect(group).toContainText('38,000円')
  await group.getByTestId('resolve-account').selectOption({ label: 'クレジットカード' })
  await expect(group.getByTestId('resolve-save')).toHaveText('2件の振替先にする')
  await group.getByTestId('resolve-save').click()
  await expect(page.getByTestId('unresolved-transfers')).toHaveCount(0)

  await page.getByRole('link', { name: '明細' }).click()
  await expect(page.getByTestId('transaction-list')).toContainText('銀行口座 → クレジットカード')
})
