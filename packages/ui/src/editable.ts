import { createSignal } from 'solid-js'

/**
 * Local form state seeded from props. Until the user picks a value, the
 * accessor follows `fallback` (so it stays reactive to props); after a pick it
 * keeps the user's value. Use this instead of reading props once in a
 * component body, which Solid 2 reports as STRICT_READ_UNTRACKED.
 */
export function editable<T>(fallback: () => T): [() => T, (value: T) => void] {
  const [picked, setPicked] = createSignal<{ value: T } | null>(null)
  const read = () => {
    const current = picked()
    return current ? current.value : fallback()
  }
  return [read, (value: T) => setPicked({ value })]
}
