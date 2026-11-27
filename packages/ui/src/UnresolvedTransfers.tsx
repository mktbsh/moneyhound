import { useState } from 'react'
import {
  activeAccounts,
  fillTransferSides,
  formatIsoDate,
  formatYen,
  groupUnresolvedTransfers,
  type Ledger,
  type UnresolvedTransferGroup,
} from '@moneyhound/core'
import { messageOf } from './text'

type Commit = (ledger: Ledger) => Promise<void>

function clock() {
  return { now: new Date().toISOString(), id: () => crypto.randomUUID() }
}

/**
 * Transfers that name only one side, across all months. Optional:
 * old history often cannot be resolved, and leaving it one-sided
 * only affects account balances, never monthly income and expense. So this
 * lives in settings instead of nagging on the transactions screen.
 * Rows with the same description and the same known account are fixed together.
 */
export function UnresolvedTransfers({ ledger, onCommit }: { ledger: Ledger; onCommit: Commit }) {
  const [open, setOpen] = useState(false)
  const groups = groupUnresolvedTransfers(ledger)
  if (groups.length === 0) return null
  const count = groups.reduce((total, group) => total + group.transactions.length, 0)
  return (
    <section className="settings-block" data-testid="unresolved-transfers">
      <h2>振替の相手口座（任意）</h2>
      <p className="note">
        相手口座が未設定の振替が <strong data-testid="unresolved-count">{count}</strong> 件（
        {groups.length}{' '}
        種類）あります。未設定のままでも収入・支出・収支の集計は変わりません（振替は収支に入らないため）。ずれるのは口座ごとの残高だけです。分かるものだけ設定してください。
      </p>
      <button
        type="button"
        className="ghost"
        data-testid="toggle-unresolved"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '閉じる' : '一覧を見る'}
      </button>
      {open ? (
        <>
          <p className="note">同じ内容・同じ口座の振替は、まとめて設定します。</p>
          <ul className="list" data-testid="unresolved-list">
            {groups.map((group) => (
              <UnresolvedGroup key={group.key} ledger={ledger} group={group} onCommit={onCommit} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function UnresolvedGroup({
  ledger,
  group,
  onCommit,
}: {
  ledger: Ledger
  group: UnresolvedTransferGroup
  onCommit: Commit
}) {
  const names = new Map(ledger.accounts.map((account) => [account.id, account.name]))
  const missingSource = group.missing === 'source'
  const choices = activeAccounts(ledger).filter((account) => account.id !== group.knownAccountId)
  const [chosen, setChosen] = useState(choices[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const knownName = names.get(group.knownAccountId) ?? '口座'
  const size = group.transactions.length
  const period =
    group.firstDate === group.lastDate
      ? formatIsoDate(group.firstDate)
      : `${formatIsoDate(group.firstDate)}〜${formatIsoDate(group.lastDate)}`

  async function save() {
    try {
      await onCommit(
        fillTransferSides(
          ledger,
          group.transactions.map((transaction) => transaction.id),
          chosen,
          clock(),
        ),
      )
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <li className="plain">
      <div>
        <p>
          {group.description || '（内容なし）'} <strong>{formatYen(group.totalYen)}</strong>
          {size > 1 ? <span className="muted">（{size}件）</span> : null}
        </p>
        <p className="muted">
          {period} · {missingSource ? `振替元未設定 → ${knownName}` : `${knownName} → 振替先未設定`}
        </p>
        <div className="resolve-form">
          <select
            data-testid="resolve-account"
            aria-label={missingSource ? '振替元' : '振替先'}
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            {choices.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            data-testid="resolve-save"
            disabled={!chosen}
            onClick={() => void save()}
          >
            {size > 1 ? `${size}件の` : ''}
            {missingSource ? '振替元にする' : '振替先にする'}
          </button>
        </div>
        {error ? <p className="alert">{error}</p> : null}
      </div>
    </li>
  )
}
