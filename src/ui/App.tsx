import { useEffect, useState } from 'react'
import { formatYearMonth, shiftYearMonth } from '../domain/dates'
import { isGoogleConfigured } from '../sync/googleAuth'
import {
  initLedger,
  routeFromHash,
  setYearMonth,
  useSnapshot,
  type RouteName,
} from '../state/store'
import { CategoriesPage } from './CategoriesPage'
import { SettingsPage } from './SettingsPage'
import { SummaryPage } from './SummaryPage'
import { TransactionsPage } from './TransactionsPage'

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
          <TransactionsPage ledger={ledger} yearMonth={snapshot.yearMonth} />
        ) : null}
        {ledger && route === 'categories' ? <CategoriesPage ledger={ledger} /> : null}
        {ledger && route === 'settings' ? (
          <SettingsPage ledger={ledger} syncNote={snapshot.syncNote} />
        ) : null}
      </div>
    </div>
  )
}
