import { useEffect, useState } from 'react'
import { formatYearMonth, shiftYearMonth } from '@moneyhound/core'
import {
  CategoriesPage,
  messageOf,
  SettingsPage,
  SummaryPage,
  TransactionsPage,
} from '@moneyhound/ui'
import {
  commitLedger,
  initLedger,
  reloadLedger,
  routeFromHash,
  setSyncNote,
  setYearMonth,
  useSnapshot,
  type RouteName,
} from './state/store'
import { isGoogleConfigured, requestGoogleAccessToken } from './sync/googleAuth'
import { GoogleDriveClient } from './sync/googleDrive'
import { syncLedger } from './sync/runSync'

const LINKS: { route: RouteName; href: string; label: string }[] = [
  { route: 'summary', href: '#/', label: '月次' },
  { route: 'transactions', href: '#/transactions', label: '明細' },
  { route: 'categories', href: '#/categories', label: 'カテゴリ' },
  { route: 'settings', href: '#/settings', label: '設定' },
]

export function App() {
  const snapshot = useSnapshot()
  const [route, setRoute] = useState<RouteName>(() => routeFromHash(window.location.hash))

  useEffect(() => {
    void initLedger()
    const onHash = () => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const ledger = snapshot.ledger

  async function sync(): Promise<string> {
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
      setSyncNote(message)
      return message
    } catch (error) {
      const message = messageOf(error)
      setSyncNote(message)
      return message
    }
  }

  return (
    <div className="shell">
      <nav className="nav">
        {LINKS.map((link) => (
          <a
            key={link.route}
            href={link.href}
            aria-current={route === link.route ? 'page' : undefined}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <div className="content">
        <header className="top">
          <h1 className="wordmark">
            <i>mh</i>moneyhound
          </h1>
          <p className="mode" data-testid="storage-mode">
            {isGoogleConfigured() ? 'Google ドライブ' : 'ローカルのみ'}
          </p>
        </header>
        {!snapshot.ready ? <p>読み込み中…</p> : null}
        {snapshot.loadError ? <p role="alert">{snapshot.loadError}</p> : null}
        {ledger && (route === 'summary' || route === 'transactions') ? (
          <div className="month">
            <button
              type="button"
              className="icon-button"
              data-testid="month-prev"
              aria-label="前の月"
              onClick={() => setYearMonth(shiftYearMonth(snapshot.yearMonth, -1))}
            >
              ‹
            </button>
            <h2 data-testid="month-label">{formatYearMonth(snapshot.yearMonth)}</h2>
            <button
              type="button"
              className="icon-button"
              data-testid="month-next"
              aria-label="次の月"
              onClick={() => setYearMonth(shiftYearMonth(snapshot.yearMonth, 1))}
            >
              ›
            </button>
          </div>
        ) : null}
        {ledger && route === 'summary' ? (
          <SummaryPage ledger={ledger} yearMonth={snapshot.yearMonth} />
        ) : null}
        {ledger && route === 'transactions' ? (
          <TransactionsPage
            ledger={ledger}
            yearMonth={snapshot.yearMonth}
            onCommit={commitLedger}
          />
        ) : null}
        {ledger && route === 'categories' ? (
          <CategoriesPage ledger={ledger} onCommit={commitLedger} />
        ) : null}
        {ledger && route === 'settings' ? (
          <SettingsPage
            ledger={ledger}
            syncNote={snapshot.syncNote}
            driveConfigured={isGoogleConfigured()}
            onCommit={commitLedger}
            onSync={sync}
          />
        ) : null}
      </div>
    </div>
  )
}
