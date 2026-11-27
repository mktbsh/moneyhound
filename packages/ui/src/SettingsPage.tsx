import { useState, type FormEvent } from 'react'
import {
  activeAccounts,
  activeCategories,
  addAccount,
  addCategoryRule,
  exportBackup,
  importBackup,
  removeAccount,
  removeCategoryRule,
  todayIso,
  type AccountKind,
  type Ledger,
} from '@moneyhound/core'
import { ImportSection } from './ImportSection'
import { ACCOUNT_KIND_LABEL, messageOf } from './text'
import { UnresolvedTransfers } from './UnresolvedTransfers'

type Commit = (ledger: Ledger) => Promise<void>

function clock() {
  return { now: new Date().toISOString(), id: () => crypto.randomUUID() }
}

export function SettingsPage({
  ledger,
  syncNote,
  driveConfigured,
  onCommit,
  onSync,
}: {
  ledger: Ledger
  syncNote: string | null
  driveConfigured: boolean
  onCommit: Commit
  onSync: () => Promise<string>
}) {
  return (
    <>
      <AccountSection ledger={ledger} onCommit={onCommit} />
      <RuleSection ledger={ledger} onCommit={onCommit} />
      <ImportSection ledger={ledger} onCommit={onCommit} />
      <UnresolvedTransfers ledger={ledger} onCommit={onCommit} />
      <BackupSection ledger={ledger} onCommit={onCommit} />
      <DriveSection syncNote={syncNote} driveConfigured={driveConfigured} onSync={onSync} />
    </>
  )
}

function AccountSection({ ledger, onCommit }: { ledger: Ledger; onCommit: Commit }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('bank')
  const [error, setError] = useState<string | null>(null)
  const accounts = activeAccounts(ledger)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await onCommit(addAccount(ledger, { name, kind }, clock()))
      setName('')
      setError(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <section className="settings-block">
      <h2>口座</h2>
      <form className="inline-form" onSubmit={(event) => void onSubmit(event)}>
        <input
          data-testid="account-name"
          aria-label="口座名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="口座名"
        />
        <select
          data-testid="account-kind"
          aria-label="口座の種類"
          value={kind}
          onChange={(event) => setKind(event.target.value as AccountKind)}
        >
          {Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="primary">
          追加
        </button>
      </form>
      {error ? <p className="alert">{error}</p> : null}
      <ul className="list" data-testid="account-list">
        {accounts.map((account) => (
          <li key={account.id} className="plain">
            <p>
              <span className="tag">{ACCOUNT_KIND_LABEL[account.kind]}</span>
              {account.name}
            </p>
            <button
              type="button"
              className="ghost"
              aria-label={`${account.name}を削除`}
              onClick={() =>
                void onCommit(removeAccount(ledger, account.id, clock())).catch((caught) =>
                  setError(messageOf(caught)),
                )
              }
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RuleSection({ ledger, onCommit }: { ledger: Ledger; onCommit: Commit }) {
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState(activeCategories(ledger)[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const categories = activeCategories(ledger)
  const rules = ledger.categoryRules.filter((rule) => rule.deletedAt === null)
  const names = new Map(categories.map((category) => [category.id, category.name]))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await onCommit(
        addCategoryRule(ledger, { pattern, categoryId, operator: 'contains' }, clock()),
      )
      setPattern('')
      setError(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <section className="settings-block">
      <h2>自動分類ルール</h2>
      <p className="note">
        取り込み時に、内容が条件を含む明細へカテゴリを付けます。先に登録したルールから順に見ます。手入力で選んだカテゴリは上書きしません。
      </p>
      <form className="inline-form" onSubmit={(event) => void onSubmit(event)}>
        <input
          data-testid="rule-pattern"
          aria-label="内容に含む文字"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="内容に含む文字"
        />
        <select
          data-testid="rule-category"
          aria-label="付けるカテゴリ"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="submit" className="primary">
          ルールを追加
        </button>
      </form>
      {error ? <p className="alert">{error}</p> : null}
      <ul className="list">
        {rules.map((rule) => (
          <li key={rule.id} className="plain">
            <p>
              「{rule.pattern}」→ {names.get(rule.categoryId) ?? 'カテゴリ'}
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => void onCommit(removeCategoryRule(ledger, rule.id, clock()))}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function BackupSection({ ledger, onCommit }: { ledger: Ledger; onCommit: Commit }) {
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function download() {
    const text = exportBackup(ledger, new Date().toISOString())
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `moneyhound-backup-${todayIso()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function confirm() {
    if (!pending) return
    try {
      await onCommit(importBackup(pending))
      setPending(null)
      setMessage('バックアップを読み込み、この端末のデータを置き換えました。')
    } catch (caught) {
      setMessage(messageOf(caught))
    }
  }

  return (
    <section className="settings-block">
      <h2>バックアップ</h2>
      <p className="note">
        JSON
        で書き出します。読み込むとこの端末の台帳を置き換えます。ドライブと同期した記録は、次回の同期で記録ごとに統合されます。
      </p>
      <div className="row-actions">
        <button type="button" className="primary" data-testid="export-json" onClick={download}>
          書き出す
        </button>
        <label className="ghost">
          ファイルを選ぶ
          <input
            data-testid="import-file"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void file.text().then((text) => {
                setPending(text)
                setMessage(null)
              })
              event.target.value = ''
            }}
          />
        </label>
        {pending ? (
          <button
            type="button"
            className="danger"
            data-testid="confirm-import"
            onClick={() => void confirm()}
          >
            この内容で置き換える
          </button>
        ) : null}
      </div>
      {message ? <p className="note">{message}</p> : null}
    </section>
  )
}

function DriveSection({
  syncNote,
  driveConfigured,
  onSync,
}: {
  syncNote: string | null
  driveConfigured: boolean
  onSync: () => Promise<string>
}) {
  const [busy, setBusy] = useState(false)
  const [localNote, setLocalNote] = useState<string | null>(null)
  const note = localNote ?? syncNote

  async function sync() {
    setBusy(true)
    setLocalNote(null)
    try {
      setLocalNote(await onSync())
    } catch (caught) {
      setLocalNote(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-block" data-testid="drive-panel">
      <h2>Google ドライブ</h2>
      {driveConfigured ? (
        <>
          <p className="note" data-testid="drive-status">
            マイドライブの moneyhound フォルダにある ledger.json と同期します。権限は drive.file
            だけです。
          </p>
          <button
            type="button"
            className="primary"
            data-testid="sync-drive"
            disabled={busy}
            onClick={() => void sync()}
          >
            {busy ? '同期中…' : '同期する'}
          </button>
        </>
      ) : (
        <p className="note" data-testid="drive-status">
          ローカルのみ（Google クライアント ID 未設定）。この端末の IndexedDB に保存しています。
        </p>
      )}
      {note ? <p className="note">{note}</p> : null}
    </section>
  )
}
