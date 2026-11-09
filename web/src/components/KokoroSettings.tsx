import { useState } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { KOKORO_VOICES, KOKORO_LANGUAGES, preloadKokoro, onKokoroProgress, isMobileDevice } from '../hooks/useKokoro'

interface KokoroSettingsProps {
  kokoroReady: boolean
  setKokoroReady: (ready: boolean) => void
}

export function KokoroSettings({ kokoroReady, setKokoroReady }: KokoroSettingsProps) {
  const player = useAudioPlayer()
  const [kokoroDownloading, setKokoroDownloading] = useState(false)
  const [kokoroProgress, setKokoroProgress] = useState(0)

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">Kokoro AI Voice</h2>
        {kokoroReady && <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success font-semibold">Ready</span>}
      </div>

      <p className="text-sm text-text-muted mb-4">
        Kokoro is an AI text-to-speech model that runs 100% in your browser. It sounds much more natural than browser voices, with realistic prosody and intonation. Supports 9 languages.
      </p>

      {isMobileDevice() && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-4">
          <p className="text-sm text-warning">
            Kokoro is resource-intensive and may cause crashes on mobile devices. We recommend using it on a desktop or laptop computer. Browser voices work better on mobile.
          </p>
        </div>
      )}

      <div className="bg-page rounded-lg p-4 mb-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-text-dim">Model</span>
          <span className="text-text-muted">Kokoro-82M (ONNX, quantized)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-dim">Runtime</span>
          <span className="text-text-muted">
            {player.kokoroRuntime.backend === 'unknown'
              ? 'Auto: WebGPU first, WASM fallback'
              : `${player.kokoroRuntime.backend.toUpperCase()} · ${player.kokoroRuntime.dtype}`}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-dim">Download size</span>
          <span className="text-text-muted">~160 MB on WASM, larger on WebGPU (cached after first download)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-dim">Processing</span>
          <span className="text-text-muted">100% local — nothing sent to any server</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-dim">Languages</span>
          <span className="text-text-muted">English, 中文, Français, 日本語, Español, हिन्दी, Italiano, Português</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-dim">Source</span>
          <a href="https://kokoroweb.app" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-sm">kokoroweb.app</a>
        </div>
      </div>

      {isMobileDevice() ? (
        <p className="text-sm text-text-dim">Books in the catalogue come with AI narration ready to play on this device. Generating the AI voice for anything else needs a desktop computer.</p>
      ) : kokoroReady ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-text-muted mb-2">Voice</label>
            <select
              value={player.kokoroVoice}
              onChange={e => player.setKokoroVoice(e.target.value)}
              className="bg-page text-text text-sm rounded-lg px-3 py-2 border border-border w-full max-w-xs"
            >
              {KOKORO_LANGUAGES.map(lang => (
                <optgroup key={lang} label={lang}>
                  {KOKORO_VOICES.filter(v => v.langLabel === lang).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <p className="text-xs text-text-dim">
            Model downloaded and cached in your browser. No re-download needed between visits. This browser prefers WebGPU for faster desktop generation and falls back to WASM automatically.
          </p>
        </div>
      ) : kokoroDownloading ? (
        <div>
          <div className="h-2 bg-surface-hover rounded-full overflow-hidden mb-2">
            <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${kokoroProgress}%` }} />
          </div>
          <p className="text-xs text-text-dim">Downloading model... This takes 1-2 minutes on a typical connection.</p>
        </div>
      ) : (
        <button
          onClick={async () => {
            setKokoroDownloading(true)
            onKokoroProgress(pct => setKokoroProgress(pct))
            try {
              await preloadKokoro()
              setKokoroReady(true)
              setKokoroDownloading(false)
              onKokoroProgress(null)
            } catch {
              setKokoroDownloading(false)
              onKokoroProgress(null)
              alert('Download failed. Please try again.')
            }
          }}
          className="bg-accent hover:bg-accent-hover text-btn-text px-5 py-2.5 rounded-lg font-semibold text-sm transition"
        >
          Prepare Kokoro AI Runtime
        </button>
      )}
    </div>
  )
}
