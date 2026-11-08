import { KOKORO_VOICES, KOKORO_LANGUAGES, isMobileDevice, useKokoroReady } from '../hooks/useKokoro'
import type { TtsEngine } from '../hooks/useTTS'
import KokoroSettings from './KokoroSettings'

interface AudioControlsProps {
  isPlaying: boolean
  rate: number
  voice: SpeechSynthesisVoice | null
  voices: SpeechSynthesisVoice[]
  engine: TtsEngine
  kokoroVoice: string
  currentChapter: number
  totalChapters: number
  bookTitle: string
  onToggle: () => void
  onPrevChapter: () => void
  onNextChapter: () => void
  onChangeRate: (rate: number) => void
  onChangeVoice: (voice: SpeechSynthesisVoice) => void
  onChangeEngine: (engine: TtsEngine) => void
  onChangeKokoroVoice: (id: string) => void
}

const SELECT = 'bg-warm-200/50 dark:bg-warm-800/50 rounded px-2 py-1 text-warm-800 dark:text-warm-100 border-none outline-none cursor-pointer'

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

export default function AudioControls({
  isPlaying,
  rate,
  voice,
  voices,
  engine,
  kokoroVoice,
  currentChapter,
  totalChapters,
  bookTitle,
  onToggle,
  onPrevChapter,
  onNextChapter,
  onChangeRate,
  onChangeVoice,
  onChangeEngine,
  onChangeKokoroVoice,
}: AudioControlsProps) {
  const kokoroReady = useKokoroReady()
  // Kokoro is desktop-only, as in bepublished: the model is too heavy for phones.
  const kokoroAvailable = !isMobileDevice()
  const voiceLangs = [...new Set(voices.map(v => v.lang))].sort()

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-warm-200 dark:border-warm-800 bg-warm-50/95 dark:bg-warm-950/95 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {engine === 'kokoro' && !kokoroReady && <KokoroSettings />}

        {/* Title and chapter */}
        <div className="text-center mb-2">
          <p className="text-xs text-warm-800/60 dark:text-warm-100/60 truncate">
            {bookTitle} — Chapter {currentChapter + 1} of {totalChapters}
          </p>
        </div>

        {/* Main controls */}
        <div className="flex items-center justify-center gap-4 mb-2">
          <button
            onClick={onPrevChapter}
            disabled={currentChapter === 0}
            className="p-2 rounded-full text-warm-800/70 dark:text-warm-100/70 hover:bg-warm-200 dark:hover:bg-warm-800 disabled:opacity-30 transition-colors"
            aria-label="Previous chapter"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
            </svg>
          </button>

          <button
            onClick={onToggle}
            className="p-3 rounded-full bg-warm-800 dark:bg-warm-100 text-warm-50 dark:text-warm-900 hover:scale-105 transition-transform"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          <button
            onClick={onNextChapter}
            disabled={currentChapter >= totalChapters - 1}
            className="p-2 rounded-full text-warm-800/70 dark:text-warm-100/70 hover:bg-warm-200 dark:hover:bg-warm-800 disabled:opacity-30 transition-colors"
            aria-label="Next chapter"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>
        </div>

        {/* Speed and voice */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
          <select
            value={rate}
            onChange={(e) => onChangeRate(parseFloat(e.target.value))}
            className={SELECT}
            aria-label="Speed"
          >
            {RATES.map(r => (
              <option key={r} value={r}>{r}x</option>
            ))}
          </select>

          {kokoroAvailable && (
            <select
              value={engine}
              onChange={(e) => onChangeEngine(e.target.value as TtsEngine)}
              className={SELECT}
              aria-label="Voice engine"
            >
              <option value="browser">System voice</option>
              <option value="kokoro">Kokoro AI voice</option>
            </select>
          )}

          {engine === 'kokoro' ? (
            <select
              value={kokoroVoice}
              onChange={(e) => onChangeKokoroVoice(e.target.value)}
              className={`${SELECT} max-w-[180px] truncate`}
              aria-label="Voice"
            >
              {KOKORO_LANGUAGES.map(lang => (
                <optgroup key={lang} label={lang}>
                  {KOKORO_VOICES.filter(v => v.langLabel === lang).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <select
              value={voice?.name || ''}
              onChange={(e) => {
                const selected = voices.find(v => v.name === e.target.value)
                if (selected) onChangeVoice(selected)
              }}
              className={`${SELECT} max-w-[180px] truncate`}
              aria-label="Voice"
            >
              {voiceLangs.map(lang => (
                <optgroup key={lang} label={lang}>
                  {voices.filter(v => v.lang === lang).map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  )
}
