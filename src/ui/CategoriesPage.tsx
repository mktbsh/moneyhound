import { useState, type FormEvent } from 'react'
import { activeCategories, addCategory, removeCategory } from '../domain/ledger'
import type { CategoryKind, Ledger } from '../domain/types'
import { commitLedger } from '../state/store'
import { messageOf } from './text'

function clock() {
  return { now: new Date().toISOString(), id: () => crypto.randomUUID() }
}

export function CategoriesPage({ ledger }: { ledger: Ledger }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [error, setError] = useState<string | null>(null)
  const categories = activeCategories(ledger)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await commitLedger(addCategory(ledger, { name, kind }, clock()))
      setName('')
      setError(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  async function remove(id: string) {
    try {
      await commitLedger(removeCategory(ledger, id, clock()))
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  return (
    <section>
      <form className="inline-form" onSubmit={(event) => void onSubmit(event)}>
        <input
          data-testid="category-name"
          aria-label="カテゴリ名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="カテゴリ名"
        />
        <select
          data-testid="category-kind"
          aria-label="区分"
          value={kind}
          onChange={(event) => setKind(event.target.value as CategoryKind)}
        >
          <option value="expense">支出</option>
          <option value="income">収入</option>
        </select>
        <button type="submit" className="primary">
          追加
        </button>
      </form>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="list" data-testid="category-list">
        {categories.map((category) => (
          <li key={category.id} className="plain">
            <p>
              <span className="tag">{category.kind === 'income' ? '収入' : '支出'}</span>
              {category.name}
            </p>
            <button
              type="button"
              className="ghost"
              aria-label={`${category.name}を削除`}
              onClick={() => void remove(category.id)}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
