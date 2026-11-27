import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  activeAccounts,
  activeCategories,
  addTransaction,
  defaultDateForMonth,
  deleteTransaction,
  formatIsoDate,
  formatYen,
  parseYen,
  updateTransaction,
  visibleTransactions,
  yearMonthOf,
  type Ledger,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from '@moneyhound/core'
import { editable } from './editable'
import { clock, messageOf } from './text'

type Commit = (ledger: Ledger) => Promise<void>

export function TransactionsPage(props: { ledger: Ledger; yearMonth: string; onCommit: Commit }) {
  const [dialog, setDialog] = createSignal<Transaction | 'new' | null>(null)
  const [pendingDelete, setPendingDelete] = createSignal<string | null>(null)
  const items = createMemo(() =>
    visibleTransactions(props.ledger).filter(
      (transaction) => yearMonthOf(transaction.date) === props.yearMonth,
    ),
  )
  const names = createMemo(
    () => new Map(props.ledger.categories.map((category) => [category.id, category.name])),
  )
  const accounts = createMemo(
    () => new Map(props.ledger.accounts.map((account) => [account.id, account.name])),
  )

  async function remove(id: string) {
    try {
      await props.onCommit(deleteTransaction(props.ledger, id, clock()))
      setPendingDelete(null)
    } catch (error) {
      window.alert(messageOf(error))
    }
  }

  return (
    <>
      <div class="toolbar">
        <p class="note">この月の明細です。</p>
        <button
          type="button"
          class="primary"
          data-testid="add-transaction"
          onClick={() => setDialog('new')}
        >
          明細を追加
        </button>
      </div>
      <Show
        when={items().length > 0}
        fallback={
          <p class="empty" data-testid="empty-transactions">
            この月の明細はまだありません。
          </p>
        }
      >
        <ul class="list" data-testid="transaction-list">
          <For each={items()}>
            {(transaction) => (
              <li class="tx">
                <div>
                  <p>
                    <span class="tag">{labelOf(transaction.type)}</span>
                    {transaction.description || transaction.memo || '（内容なし）'}
                  </p>
                  <p class="muted">
                    {formatIsoDate(transaction.date)} ·{' '}
                    {names().get(transaction.categoryId ?? '') ??
                      (transaction.type === 'transfer' ? '振替' : '未分類')}{' '}
                    · {accountPhrase(transaction, accounts())}
                    {transaction.memo && transaction.description ? ` · ${transaction.memo}` : ''}
                  </p>
                </div>
                <div>
                  <p class={`amount ${transaction.type}`}>{signed(transaction)}</p>
                  <div class="row-actions">
                    <Show
                      when={pendingDelete() === transaction.id}
                      fallback={
                        <>
                          <button
                            type="button"
                            class="ghost"
                            data-testid="edit-transaction"
                            onClick={() => setDialog(transaction)}
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            class="ghost"
                            data-testid="delete-transaction"
                            onClick={() => setPendingDelete(transaction.id)}
                          >
                            削除
                          </button>
                        </>
                      }
                    >
                      <button
                        type="button"
                        class="danger"
                        data-testid="confirm-delete"
                        onClick={() => void remove(transaction.id)}
                      >
                        削除する
                      </button>
                      <button type="button" class="ghost" onClick={() => setPendingDelete(null)}>
                        やめる
                      </button>
                    </Show>
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={dialog()} keyed>
        {(open) => (
          <TransactionDialog
            ledger={props.ledger}
            yearMonth={props.yearMonth}
            existing={open === 'new' ? null : open}
            onCommit={props.onCommit}
            onClose={() => setDialog(null)}
          />
        )}
      </Show>
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

function TransactionDialog(props: {
  ledger: Ledger
  yearMonth: string
  existing: Transaction | null
  onCommit: Commit
  onClose: () => void
}) {
  // Each field starts from the row being edited (or sensible defaults) and keeps what the user types.
  const [type, setType] = editable<TransactionType>(() => props.existing?.type ?? 'expense')
  const [date, setDate] = editable(
    () => props.existing?.date ?? defaultDateForMonth(props.yearMonth),
  )
  const [amount, setAmount] = editable(() =>
    props.existing ? String(props.existing.amountYen) : '',
  )
  const [categoryId, setCategoryId] = editable(() => props.existing?.categoryId ?? '')
  const [accountId, setAccountId] = editable(() =>
    props.existing ? (props.existing.accountId ?? '') : (activeAccounts(props.ledger)[0]?.id ?? ''),
  )
  const [transferAccountId, setTransferAccountId] = editable(() =>
    props.existing
      ? (props.existing.transferAccountId ?? '')
      : (activeAccounts(props.ledger)[1]?.id ?? ''),
  )
  const [description, setDescription] = editable(() => props.existing?.description ?? '')
  const [memo, setMemo] = editable(() => props.existing?.memo ?? '')
  const [error, setError] = createSignal<string | null>(null)

  const categories = createMemo(() =>
    activeCategories(props.ledger, type() === 'income' ? 'income' : 'expense'),
  )
  const accounts = createMemo(() => activeAccounts(props.ledger))
  const chosenCategory = () =>
    categories().some((category) => category.id === categoryId())
      ? categoryId()
      : (categories()[0]?.id ?? '')
  const transferChoices = createMemo(() =>
    accounts().filter((account) => account.id !== accountId()),
  )
  const chosenTransfer = () =>
    transferAccountId() === '' ||
    transferChoices().some((account) => account.id === transferAccountId())
      ? transferAccountId()
      : (transferChoices()[0]?.id ?? '')

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    const parsed = parseYen(amount())
    if (parsed === null || parsed <= 0) {
      setError('金額は1円以上の整数で入力してください。')
      return
    }
    if (type() !== 'transfer' && !accountId()) {
      setError('口座を選んでください。')
      return
    }
    if (type() === 'transfer' && !accountId() && !chosenTransfer()) {
      setError('振替元か振替先を選んでください。')
      return
    }
    const input: TransactionInput = {
      date: date(),
      amountYen: parsed,
      type: type(),
      categoryId: type() === 'transfer' ? null : chosenCategory() || null,
      accountId: accountId() || null,
      transferAccountId: type() === 'transfer' ? chosenTransfer() || null : null,
      description: description(),
      memo: memo(),
    }
    try {
      const existing = props.existing
      const next = existing
        ? updateTransaction(props.ledger, existing.id, input, clock())
        : addTransaction(props.ledger, input, clock())
      await props.onCommit(next)
      props.onClose()
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <div class="backdrop" onMouseDown={() => props.onClose()}>
      <form
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <h3 id="tx-title">{props.existing ? '明細を編集' : '明細を追加'}</h3>
        <div class="fields">
          <div class="choices">
            <For each={['expense', 'income', 'transfer'] as const}>
              {(value) => (
                <label class="choice">
                  <input
                    type="radio"
                    name="type"
                    value={value}
                    checked={type() === value}
                    onChange={() => setType(value)}
                  />
                  {labelOf(value)}
                </label>
              )}
            </For>
          </div>
          <label>
            日付
            <input
              data-testid="date"
              type="date"
              value={date()}
              onInput={(event) => setDate(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            金額（円）
            <input
              data-testid="amount"
              inputmode="numeric"
              value={amount()}
              onInput={(event) => setAmount(event.currentTarget.value)}
              required
            />
          </label>
          <Show when={type() !== 'transfer'}>
            <label>
              カテゴリ
              <select
                data-testid="category"
                value={chosenCategory()}
                onChange={(event) => setCategoryId(event.currentTarget.value)}
              >
                <For each={categories()}>
                  {(category) => <option value={category.id}>{category.name}</option>}
                </For>
              </select>
            </label>
          </Show>
          <label>
            {type() === 'transfer' ? '出どころ' : '口座'}
            <select
              data-testid="account"
              value={accountId()}
              onChange={(event) => setAccountId(event.currentTarget.value)}
            >
              <Show when={type() === 'transfer'}>
                <option value="">振替元未設定</option>
              </Show>
              <For each={accounts()}>
                {(account) => <option value={account.id}>{account.name}</option>}
              </For>
            </select>
          </label>
          <Show when={type() === 'transfer'}>
            <label>
              振替先
              <select
                data-testid="transfer-account"
                value={chosenTransfer()}
                onChange={(event) => setTransferAccountId(event.currentTarget.value)}
              >
                <option value="">振替先未設定</option>
                <For each={transferChoices()}>
                  {(account) => <option value={account.id}>{account.name}</option>}
                </For>
              </select>
            </label>
          </Show>
          <label>
            内容
            <input
              data-testid="description"
              value={description()}
              onInput={(event) => setDescription(event.currentTarget.value)}
            />
          </label>
          <label>
            メモ
            <input
              data-testid="memo"
              value={memo()}
              onInput={(event) => setMemo(event.currentTarget.value)}
            />
          </label>
        </div>
        <Show when={error()}>
          <p class="alert" role="alert">
            {error()}
          </p>
        </Show>
        <div class="sheet-actions">
          <button type="button" class="ghost" onClick={() => props.onClose()}>
            キャンセル
          </button>
          <button type="submit" class="primary" data-testid="save-transaction">
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
