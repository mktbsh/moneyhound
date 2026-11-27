import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  activeAccounts,
  fillTransferSides,
  formatIsoDate,
  formatYen,
  groupUnresolvedTransfers,
  type Ledger,
  type UnresolvedTransferGroup,
} from '@moneyhound/core'
import { editable } from './editable'
import { clock, messageOf } from './text'

type Commit = (ledger: Ledger) => Promise<void>

/**
 * Transfers that name only one side, across all months. Optional:
 * old history often cannot be resolved, and leaving it one-sided
 * only affects account balances, never monthly income and expense. So this
 * lives in settings instead of nagging on the transactions screen.
 * Rows with the same description and the same known account are fixed together.
 */
export function UnresolvedTransfers(props: { ledger: Ledger; onCommit: Commit }) {
  const [open, setOpen] = createSignal(false)
  const groups = createMemo(() => groupUnresolvedTransfers(props.ledger))
  const count = () => groups().reduce((total, group) => total + group.transactions.length, 0)
  return (
    <Show when={groups().length > 0}>
      <section class="settings-block" data-testid="unresolved-transfers">
        <h2>振替の相手口座（任意）</h2>
        <p class="note">
          相手口座が未設定の振替が <strong data-testid="unresolved-count">{count()}</strong> 件（
          {groups().length}{' '}
          種類）あります。未設定のままでも収入・支出・収支の集計は変わりません（振替は収支に入らないため）。ずれるのは口座ごとの残高だけです。分かるものだけ設定してください。
        </p>
        <button
          type="button"
          class="ghost"
          data-testid="toggle-unresolved"
          aria-expanded={open() ? 'true' : 'false'}
          onClick={() => setOpen(!open())}
        >
          {open() ? '閉じる' : '一覧を見る'}
        </button>
        <Show when={open()}>
          <p class="note">同じ内容・同じ口座の振替は、まとめて設定します。</p>
          <ul class="list" data-testid="unresolved-list">
            <For each={groups()}>
              {(group) => (
                <UnresolvedGroup ledger={props.ledger} group={group} onCommit={props.onCommit} />
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  )
}

function UnresolvedGroup(props: {
  ledger: Ledger
  group: UnresolvedTransferGroup
  onCommit: Commit
}) {
  const choices = createMemo(() =>
    activeAccounts(props.ledger).filter((account) => account.id !== props.group.knownAccountId),
  )
  const [chosen, setChosen] = editable(() => choices()[0]?.id ?? '')
  const [error, setError] = createSignal<string | null>(null)
  const missingSource = () => props.group.missing === 'source'
  const knownName = () =>
    props.ledger.accounts.find((account) => account.id === props.group.knownAccountId)?.name ??
    '口座'
  const size = () => props.group.transactions.length
  const period = () =>
    props.group.firstDate === props.group.lastDate
      ? formatIsoDate(props.group.firstDate)
      : `${formatIsoDate(props.group.firstDate)}〜${formatIsoDate(props.group.lastDate)}`

  async function save() {
    try {
      await props.onCommit(
        fillTransferSides(
          props.ledger,
          props.group.transactions.map((transaction) => transaction.id),
          chosen(),
          clock(),
        ),
      )
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <li class="plain">
      <div>
        <p>
          {props.group.description || '（内容なし）'}{' '}
          <strong>{formatYen(props.group.totalYen)}</strong>
          <Show when={size() > 1}>
            <span class="muted">（{size()}件）</span>
          </Show>
        </p>
        <p class="muted">
          {period()} ·{' '}
          {missingSource() ? `振替元未設定 → ${knownName()}` : `${knownName()} → 振替先未設定`}
        </p>
        <div class="resolve-form">
          <select
            data-testid="resolve-account"
            aria-label={missingSource() ? '振替元' : '振替先'}
            value={chosen()}
            onChange={(event) => setChosen(event.currentTarget.value)}
          >
            <For each={choices()}>
              {(account) => <option value={account.id}>{account.name}</option>}
            </For>
          </select>
          <button
            type="button"
            class="primary"
            data-testid="resolve-save"
            disabled={!chosen()}
            onClick={() => void save()}
          >
            {size() > 1 ? `${size()}件の` : ''}
            {missingSource() ? '振替元にする' : '振替先にする'}
          </button>
        </div>
        <Show when={error()}>
          <p class="alert">{error()}</p>
        </Show>
      </div>
    </li>
  )
}
