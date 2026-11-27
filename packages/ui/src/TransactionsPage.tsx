import { useState, type FormEvent } from 'react'
import { defaultDateForMonth, formatIsoDate, yearMonthOf } from '@moneyhound/core'
import {
  activeAccounts,
  activeCategories,
  addTransaction,
  deleteTransaction,
  updateTransaction,
  visibleTransactions,
  type TransactionInput,
} from '@moneyhound/core'
import { formatYen, parseYen } from '@moneyhound/core'
import type { Ledger, Transaction, TransactionType } from '@moneyhound/core'
import { messageOf } from './text'

function clock() {
  return { now: new Date().toISOString(), id: () => crypto.randomUUID() }
}

export function TransactionsPage({
  ledger,
  yearMonth,
  onCommit,
}: {
  ledger: Ledger
  yearMonth: string
  onCommit: (ledger: Ledger) => Promise<void>
}) {
  const [dialog, setDialog] = useState<Transaction | 'new' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const items = visibleTransactions(ledger).filter(
    (transaction) => yearMonthOf(transaction.date) === yearMonth,
  )
  const names = new Map(ledger.categories.map((category) => [category.id, category.name]))
  const accounts = new Map(ledger.accounts.map((account) => [account.id, account.name]))

  async function remove(id: string) {
    try {
      await onCommit(deleteTransaction(ledger, id, clock()))
      setPendingDelete(null)
    } catch (error) {
      window.alert(messageOf(error))
    }
  }

  return (
    <>
      <div className="toolbar">
        <p className="note">この月の明細です。</p>
        <button
          type="button"
          className="primary"
          data-testid="add-transaction"
          onClick={() => setDialog('new')}
        >
          明細を追加
        </button>
      </div>
      {items.length === 0 ? (
        <p className="empty" data-testid="empty-transactions">
          この月の明細はまだありません。
        </p>
      ) : (
        <ul className="list" data-testid="transaction-list">
          {items.map((transaction) => (
            <li key={transaction.id} className="tx">
              <div>
                <p>
                  <span className="tag">{labelOf(transaction.type)}</span>
                  {transaction.description || transaction.memo || '（内容なし）'}
                </p>
                <p className="muted">
                  {formatIsoDate(transaction.date)} ·{' '}
                  {names.get(transaction.categoryId ?? '') ??
                    (transaction.type === 'transfer' ? '振替' : '未分類')}{' '}
                  · {accountPhrase(transaction, accounts)}
                  {transaction.memo && transaction.description ? ` · ${transaction.memo}` : ''}
                </p>
              </div>
              <div>
                <p className={`amount ${transaction.type}`}>{signed(transaction)}</p>
                <div className="row-actions">
                  {pendingDelete === transaction.id ? (
                    <>
                      <button
                        type="button"
                        className="danger"
                        data-testid="confirm-delete"
                        onClick={() => void remove(transaction.id)}
                      >
                        削除する
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setPendingDelete(null)}
                      >
                        やめる
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        data-testid="edit-transaction"
                        onClick={() => setDialog(transaction)}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        data-testid="delete-transaction"
                        onClick={() => setPendingDelete(transaction.id)}
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog ? (
        <TransactionDialog
          key={dialog === 'new' ? 'new' : dialog.id}
          ledger={ledger}
          yearMonth={yearMonth}
          existing={dialog === 'new' ? null : dialog}
          onCommit={onCommit}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}

function accountPhrase(transaction: Transaction, accounts: Map<string, string>): string {
  const source = transaction.accountId
    ? (accounts.get(transaction.accountId) ?? '口座')
    : '振替元未設定'
  if (transaction.type !== 'transfer') return source
  const destination = transaction.transferAccountId
    ? (accounts.get(transaction.transferAccountId) ?? '口座')
    : '振替先未設定'
  return `${source} → ${destination}`
}

function labelOf(type: TransactionType): string {
  if (type === 'income') return '収入'
  if (type === 'transfer') return '振替'
  return '支出'
}

function signed(transaction: Transaction): string {
  if (transaction.type === 'expense') return formatYen(-transaction.amountYen)
  return formatYen(transaction.amountYen)
}

function TransactionDialog({
  ledger,
  yearMonth,
  existing,
  onCommit,
  onClose,
}: {
  ledger: Ledger
  yearMonth: string
  onCommit: (ledger: Ledger) => Promise<void>
  existing: Transaction | null
  onClose: () => void
}) {
  const [type, setType] = useState<TransactionType>(existing?.type ?? 'expense')
  const [date, setDate] = useState(existing?.date ?? defaultDateForMonth(yearMonth))
  const [amount, setAmount] = useState(existing ? String(existing.amountYen) : '')
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '')
  const [accountId, setAccountId] = useState(
    existing ? (existing.accountId ?? '') : (activeAccounts(ledger)[0]?.id ?? ''),
  )
  const [transferAccountId, setTransferAccountId] = useState(
    existing ? (existing.transferAccountId ?? '') : (activeAccounts(ledger)[1]?.id ?? ''),
  )
  const [description, setDescription] = useState(existing?.description ?? '')
  const [memo, setMemo] = useState(existing?.memo ?? '')
  const [error, setError] = useState<string | null>(null)

  const categories = activeCategories(ledger, type === 'income' ? 'income' : 'expense')
  const accounts = activeAccounts(ledger)
  const chosenCategory = categories.some((category) => category.id === categoryId)
    ? categoryId
    : (categories[0]?.id ?? '')
  const transferChoices = accounts.filter((account) => account.id !== accountId)
  const chosenTransfer =
    transferAccountId === '' || transferChoices.some((account) => account.id === transferAccountId)
      ? transferAccountId
      : (transferChoices[0]?.id ?? '')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseYen(amount)
    if (parsed === null || parsed <= 0) {
      setError('金額は1円以上の整数で入力してください。')
      return
    }
    if (type !== 'transfer' && !accountId) {
      setError('口座を選んでください。')
      return
    }
    if (type === 'transfer' && !accountId && !chosenTransfer) {
      setError('振替元か振替先を選んでください。')
      return
    }
    const input: TransactionInput = {
      date,
      amountYen: parsed,
      type,
      categoryId: type === 'transfer' ? null : chosenCategory || null,
      accountId: accountId || null,
      transferAccountId: type === 'transfer' ? chosenTransfer || null : null,
      description,
      memo,
    }
    try {
      const next = existing
        ? updateTransaction(ledger, existing.id, input, clock())
        : addTransaction(ledger, input, clock())
      await onCommit(next)
      onClose()
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <h3 id="tx-title">{existing ? '明細を編集' : '明細を追加'}</h3>
        <div className="fields">
          <div className="choices">
            {(['expense', 'income', 'transfer'] as const).map((value) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                />
                {labelOf(value)}
              </label>
            ))}
          </div>
          <label>
            日付
            <input
              data-testid="date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <label>
            金額（円）
            <input
              data-testid="amount"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          {type !== 'transfer' ? (
            <label>
              カテゴリ
              <select
                data-testid="category"
                value={chosenCategory}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {type === 'transfer' ? '出どころ' : '口座'}
            <select
              data-testid="account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {type === 'transfer' ? <option value="">振替元未設定</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          {type === 'transfer' ? (
            <label>
              振替先
              <select
                data-testid="transfer-account"
                value={chosenTransfer}
                onChange={(event) => setTransferAccountId(event.target.value)}
              >
                <option value="">振替先未設定</option>
                {transferChoices.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            内容
            <input
              data-testid="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            メモ
            <input
              data-testid="memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </label>
        </div>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="primary" data-testid="save-transaction">
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
