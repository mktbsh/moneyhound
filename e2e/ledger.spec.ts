import { expect, type Page, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function addTransaction(
  page: Page,
  input: {
    type: '支出' | '収入' | '振替'
    amount: string
    category?: string
    account?: string
    transferAccount?: string
    description: string
  },
) {
  await page.getByTestId('add-transaction').click()
  await page.getByRole('radio', { name: input.type }).check()
  await page.getByTestId('amount').fill(input.amount)
  if (input.category) await page.getByTestId('category').selectOption({ label: input.category })
  if (input.account) await page.getByTestId('account').selectOption({ label: input.account })
  if (input.transferAccount) {
    await page.getByTestId('transfer-account').selectOption({ label: input.transferAccount })
  }
  await page.getByTestId('description').fill(input.description)
  await page.getByTestId('save-transaction').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('records a month, edits it, and restores a backup', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('storage-mode')).toHaveText('ローカルのみ')
  await expect(page.getByTestId('total-income')).toHaveText('0円')
  await expect(page.getByTestId('month-label')).toBeVisible()

  await page.getByRole('link', { name: '明細' }).click()
  await addTransaction(page, {
    type: '支出',
    amount: '1,280',
    category: '食費',
    description: '昼食',
  })
  await expect(page.getByTestId('transaction-list')).toContainText('昼食')

  await page.getByRole('link', { name: '月次' }).click()
  await expect(page.getByTestId('total-expense')).toHaveText('1,280円')
  await expect(page.getByTestId('total-balance')).toHaveText('-1,280円')
  await expect(page.getByTestId('category-breakdown')).toContainText('食費')

  await page.getByRole('link', { name: '明細' }).click()
  const lunch = page.getByRole('listitem').filter({ hasText: '昼食' })
  await lunch.getByTestId('edit-transaction').click()
  await page.getByTestId('amount').fill('1500')
  await page.getByTestId('save-transaction').click()
  await expect(lunch).toContainText('-1,500円')

  await addTransaction(page, {
    type: '収入',
    amount: '100000',
    category: '給与',
    description: '給与明細',
  })
  await addTransaction(page, {
    type: '振替',
    amount: '5000',
    account: '銀行口座',
    transferAccount: '現金',
    description: '引出',
  })

  await page.getByRole('link', { name: '月次' }).click()
  await expect(page.getByTestId('total-income')).toHaveText('100,000円')
  await expect(page.getByTestId('total-expense')).toHaveText('1,500円')
  await expect(page.getByTestId('total-balance')).toHaveText('98,500円')
  await expect(page.getByTestId('total-transfer')).toHaveText('5,000円')

  await page.getByRole('link', { name: '明細' }).click()
  const editedLunch = page.getByRole('listitem').filter({ hasText: '昼食' })
  await editedLunch.getByTestId('delete-transaction').click()
  await editedLunch.getByTestId('confirm-delete').click()
  await expect(page.getByText('昼食')).toHaveCount(0)

  await page.getByRole('link', { name: '月次' }).click()
  await expect(page.getByTestId('total-expense')).toHaveText('0円')
  await expect(page.getByTestId('total-balance')).toHaveText('100,000円')
  await expect(page.getByTestId('total-transfer')).toHaveText('5,000円')

  await page.getByTestId('month-prev').click()
  await expect(page.getByTestId('total-income')).toHaveText('0円')
  await page.getByTestId('month-next').click()
  await expect(page.getByTestId('total-income')).toHaveText('100,000円')

  await page.getByRole('link', { name: 'カテゴリ' }).click()
  await page.getByTestId('category-name').fill('ペット')
  await page.getByTestId('category-kind').selectOption('expense')
  await page.getByRole('button', { name: '追加' }).click()
  await expect(page.getByTestId('category-list')).toContainText('ペット')

  await page.getByRole('link', { name: '設定' }).click()
  await expect(page.getByTestId('drive-status')).toContainText('ローカルのみ')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-json').click(),
  ])
  const backupPath = await download.path()
  expect(backupPath).toBeTruthy()
  const backup = await readFile(backupPath!)

  await page.getByRole('link', { name: '明細' }).click()
  await addTransaction(page, { type: '支出', amount: '999', category: '食費', description: '一時' })
  await expect(page.getByText('一時')).toBeVisible()

  await page.getByRole('link', { name: '設定' }).click()
  await page.getByTestId('import-file').setInputFiles({
    name: 'moneyhound-backup.json',
    mimeType: 'application/json',
    buffer: backup,
  })
  await page.getByTestId('confirm-import').click()
  await expect(page.getByText('置き換えました')).toBeVisible()

  await page.getByRole('link', { name: '明細' }).click()
  await expect(page.getByText('一時')).toHaveCount(0)
  await expect(page.getByText('給与明細')).toBeVisible()
  await expect(page.getByText('引出')).toBeVisible()
})
