import { createSignal, For, Show } from 'solid-js'
import { activeCategories, addCategory, removeCategory } from '@moneyhound/core'
import type { CategoryKind, Ledger } from '@moneyhound/core'
import { clock, messageOf } from './text'

export function CategoriesPage(props: {
  ledger: Ledger
  onCommit: (ledger: Ledger) => Promise<void>
}) {
  const [name, setName] = createSignal('')
  const [kind, setKind] = createSignal<CategoryKind>('expense')
  const [error, setError] = createSignal<string | null>(null)

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    try {
      await props.onCommit(addCategory(props.ledger, { name: name(), kind: kind() }, clock()))
      setName('')
      setError(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  async function remove(id: string) {
    try {
      await props.onCommit(removeCategory(props.ledger, id, clock()))
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <section>
      <form class="inline-form" onSubmit={(event) => void onSubmit(event)}>
        <input
          data-testid="category-name"
          aria-label="カテゴリ名"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          placeholder="カテゴリ名"
        />
        <select
          data-testid="category-kind"
          aria-label="区分"
          value={kind()}
          onChange={(event) => setKind(event.currentTarget.value as CategoryKind)}
        >
          <option value="expense">支出</option>
          <option value="income">収入</option>
        </select>
        <button type="submit" class="primary">
          追加
        </button>
      </form>
      <Show when={error()}>
        <p class="alert" role="alert">
          {error()}
        </p>
      </Show>
      <ul class="list" data-testid="category-list">
        <For each={activeCategories(props.ledger)}>
          {(category) => (
            <li class="plain">
              <p>
                <span class="tag">{category.kind === 'income' ? '収入' : '支出'}</span>
                {category.name}
              </p>
              <button
                type="button"
                class="ghost"
                aria-label={`${category.name}を削除`}
                onClick={() => void remove(category.id)}
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
