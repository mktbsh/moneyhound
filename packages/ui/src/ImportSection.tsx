import { useMemo, useState } from 'react'
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
import { messageOf } from './text'

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

function clock() {
  return { now: new Date().toISOString(), id: () => crypto.randomUUID() }
}

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
  if (report.paired) parts.push(`振替の入金側 ${report.paired}件`)
  if (report.skipped) parts.push(`計算対象外 ${report.skipped}件`)
  return parts.join(' · ')
}

export function ImportSection({ ledger, onCommit }: { ledger: Ledger; onCommit: Commit }) {
  const [adapterId, setAdapterId] = useState(importers[0].id)
  const accounts = activeAccounts(ledger)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needsAccount = adapterId === INSTITUTION_CSV_ADAPTER_ID
  const chosenAccount = accounts.some((item) => item.id === accountId)
    ? accountId
    : (accounts[0]?.id ?? '')

  const preview = useMemo<Preview | null>(() => {
    if (!file) return null
    const parsed = parseWith(ledger, adapterId, chosenAccount, file)
    if (!parsed) return null
    const applied = applyImport(ledger, parsed, PREVIEW_CLOCK)
    return {
      parsed,
      report: applied.report,
      unresolved: unresolvedTransfers(applied.ledger).length,
    }
  }, [ledger, adapterId, chosenAccount, file])

  const canApply =
    preview !== null &&
    !preview.parsed.fileError &&
    preview.report.inserted + preview.report.updated + preview.report.excluded > 0

  async function confirm() {
    if (!file) return
    setBusy(true)
    try {
      const parsed = parseWith(ledger, adapterId, chosenAccount, file)
      if (!parsed || parsed.fileError) return
      const applied = applyImport(ledger, parsed, clock())
      await onCommit(applied.ledger)
      const unresolved = unresolvedTransfers(applied.ledger).length
      setFile(null)
      setMessage(
        `${file.fileName} を取り込みました（${reportLine(applied.report)}）。` +
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
    <section className="settings-block" data-testid="statement-import">
      <h2>明細の取り込み</h2>
      <p className="note">
        CSV
        を読み込んで明細に追加します。同じファイルを何度読み込んでも重複しません。手入力で選んだカテゴリは上書きしません。ファイルはこの端末の中だけで読みます。
      </p>
      <div className="import-form">
        <label>
          形式
          <select
            data-testid="import-adapter"
            value={adapterId}
            onChange={(event) => {
              setAdapterId(event.target.value)
              setMessage(null)
            }}
          >
            {importers.map((importer) => (
              <option key={importer.id} value={importer.id}>
                {importer.label}
              </option>
            ))}
          </select>
        </label>
        {needsAccount ? (
          <label>
            取り込み先の口座
            <select
              data-testid="import-account"
              value={chosenAccount}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {needsAccount ? (
          <p className="note">
            カード口座を選ぶと、金額が1列のCSVは正の金額を支出として読みます。口座は上の「口座」で追加できます。
          </p>
        ) : null}
        <div className="row-actions">
          <label className="ghost">
            CSV を選ぶ
            <input
              data-testid="import-statement"
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const picked = event.target.files?.[0]
                event.target.value = ''
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
      {preview ? (
        <div className="panel" data-testid="import-preview">
          <h3>{preview.parsed.fileName}</h3>
          {preview.parsed.fileError ? (
            <p className="alert" role="alert">
              {preview.parsed.fileError}
            </p>
          ) : (
            <>
              <p data-testid="import-summary">{reportLine(preview.report)}</p>
              {preview.unresolved ? (
                <p className="note" data-testid="import-unresolved">
                  取り込み後、相手口座が未設定の振替は {preview.unresolved} 件になります。
                </p>
              ) : null}
            </>
          )}
          {preview.parsed.errors.length ? (
            <div className="note" data-testid="import-errors">
              <p>読み飛ばす行が {preview.parsed.errors.length} 件あります。</p>
              <ul>
                {preview.parsed.errors.slice(0, SHOWN_ERRORS).map((error) => (
                  <li key={error.line}>
                    {error.line}行目: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              data-testid="confirm-statement-import"
              disabled={!canApply || busy}
              onClick={() => void confirm()}
            >
              取り込む
            </button>
            <button type="button" className="ghost" onClick={() => setFile(null)}>
              やめる
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="note" data-testid="import-message">
          {message}
        </p>
      ) : null}
    </section>
  )
}
