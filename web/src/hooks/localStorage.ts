import { useSyncExternalStore } from 'react'

// Keep personal changes available in this tab when persistent storage fails.
// Later edits must build on these values, not the older persisted version.
const pending = new Map<string, string>()
const listeners = new Set<() => void>()
const emit = () => { for (const listener of listeners) listener() }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', e => {
    if (!pending.size) return
    e.preventDefault()
    // Browsers show their own warning before discarding these unsaved edits.
    ;(e as BeforeUnloadEvent).returnValue = ''
  })
}

/** The stored value, null when there is none or storage can't be read. */
export function readLocal(key: string): string | null {
  if (pending.has(key)) return pending.get(key)!
  try { return localStorage.getItem(key) } catch { return null }
}

export function readLocalRecord<T>(key: string): Record<string, T> {
  try {
    const value = JSON.parse(readLocal(key) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** Never throws: a failed write is kept in memory (see above); false then. */
export function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    if (pending.delete(key)) emit()
    return true
  } catch {
    const first = !pending.has(key)
    pending.set(key, value)
    if (first) emit()
    return false
  }
}

export function retryLocalWrites() {
  for (const [key, value] of pending) writeLocal(key, value)
}

export function usePendingLocalWrites(): number {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => pending.size,
  )
}
