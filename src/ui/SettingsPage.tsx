import { useState, type FormEvent } from 'react'
import { exportBackup, importBackup } from '../domain/backup'
import { todayIso } from '../domain/dates'
import {
  activeAccounts,
  activeCategories,
  addAccount,
  addCategoryRule,
  removeAccount,
  removeCategoryRule,
} from '../domain/ledger'
import type { AccountKind, Ledger } from '../domain/types'
import { commitLedger, reloadLedger, setSyncNote } from '../state/store'
import { GoogleDriveClient } from '../sync/googleDrive'
import { isGoogleConfigured, requestGoogleAccessToken } from '../sync/googleAuth'
import { syncLedger } from '../sync/runSync'
import { ACCOUNT_KIND_LABEL, messageOf } from './text'

function clock() {
  return { now: new Date().toISOString(), id: () => crypto.randomUUID() }
}

export function SettingsPage({ ledger, syncNote }: { ledger: Ledger; syncNote: string | null }) {
  return (
    <>
      <AccountSection ledger={ledger} />
      <RuleSection ledger={ledger} />
      <BackupSection ledger={ledger} />
      <DriveSection syncNote={syncNote} />
    </>
  )
}

function AccountSection({ ledger }: { ledger: Ledger }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('bank')
  const [error, setError] = useState<string | null>(null)
  const accounts = activeAccounts(ledger)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await commitLedger(addAccount(ledger, { name, kind }, clock()))
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
                void commitLedger(removeAccount(ledger, account.id, clock())).catch((caught) =>
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

function RuleSection({ ledger }: { ledger: Ledger }) {
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState(activeCategories(ledger)[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const categories = activeCategories(ledger)
  const rules = ledger.categoryRules.filter((rule) => rule.deletedAt === null)
  const names = new Map(categories.map((category) => [category.id, category.name]))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await commitLedger(
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
              onClick={() => void commitLedger(removeCategoryRule(ledger, rule.id, clock()))}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function BackupSection({ ledger }: { ledger: Ledger }) {
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
      await commitLedger(importBackup(pending))
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

function DriveSection({ syncNote }: { syncNote: string | null }) {
  const [busy, setBusy] = useState(false)
  const [localNote, setLocalNote] = useState<string | null>(null)
  const configured = isGoogleConfigured()
  const note = localNote ?? syncNote

  async function onSync() {
    setBusy(true)
    setLocalNote(null)
    try {
      const token = await requestGoogleAccessToken()
      const result = await syncLedger(new GoogleDriveClient(token))
      await reloadLedger()
      const conflict =
        result.conflicts.length > 0
          ? `同時に編集された ${result.conflicts.length} 件は、更新が新しい方を採用しました。`
          : ''
      const message = result.wrote
        ? `同期しました。${conflict}`
        : `ドライブの内容を取り込みました。${conflict}`
      setLocalNote(message)
      setSyncNote(message)
    } catch (caught) {
      const message = messageOf(caught)
      setLocalNote(message)
      setSyncNote(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-block" data-testid="drive-panel">
      <h2>Google ドライブ</h2>
      {configured ? (
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
            onClick={() => void onSync()}
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
