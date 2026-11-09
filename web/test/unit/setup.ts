// The bits of the browser the hooks touch at import or in their storage helpers:
// localStorage, window events and the root element's style. Fresh before each test.
import { beforeEach } from 'vitest'

class MemoryStorage {
  private items = new Map<string, string>()
  getItem(key: string) { return this.items.get(key) ?? null }
  setItem(key: string, value: string) { this.items.set(key, String(value)) }
  removeItem(key: string) { this.items.delete(key) }
  clear() { this.items.clear() }
}

const g = globalThis as Record<string, unknown>
g.window = new EventTarget()
g.document = { documentElement: { style: {} } }

beforeEach(() => {
  g.localStorage = new MemoryStorage()
})
