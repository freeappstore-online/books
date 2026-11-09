import { useState, useEffect } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { hasCachedAudio, cacheKey } from '../hooks/audioCache'
import { isMobileDevice, useKokoroReady } from '../hooks/useKokoro'
import { isNarrated, isPrepared, usePreparedManifest } from '../hooks/preparedAudio'

interface Props {
  slug: string
  bookTitle: string
  bookAuthor: string
  chapters: { id: string; title: string; content: string }[]
  activeChapterIdx: number
}

/**
 * Smart play buttons — "Listen Now" (instant device voice) and
 * "Listen with AI Voice" (Kokoro, needs prep).
 * No engine picker. Just two clear choices.
 */
export function SmartPlayButtons({ slug, bookTitle, bookAuthor, chapters, activeChapterIdx }: Props) {
  const player = useAudioPlayer()
  const [localAiReady, setLocalAiReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const isMobile = isMobileDevice()
  const kokoroReady = useKokoroReady()
  const manifest = usePreparedManifest()
  const prepared = manifest !== null && isPrepared(manifest, slug, activeChapterIdx, player.kokoroVoice)
  const aiReady = localAiReady || prepared
  const kokoroAvailable = aiReady || (!isMobile && kokoroReady)

  const isThisBookPlaying = player.book?.slug === slug
  const isPlaying = isThisBookPlaying && player.playing

  // Check if AI audio is cached for the current chapter
  useEffect(() => {
    if (isMobile) { setChecking(false); return }
    setChecking(true)
    hasCachedAudio(cacheKey(slug, activeChapterIdx, player.kokoroVoice, 'original'))
      .then(cached => { setLocalAiReady(cached); setChecking(false) })
      .catch(() => setChecking(false))
  }, [slug, activeChapterIdx, player.kokoroVoice, isMobile])

  function handleInstantPlay() {
    if (isPlaying) {
      player.pause()
      return
    }
    // Force browser engine for instant play
    if (player.engine !== 'browser') player.setEngine('browser')
    player.loadAndPlay(
      { slug, title: bookTitle, author: bookAuthor, chapters },
      activeChapterIdx,
    )
  }

  function handleAiPlay() {
    if (isPlaying && player.engine === 'kokoro') {
      player.pause()
      return
    }
    if (player.engine !== 'kokoro') player.setEngine('kokoro')
    player.loadAndPlay(
      { slug, title: bookTitle, author: bookAuthor, chapters },
      activeChapterIdx,
    )
  }

  // Books without AI narration are reading-only; nothing shows until the manifest says which
  if (!manifest || !isNarrated(manifest, slug)) return null

  // Compact layout for the header
  if (isPlaying) {
    return (
      <button
        onClick={() => player.pause()}
        className="px-3 py-1.5 rounded-lg font-semibold text-sm bg-danger hover:opacity-90 text-text transition"
      >
        Pause
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Always available: instant play */}
      <button
        onClick={handleInstantPlay}
        className="px-3 py-1.5 rounded-lg font-semibold text-sm bg-text text-btn-text hover:opacity-90 transition"
        title="Play instantly with device voice"
      >
        Play
      </button>

      {/* AI play — prepared narration anywhere, local generation on desktop */}
      {kokoroAvailable && !checking && (
        <button
          onClick={handleAiPlay}
          className={`px-3 py-1.5 rounded-lg font-semibold text-sm transition ${
            aiReady
              ? 'bg-accent hover:bg-accent-hover text-btn-text'
              : 'bg-surface-hover text-accent hover:text-text border border-accent/30'
          }`}
          title={prepared ? 'Play AI narration' : aiReady ? 'Play cached AI voice' : 'Generate AI voice on this desktop'}
        >
          {aiReady ? '✦ AI' : '✦'}
        </button>
      )}
    </div>
  )
}
