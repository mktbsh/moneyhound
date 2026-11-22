import { projectAccountBalances, summarizeMonth } from '../domain/aggregate'
import { formatYen } from '../domain/money'
import type { Ledger } from '../domain/types'

export function SummaryPage({ ledger, yearMonth }: { ledger: Ledger; yearMonth: string }) {
  const summary = summarizeMonth(ledger, yearMonth)
  const names = new Map(ledger.categories.map((category) => [category.id, category.name]))
  const maxExpense = summary.expenseByCategory[0]?.amountYen ?? 0
  const flows = projectAccountBalances(ledger).filter(
    (flow) => flow.incomeYen || flow.expenseYen || flow.transferInYen || flow.transferOutYen,
  )

  return (
    <>
      <section className="stats" aria-label="月次の合計">
        <article className="stat income">
          <span>収入</span>
          <strong data-testid="total-income">{formatYen(summary.incomeYen)}</strong>
        </article>
        <article className="stat expense">
          <span>支出</span>
          <strong data-testid="total-expense">{formatYen(summary.expenseYen)}</strong>
        </article>
        <article className="stat">
          <span>収支</span>
          <strong data-testid="total-balance">{formatYen(summary.balanceYen)}</strong>
        </article>
        <article className="stat transfer">
          <span>振替</span>
          <strong data-testid="total-transfer">{formatYen(summary.transferYen)}</strong>
        </article>
      </section>
      <p className="note">振替は自分の口座の間の移動なので、収入・支出・収支には入れていません。</p>
      <section className="panel">
        <h3>支出の内訳</h3>
        {summary.expenseByCategory.length === 0 ? (
          <p className="empty">この月の支出はまだありません。</p>
        ) : (
          <ul className="bars" data-testid="category-breakdown">
            {summary.expenseByCategory.map((item) => (
              <li key={item.categoryId ?? 'none'}>
                <span>{item.categoryId ? (names.get(item.categoryId) ?? '未分類') : '未分類'}</span>
                <strong>{formatYen(item.amountYen)}</strong>
                <div className="track">
                  <span
                    style={{ width: `${maxExpense ? (item.amountYen / maxExpense) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {summary.incomeByCategory.length > 0 ? (
        <section className="panel">
          <h3>収入の内訳</h3>
          <ul className="bars income-bars">
            {summary.incomeByCategory.map((item) => (
              <li key={item.categoryId ?? 'none'}>
                <span>{item.categoryId ? (names.get(item.categoryId) ?? '未分類') : '未分類'}</span>
                <strong>{formatYen(item.amountYen)}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {flows.length > 0 ? (
        <section className="panel">
          <h3>口座の増減</h3>
          <ul className="list">
            {flows.map((flow) => {
              const account = ledger.accounts.find((item) => item.id === flow.accountId)
              return (
                <li key={flow.accountId} className="plain">
                  <p>
                    {account?.name ?? '口座'}{' '}
                    <strong className="amount">{formatYen(flow.balanceYen)}</strong>
                  </p>
                  <p className="muted">期首残高を含む試算です。資産の推移は今後追加します。</p>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </>
  )
}
