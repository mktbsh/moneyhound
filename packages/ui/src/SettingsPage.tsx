import { createSignal, For, Show } from 'solid-js'
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
import { editable } from './editable'
import { ImportSection } from './ImportSection'
import { ACCOUNT_KIND_LABEL, clock, messageOf } from './text'
import { UnresolvedTransfers } from './UnresolvedTransfers'

type Commit = (ledger: Ledger) => Promise<void>

export function SettingsPage(props: {
  ledger: Ledger
  storage: 'drive' | 'local'
  onCommit: Commit
  onReload: () => Promise<string>
}) {
  return (
    <>
      <AccountSection ledger={props.ledger} onCommit={props.onCommit} />
      <RuleSection ledger={props.ledger} onCommit={props.onCommit} />
      <ImportSection ledger={props.ledger} onCommit={props.onCommit} />
      <UnresolvedTransfers ledger={props.ledger} onCommit={props.onCommit} />
      <BackupSection ledger={props.ledger} onCommit={props.onCommit} />
      <StorageSection storage={props.storage} onReload={props.onReload} />
    </>
  )
}

function AccountSection(props: { ledger: Ledger; onCommit: Commit }) {
  const [name, setName] = createSignal('')
  const [kind, setKind] = createSignal<AccountKind>('bank')
  const [error, setError] = createSignal<string | null>(null)

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    try {
      await props.onCommit(addAccount(props.ledger, { name: name(), kind: kind() }, clock()))
      setName('')
      setError(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <section class="settings-block">
      <h2>口座</h2>
      <form class="inline-form" onSubmit={(event) => void onSubmit(event)}>
        <input
          data-testid="account-name"
          aria-label="口座名"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          placeholder="口座名"
        />
        <select
          data-testid="account-kind"
          aria-label="口座の種類"
          value={kind()}
          onChange={(event) => setKind(event.currentTarget.value as AccountKind)}
        >
          <For each={Object.entries(ACCOUNT_KIND_LABEL)}>
            {([value, label]) => <option value={value}>{label}</option>}
          </For>
        </select>
        <button type="submit" class="primary">
          追加
        </button>
      </form>
      <Show when={error()}>
        <p class="alert">{error()}</p>
      </Show>
      <ul class="list" data-testid="account-list">
        <For each={activeAccounts(props.ledger)}>
          {(account) => (
            <li class="plain">
              <p>
                <span class="tag">{ACCOUNT_KIND_LABEL[account.kind]}</span>
                {account.name}
              </p>
              <button
                type="button"
                class="ghost"
                aria-label={`${account.name}を削除`}
                onClick={() =>
                  void props
                    .onCommit(removeAccount(props.ledger, account.id, clock()))
                    .catch((caught) => setError(messageOf(caught)))
                }
              >
                削除
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}

function RuleSection(props: { ledger: Ledger; onCommit: Commit }) {
  const [pattern, setPattern] = createSignal('')
  const [categoryId, setCategoryId] = editable(() => activeCategories(props.ledger)[0]?.id ?? '')
  const [error, setError] = createSignal<string | null>(null)
  const categories = () => activeCategories(props.ledger)
  const rules = () => props.ledger.categoryRules.filter((rule) => rule.deletedAt === null)
  const names = () => new Map(categories().map((category) => [category.id, category.name]))

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    try {
      await props.onCommit(
        addCategoryRule(
          props.ledger,
          { pattern: pattern(), categoryId: categoryId(), operator: 'contains' },
          clock(),
        ),
      )
      setPattern('')
      setError(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <section class="settings-block">
      <h2>自動分類ルール</h2>
      <p class="note">
        取り込み時に、内容が条件を含む明細へカテゴリを付けます。先に登録したルールから順に見ます。手入力で選んだカテゴリは上書きしません。
      </p>
      <form class="inline-form" onSubmit={(event) => void onSubmit(event)}>
        <input
          data-testid="rule-pattern"
          aria-label="内容に含む文字"
          value={pattern()}
          onInput={(event) => setPattern(event.currentTarget.value)}
          placeholder="内容に含む文字"
        />
        <select
          data-testid="rule-category"
          aria-label="付けるカテゴリ"
          value={categoryId()}
          onChange={(event) => setCategoryId(event.currentTarget.value)}
        >
          <For each={categories()}>
            {(category) => <option value={category.id}>{category.name}</option>}
          </For>
        </select>
        <button type="submit" class="primary">
          ルールを追加
        </button>
      </form>
      <Show when={error()}>
        <p class="alert">{error()}</p>
      </Show>
      <ul class="list">
        <For each={rules()}>
          {(rule) => (
            <li class="plain">
              <p>
                「{rule.pattern}」→ {names().get(rule.categoryId) ?? 'カテゴリ'}
              </p>
              <button
                type="button"
                class="ghost"
                onClick={() =>
                  void props.onCommit(removeCategoryRule(props.ledger, rule.id, clock()))
                }
              >
                削除
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}

function BackupSection(props: { ledger: Ledger; onCommit: Commit }) {
  const [pending, setPending] = createSignal<string | null>(null)
  const [message, setMessage] = createSignal<string | null>(null)

  function download() {
    const text = exportBackup(props.ledger, new Date().toISOString())
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `moneyhound-backup-${todayIso()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function confirm() {
    const text = pending()
    if (!text) return
    try {
      await props.onCommit(importBackup(text))
      setPending(null)
      setMessage('バックアップを読み込み、台帳を置き換えました。')
    } catch (caught) {
      setMessage(messageOf(caught))
    }
  }

  return (
    <section class="settings-block">
      <h2>バックアップ</h2>
      <p class="note">JSON で書き出します。読み込むと台帳を置き換えます。</p>
      <div class="row-actions">
        <button type="button" class="primary" data-testid="export-json" onClick={download}>
          書き出す
        </button>
        <label class="ghost">
          ファイルを選ぶ
          <input
            data-testid="import-file"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const input = event.currentTarget
              const file = input.files?.[0]
              if (!file) return
              void file.text().then((text) => {
                setPending(text)
                setMessage(null)
              })
              input.value = ''
            }}
          />
        </label>
        <Show when={pending()}>
          <button
            type="button"
            class="danger"
            data-testid="confirm-import"
            onClick={() => void confirm()}
          >
            この内容で置き換える
          </button>
        </Show>
      </div>
      <Show when={message()}>
        <p class="note">{message()}</p>
      </Show>
    </section>
  )
}

function StorageSection(props: { storage: 'drive' | 'local'; onReload: () => Promise<string> }) {
  const [busy, setBusy] = createSignal(false)
  const [note, setNote] = createSignal<string | null>(null)

  async function reload() {
    setBusy(true)
    setNote(null)
    try {
      setNote(await props.onReload())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="settings-block" data-testid="drive-panel">
      <h2>保存先</h2>
      <Show
        when={props.storage === 'drive'}
        fallback={
          <p class="note" data-testid="drive-status">
            ローカルのみ（開発用）。このブラウザの IndexedDB に保存しています。
          </p>
        }
      >
        <p class="note" data-testid="drive-status">
          マイドライブの moneyhound フォルダにある ledger.json
          に、変更のたびに保存しています。別の端末で変更した内容は、開き直すか下のボタンで読み込みます。
        </p>
        <button
          type="button"
          class="primary"
          data-testid="reload-drive"
          disabled={busy()}
          onClick={() => void reload()}
        >
          {busy() ? '読み込み中…' : '最新を読み込む'}
        </button>
      </Show>
      <Show when={note()}>
        <p class="note">{note()}</p>
      </Show>
    </section>
  )
}
