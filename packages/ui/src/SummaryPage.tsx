import { createMemo, For, Show } from 'solid-js'
import { formatYen, projectAccountBalances, summarizeMonth, type Ledger } from '@moneyhound/core'

export function SummaryPage(props: { ledger: Ledger; yearMonth: string }) {
  const summary = createMemo(() => summarizeMonth(props.ledger, props.yearMonth))
  const names = createMemo(
    () => new Map(props.ledger.categories.map((category) => [category.id, category.name])),
  )
  const maxExpense = () => summary().expenseByCategory[0]?.amountYen ?? 0
  const flows = createMemo(() =>
    projectAccountBalances(props.ledger).filter(
      (flow) => flow.incomeYen || flow.expenseYen || flow.transferInYen || flow.transferOutYen,
    ),
  )
  const categoryName = (id: string | null) => (id ? (names().get(id) ?? '未分類') : '未分類')

  return (
    <>
      <section class="stats" aria-label="月次の合計">
        <article class="stat income">
          <span>収入</span>
          <strong data-testid="total-income">{formatYen(summary().incomeYen)}</strong>
        </article>
        <article class="stat expense">
          <span>支出</span>
          <strong data-testid="total-expense">{formatYen(summary().expenseYen)}</strong>
        </article>
        <article class="stat">
          <span>収支</span>
          <strong data-testid="total-balance">{formatYen(summary().balanceYen)}</strong>
        </article>
        <article class="stat transfer">
          <span>振替</span>
          <strong data-testid="total-transfer">{formatYen(summary().transferYen)}</strong>
        </article>
      </section>
      <p class="note">振替は自分の口座の間の移動なので、収入・支出・収支には入れていません。</p>
      <section class="panel">
        <h3>支出の内訳</h3>
        <Show
          when={summary().expenseByCategory.length > 0}
          fallback={<p class="empty">この月の支出はまだありません。</p>}
        >
          <ul class="bars" data-testid="category-breakdown">
            <For each={summary().expenseByCategory}>
              {(item) => (
                <li>
                  <span>{categoryName(item.categoryId)}</span>
                  <strong>{formatYen(item.amountYen)}</strong>
                  <div class="track">
                    <span
                      style={{
                        width: `${maxExpense() ? (item.amountYen / maxExpense()) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
      <Show when={summary().incomeByCategory.length > 0}>
        <section class="panel">
          <h3>収入の内訳</h3>
          <ul class="bars income-bars">
            <For each={summary().incomeByCategory}>
              {(item) => (
                <li>
                  <span>{categoryName(item.categoryId)}</span>
                  <strong>{formatYen(item.amountYen)}</strong>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={flows().length > 0}>
        <section class="panel">
          <h3>口座の増減</h3>
          <ul class="list">
            <For each={flows()}>
              {(flow) => (
                <li class="plain">
                  <p>
                    {props.ledger.accounts.find((item) => item.id === flow.accountId)?.name ??
                      '口座'}{' '}
                    <strong class="amount">{formatYen(flow.balanceYen)}</strong>
                  </p>
                  <p class="muted">期首残高を含む試算です。資産の推移は今後追加します。</p>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </>
  )
}
