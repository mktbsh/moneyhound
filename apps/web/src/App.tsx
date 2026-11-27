import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from 'solid-js'
import {
  formatYearMonth,
  hasTransactionsIn,
  latestYearMonth,
  shiftYearMonth,
} from '@moneyhound/core'
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
  ledger,
  loadError,
  ready,
  reloadLedger,
  routeFromHash,
  saving,
  setYearMonth,
  storageKind,
  storageNote,
  yearMonth,
  type RouteName,
} from './state/store'

const LINKS: { route: RouteName; href: string; label: string }[] = [
  { route: 'summary', href: '#/', label: '月次' },
  { route: 'transactions', href: '#/transactions', label: '明細' },
  { route: 'categories', href: '#/categories', label: 'カテゴリ' },
  { route: 'settings', href: '#/settings', label: '設定' },
]

export function App() {
  const [route, setRoute] = createSignal<RouteName>(routeFromHash(window.location.hash))

  onSettled(() => {
    void initLedger()
    const onHash = () => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })

  const latest = createMemo(() => {
    const current = ledger()
    return current ? latestYearMonth(current) : null
  })
  const showJump = createMemo(() => {
    const current = ledger()
    const month = latest()
    return (
      current !== null &&
      month !== null &&
      month !== yearMonth() &&
      !hasTransactionsIn(current, yearMonth())
    )
  })
  const monthly = () => route() === 'summary' || route() === 'transactions'

  async function reload(): Promise<string> {
    try {
      await reloadLedger()
      return 'ドライブから最新の内容を読み込みました。'
    } catch (error) {
      return messageOf(error)
    }
  }

  return (
    <div class="shell">
      <nav class="nav">
        <For each={LINKS}>
          {(link) => (
            <a href={link.href} aria-current={route() === link.route ? 'page' : undefined}>
              {link.label}
            </a>
          )}
        </For>
      </nav>
      <div class="content">
        <header class="top">
          <h1 class="wordmark">
            <i>mh</i>moneyhound
          </h1>
          <p class="mode" data-testid="storage-mode">
            {storageKind() === 'drive' ? 'Google ドライブ' : 'ローカルのみ'}
            {saving() ? ' · 保存中…' : ''}
          </p>
        </header>
        <Show when={!ready()}>
          <p>読み込み中…</p>
        </Show>
        <Show when={loadError()}>
          <p role="alert">{loadError()}</p>
        </Show>
        <Show when={storageNote()}>
          <p class="note" role="status">
            {storageNote()}
          </p>
        </Show>
        <Show when={ledger()}>
          {(current) => (
            <>
              <Show when={monthly()}>
                <div class="month">
                  <button
                    type="button"
                    class="icon-button"
                    data-testid="month-prev"
                    aria-label="前の月"
                    onClick={() => setYearMonth(shiftYearMonth(yearMonth(), -1))}
                  >
                    ‹
                  </button>
                  <h2 data-testid="month-label">{formatYearMonth(yearMonth())}</h2>
                  <button
                    type="button"
                    class="icon-button"
                    data-testid="month-next"
                    aria-label="次の月"
                    onClick={() => setYearMonth(shiftYearMonth(yearMonth(), 1))}
                  >
                    ›
                  </button>
                </div>
                <Show when={showJump()}>
                  <div class="toolbar jump" data-testid="jump-latest">
                    <p class="note">この月の明細はありません。</p>
                    <button
                      type="button"
                      class="ghost"
                      data-testid="jump-latest-month"
                      onClick={() => setYearMonth(latest() ?? yearMonth())}
                    >
                      {formatYearMonth(latest() ?? yearMonth())}へ
                    </button>
                  </div>
                </Show>
              </Show>
              <Switch>
                <Match when={route() === 'summary'}>
                  <SummaryPage ledger={current()} yearMonth={yearMonth()} />
                </Match>
                <Match when={route() === 'transactions'}>
                  <TransactionsPage
                    ledger={current()}
                    yearMonth={yearMonth()}
                    onCommit={commitLedger}
                  />
                </Match>
                <Match when={route() === 'categories'}>
                  <CategoriesPage ledger={current()} onCommit={commitLedger} />
                </Match>
                <Match when={route() === 'settings'}>
                  <SettingsPage
                    ledger={current()}
                    storage={storageKind()}
                    onCommit={commitLedger}
                    onReload={reload}
                  />
                </Match>
              </Switch>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
