/**
 * Hook that starts background Kokoro generation for library books.
 * Runs when the app is idle, generates chapters one at a time.
 */

import { useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from './useAudioPlayer'
import { getLibrary, runBackgroundGeneration, stopBackground, LIBRARY_CHANGED_EVENT, publishBackgroundStatus } from './useLibrary'
import { isMobileDevice, generateInWorker, initWorker, useKokoroReady } from './useKokoro'
import { CATALOG } from '../data/catalog'
import { isNarrated, usePreparedManifest } from './preparedAudio'

export function useBackgroundGeneration() {
  const { playing } = useAudioPlayer()
  const kokoroReady = useKokoroReady()
  const startedRef = useRef(false)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [runVersion, setRunVersion] = useState(0)
  const manifest = usePreparedManifest()

  useEffect(() => {
    function handleLibraryChanged() {
      console.log('[LibraryBG] library changed, scheduling reevaluation')
      setLibraryVersion(version => version + 1)
    }

    window.addEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, handleLibraryChanged)
  }, [])

  useEffect(() => {
    if (isMobileDevice()) {
      console.log('[LibraryBG] blocked: mobile device')
      publishBackgroundStatus({
        running: false,
        slug: null,
        chapter: 0,
        total: 0,
        phase: 'idle',
        message: 'AI voice generation runs on desktop browsers, not on mobile.',
      })
      stopBackground()
      return
    }

    if (!kokoroReady) {
      console.log('[LibraryBG] blocked: Kokoro runtime not prepared')
      publishBackgroundStatus({
        running: false,
        slug: null,
        chapter: 0,
        total: 0,
        phase: 'idle',
        message: 'Download the Kokoro AI runtime in Settings before this desktop can generate chapters.',
      })
      stopBackground()
      return
    }

    if (playing) {
      console.log('[LibraryBG] paused: active playback in progress')
      publishBackgroundStatus({
        running: false,
        slug: null,
        chapter: 0,
        total: 0,
        phase: 'idle',
        message: 'Background generation pauses while audio is actively playing.',
      })
      stopBackground()
    }
  }, [playing, kokoroReady])

  useEffect(() => {
    if (isMobileDevice() || !kokoroReady || !manifest) return
    if (startedRef.current) {
      console.log('[LibraryBG] skip scheduling: background run already active')
      return
    }
    // Local generation is offered only for narrated books for now (books#19)
    const library = getLibrary().filter(book => isNarrated(manifest, book.slug))
    console.log(
      '[LibraryBG] reevaluate queue books=%d pending=%d playing=%s',
      library.length,
      library.filter(book => book.generatedChapters < book.totalChapters).length,
      playing,
    )
    if (library.length === 0) {
      publishBackgroundStatus({
        running: false,
        slug: null,
        chapter: 0,
        total: 0,
        phase: 'idle',
        message: 'Add a book to Library to start desktop AI generation.',
      })
      return
    }
    const hasPendingBooks = library.some(book => book.generatedChapters < book.totalChapters)
    if (!hasPendingBooks) {
      console.log('[LibraryBG] nothing pending: all library books are already ready')
      publishBackgroundStatus({
        running: false,
        slug: null,
        chapter: 0,
        total: 0,
        phase: 'done',
        message: 'All books in your Library are already ready for AI playback on this desktop.',
      })
      return
    }
    if (playing) {
      console.log('[LibraryBG] defer scheduling: playback is active')
      return
    }

    publishBackgroundStatus({
      running: false,
      slug: null,
      chapter: 0,
      total: 0,
      phase: 'checking',
      message: 'Starting desktop AI generation...',
    })

    const timer = setTimeout(async () => {
      if (startedRef.current) {
        console.log('[LibraryBG] timer fired but run already active, ignoring')
        return
      }
      startedRef.current = true
      console.log('[LibraryBG] starting background run')
      publishBackgroundStatus({
        running: false,
        slug: null,
        chapter: 0,
        total: 0,
        phase: 'checking',
        message: 'Preparing the Kokoro runtime for background generation...',
      })

      try {
        await initWorker()
        console.log('[LibraryBG] worker init succeeded')
      } catch (error) {
        console.error('[LibraryBG] worker init failed:', error)
        publishBackgroundStatus({
          running: false,
          slug: null,
          chapter: 0,
          total: 0,
          phase: 'error',
          message: `Failed to initialize the desktop AI runtime: ${error instanceof Error ? error.message : 'unknown error'}`,
        })
        startedRef.current = false
        return
      }

      const getChapters = async (slug: string) => {
        const book = CATALOG.find(b => b.id === slug)
        if (!book || !isNarrated(manifest, slug)) return []
        const res = await fetch(book.contentPath)
        if (!res.ok) return []
        const data = await res.json() as { chapters: { title: string; content: string }[] }
        return data.chapters
      }

      runBackgroundGeneration(
        generateInWorker,
        getChapters,
        (slug, ch, total) => console.log('[Background] %s: %d/%d cached', slug, ch, total),
      ).finally(() => {
        console.log('[LibraryBG] background run finished, reevaluating queue')
        startedRef.current = false
        setRunVersion(version => version + 1)
      })
    }, 500)

    return () => {
      console.log('[LibraryBG] cleared pending schedule timer')
      clearTimeout(timer)
    }
  }, [playing, libraryVersion, runVersion, kokoroReady, manifest])
}
