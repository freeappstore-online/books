/**
 * IndexedDB cache for generated Kokoro audio.
 * Key: "bookSlug:chapterIdx:voiceId:version"
 * Value: { audio: ArrayBuffer, sampleRate: number, createdAt: number }
 *
 * Avoids regenerating audio for chapters you've already listened to.
 * Cache persists across sessions. Auto-evicts entries older than 30 days.
 */

const DB_NAME = 'bp-audio-cache'
const STORE_NAME = 'chunks'
const DB_VERSION = 1
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_CACHE_MB = isMobile() ? 50 : 500 // limit total cache size

function isMobile(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function cacheKey(
  bookSlug: string,
  chapterIdx: number,
  voiceId: string,
  version: string = 'original',
): string {
  return `${bookSlug}:${chapterIdx}:${voiceId}:${version}`
}

interface CachedAudio {
  /** Raw audio samples as ArrayBuffer (convert to Float32Array for playback) */
  audio: ArrayBuffer
  sampleRate: number
  createdAt: number
}

/** Check if audio exists in cache without reading the full blob. */
export async function hasCachedAudio(key: string): Promise<boolean> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.count(IDBKeyRange.only(key))
      req.onsuccess = () => resolve(req.result > 0)
      req.onerror = () => resolve(false)
    })
  } catch { return false }
}

/** Get cached audio for a chapter. Returns null if not cached. */
export async function getCachedAudio(key: string): Promise<{ audio: Float32Array; sampleRate: number } | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => {
        const entry = req.result as CachedAudio | undefined
        if (!entry) { resolve(null); return }
        // Evict if too old
        if (Date.now() - entry.createdAt > MAX_AGE_MS) {
          deleteCachedAudio(key).catch(() => {})
          resolve(null)
          return
        }
        resolve({ audio: new Float32Array(entry.audio), sampleRate: entry.sampleRate })
      }
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

/** Store generated audio in cache. Evicts oldest if over size limit. */
export async function setCachedAudio(key: string, audio: Float32Array, sampleRate: number): Promise<void> {
  try {
    // Skip caching if this single entry is too large (>20MB)
    const entryMB = (audio.byteLength) / 1024 / 1024
    if (entryMB > 20) return

    const db = await openDB()

    // Check total size and evict oldest if needed
    const stats = await cacheStats()
    if (stats.sizeMB + entryMB > MAX_CACHE_MB) {
      await evictOldest(Math.ceil(entryMB / 5) + 1) // evict enough entries
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const entry: CachedAudio = {
        audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer,
        sampleRate,
        createdAt: Date.now(),
      }
      const req = store.put(entry, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch { /* ignore cache write failures */ }
}

/** Evict N oldest entries. */
async function evictOldest(count: number): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let evicted = 0

    return new Promise((resolve) => {
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor || evicted >= count) { resolve(); return }
        cursor.delete()
        evicted++
        cursor.continue()
      }
      req.onerror = () => resolve()
    })
  } catch { /* ignore */ }
}

async function deleteCachedAudio(key: string): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
    })
  } catch { /* ignore */ }
}

/** Evict all entries older than MAX_AGE_MS. Run periodically. */
export async function evictStaleCache(): Promise<number> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const cutoff = Date.now() - MAX_AGE_MS
    let evicted = 0

    return new Promise((resolve) => {
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) { resolve(evicted); return }
        const entry = cursor.value as CachedAudio
        if (entry.createdAt < cutoff) {
          cursor.delete()
          evicted++
        }
        cursor.continue()
      }
      req.onerror = () => resolve(evicted)
    })
  } catch { return 0 }
}

/** Check how many entries and total size. */
export async function cacheStats(): Promise<{ entries: number; sizeMB: number }> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    let entries = 0
    let totalBytes = 0

    return new Promise((resolve) => {
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve({ entries, sizeMB: Math.round(totalBytes / 1024 / 1024 * 10) / 10 })
          return
        }
        entries++
        totalBytes += (cursor.value as CachedAudio).audio.byteLength
        cursor.continue()
      }
      req.onerror = () => resolve({ entries: 0, sizeMB: 0 })
    })
  } catch { return { entries: 0, sizeMB: 0 } }
}
