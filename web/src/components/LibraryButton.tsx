import { useState, useEffect } from 'react'
import { isInLibrary, addToLibrary, removeFromLibrary, LIBRARY_CHANGED_EVENT } from '../hooks/useLibrary'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { isMobileDevice, useKokoroReady } from '../hooks/useKokoro'
import { Link } from 'react-router-dom'

interface Props {
  slug: string
  title: string
  totalChapters: number
}

/**
 * "Add to Library" / "Download AI model" button.
 * - Desktop + Kokoro downloaded: add/remove from library
 * - Desktop + no Kokoro: link to Settings to download
 * - Mobile: hidden (Kokoro disabled on mobile)
 */
export function LibraryButton({ slug, title, totalChapters }: Props) {
  const { kokoroVoice } = useAudioPlayer()
  const [inLibrary, setInLibrary] = useState(false)
  const isMobile = isMobileDevice()
  const hasKokoro = useKokoroReady()

  useEffect(() => {
    function sync() {
      setInLibrary(isInLibrary(slug))
    }

    sync()
    window.addEventListener(LIBRARY_CHANGED_EVENT, sync)
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, sync)
  }, [slug])

  // Hidden on mobile
  if (isMobile) return null

  // No Kokoro model yet — prompt to download
  if (!hasKokoro) {
    return (
      <Link
        to="/settings"
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-accent hover:text-text transition"
        title="Download AI voice model to enable library"
      >
        ✦ Get AI Voice
      </Link>
    )
  }

  function toggle() {
    if (inLibrary) {
      removeFromLibrary(slug)
      setInLibrary(false)
    } else {
      addToLibrary(slug, title, kokoroVoice, totalChapters)
      setInLibrary(true)
    }
  }

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
        inLibrary
          ? 'bg-accent/20 text-accent hover:bg-danger/20 hover:text-danger'
          : 'bg-surface-hover text-text-muted hover:text-accent'
      }`}
      title={inLibrary ? 'Remove from library' : 'Add to library for AI voice generation'}
    >
      {inLibrary ? '✓ In Library' : '+ Library'}
    </button>
  )
}
