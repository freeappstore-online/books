import { useState } from 'react'
import { preloadKokoro, onKokoroProgress } from '../hooks/useKokoro'

// Ported from bepublished web/src/components/KokoroSettings.tsx: the download step only;
// the voice picker lives in AudioControls next to the browser voices.
export default function KokoroSettings() {
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  return (
    <div className="mb-3 rounded-lg border border-warm-200 dark:border-warm-800 bg-warm-100/60 dark:bg-warm-900/60 p-3 text-xs text-warm-800/80 dark:text-warm-100/80">
      <p className="mb-2">
        <span className="font-semibold text-warm-800 dark:text-warm-100">Kokoro AI voice</span> runs 100% in your
        browser and sounds far more natural than system voices. One-off download of ~160 MB (WASM) or more (WebGPU),
        cached after that. Nothing is sent to a server.
      </p>
      {downloading ? (
        <div>
          <div className="h-1.5 bg-warm-200 dark:bg-warm-800 rounded-full overflow-hidden mb-1">
            <div className="h-full bg-warm-800 dark:bg-warm-100 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p>Downloading model… this takes 1–2 minutes on a typical connection.</p>
        </div>
      ) : (
        <>
          <button
            onClick={async () => {
              setDownloading(true)
              setError('')
              onKokoroProgress(setProgress)
              try {
                await preloadKokoro()
              } catch {
                setError('Download failed. Please try again.')
              } finally {
                setDownloading(false)
                onKokoroProgress(null)
              }
            }}
            className="px-3 py-1.5 rounded-md bg-warm-800 dark:bg-warm-100 text-warm-50 dark:text-warm-900 font-semibold"
          >
            Download Kokoro voice
          </button>
          {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </div>
  )
}
