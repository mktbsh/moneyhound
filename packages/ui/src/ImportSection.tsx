import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  activeAccounts,
  applyImport,
  getImporter,
  importers,
  INSTITUTION_CSV_ADAPTER_ID,
  unresolvedTransfers,
  type ImportParseResult,
  type ImportReport,
  type Ledger,
} from '@moneyhound/core'
import { editable } from './editable'
import { clock, messageOf } from './text'

type Commit = (ledger: Ledger) => Promise<void>

interface PickedFile {
  bytes: Uint8Array
  fileName: string
}

interface Preview {
  parsed: ImportParseResult
  report: ImportReport
  unresolved: number
}

const PREVIEW_CLOCK = { now: '1970-01-01T00:00:00.000Z', id: () => 'preview' }
const SHOWN_ERRORS = 5

function parseWith(ledger: Ledger, adapterId: string, accountId: string, file: PickedFile) {
  const importer = getImporter(adapterId)
  if (!importer) return null
  const account = activeAccounts(ledger).find((item) => item.id === accountId)
  return importer.parse({
    bytes: file.bytes,
    fileName: file.fileName,
    accountName: account?.name,
    positiveAmountIs: account?.kind === 'card' ? 'expense' : undefined,
  })
}

function reportLine(report: ImportReport): string {
  const parts = [`追加 ${report.inserted}件`, `更新 ${report.updated}件`]
  if (report.unchanged) parts.push(`変更なし ${report.unchanged}件`)
  if (report.excluded) parts.push(`取り消し ${report.excluded}件`)
  if (report.skipped) parts.push(`対象外 ${report.skipped}件`)
  return parts.join(' · ')
}

export function ImportSection(props: { ledger: Ledger; onCommit: Commit }) {
  const [adapterId, setAdapterId] = createSignal(importers[0].id)
  const [file, setFile] = createSignal<PickedFile | null>(null)
  const [message, setMessage] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const accounts = createMemo(() => activeAccounts(props.ledger))
  const [accountId, setAccountId] = editable(() => accounts()[0]?.id ?? '')
  const needsAccount = () => adapterId() === INSTITUTION_CSV_ADAPTER_ID
  const chosenAccount = () =>
    accounts().some((item) => item.id === accountId()) ? accountId() : (accounts()[0]?.id ?? '')

  const preview = createMemo<Preview | null>(() => {
    const picked = file()
    if (!picked) return null
    const parsed = parseWith(props.ledger, adapterId(), chosenAccount(), picked)
    if (!parsed) return null
    const applied = applyImport(props.ledger, parsed, PREVIEW_CLOCK)
    return {
      parsed,
      report: applied.report,
      unresolved: unresolvedTransfers(applied.ledger).length,
    }
  })

  const canApply = () => {
    const current = preview()
    return (
      current !== null &&
      !current.parsed.fileError &&
      current.report.inserted + current.report.updated + current.report.excluded > 0
    )
  }

  async function confirm() {
    const picked = file()
    if (!picked) return
    setBusy(true)
    try {
      const parsed = parseWith(props.ledger, adapterId(), chosenAccount(), picked)
      if (!parsed || parsed.fileError) return
      const applied = applyImport(props.ledger, parsed, clock())
      await props.onCommit(applied.ledger)
      const unresolved = unresolvedTransfers(applied.ledger).length
      setFile(null)
      setMessage(
        `${picked.fileName} を取り込みました（${reportLine(applied.report)}）。` +
          (unresolved
            ? `相手口座が未設定の振替が ${unresolved} 件あります。分かるものは下の「振替の相手口座」で設定できます（任意）。`
            : ''),
      )
    } catch (caught) {
      setMessage(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="settings-block" data-testid="statement-import">
      <h2>明細の取り込み</h2>
      <p class="note">
        CSV
        を読み込んで明細に追加します。同じファイルを何度読み込んでも重複しません。手入力で選んだカテゴリは上書きしません。ファイルはこの端末の中だけで読みます。
      </p>
      <div class="import-form">
        <Show when={importers.length > 1}>
          <label>
            形式
            <select
              data-testid="import-adapter"
              value={adapterId()}
              onChange={(event) => {
                setAdapterId(event.currentTarget.value)
                setMessage(null)
              }}
            >
              <For each={importers}>
                {(importer) => <option value={importer.id}>{importer.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={needsAccount()}>
          <label>
            取り込み先の口座
            <select
              data-testid="import-account"
              value={chosenAccount()}
              onChange={(event) => setAccountId(event.currentTarget.value)}
            >
              <For each={accounts()}>
                {(account) => <option value={account.id}>{account.name}</option>}
              </For>
            </select>
          </label>
          <p class="note">
            カード口座を選ぶと、金額が1列のCSVは正の金額を支出として読みます。口座は上の「口座」で追加できます。
          </p>
        </Show>
        <div class="row-actions">
          <label class="ghost">
            CSV を選ぶ
            <input
              data-testid="import-statement"
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const input = event.currentTarget
                const picked = input.files?.[0]
                input.value = ''
                if (!picked) return
                void picked.arrayBuffer().then((buffer) => {
                  setFile({ bytes: new Uint8Array(buffer), fileName: picked.name })
                  setMessage(null)
                })
              }}
            />
          </label>
        </div>
      </div>
      <Show when={preview()}>
        {(current) => (
          <div class="panel" data-testid="import-preview">
            <h3>{current().parsed.fileName}</h3>
            <Show
              when={!current().parsed.fileError}
              fallback={
                <p class="alert" role="alert">
                  {current().parsed.fileError}
                </p>
              }
            >
              <p data-testid="import-summary">{reportLine(current().report)}</p>
              <Show when={current().unresolved}>
                <p class="note" data-testid="import-unresolved">
                  取り込み後、相手口座が未設定の振替は {current().unresolved} 件になります。
                </p>
              </Show>
            </Show>
            <Show when={current().parsed.errors.length}>
              <div class="note" data-testid="import-errors">
                <p>読み飛ばす行が {current().parsed.errors.length} 件あります。</p>
                <ul>
                  <For each={current().parsed.errors.slice(0, SHOWN_ERRORS)}>
                    {(error) => (
                      <li>
                        {error.line}行目: {error.message}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
            <div class="row-actions">
              <button
                type="button"
                class="primary"
                data-testid="confirm-statement-import"
                disabled={!canApply() || busy()}
                onClick={() => void confirm()}
              >
                取り込む
              </button>
              <button type="button" class="ghost" onClick={() => setFile(null)}>
                やめる
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={message()}>
        <p class="note" data-testid="import-message">
          {message()}
        </p>
      </Show>
    </section>
  )
}
