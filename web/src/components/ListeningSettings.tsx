import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'

interface ListeningSettingsProps {
  kokoroReady: boolean
}

export function ListeningSettings({ kokoroReady }: ListeningSettingsProps) {
  const player = useAudioPlayer()

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">Listening</h2>
      <div className="space-y-5">
        <div>
          <label className="block text-sm text-text-muted mb-3">Voice Engine</label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => player.setEngine('browser')}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                player.engine === 'browser'
                  ? 'bg-accent text-btn-text font-semibold'
                  : 'bg-surface-hover text-text-muted hover:text-text'
              }`}
            >
              Browser (50+ languages)
            </button>
            <button
              onClick={() => kokoroReady ? player.setEngine('kokoro') : undefined}
              disabled={!kokoroReady}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                player.engine === 'kokoro'
                  ? 'bg-accent text-btn-text font-semibold'
                  : kokoroReady
                    ? 'bg-surface-hover text-text-muted hover:text-text'
                    : 'bg-surface-hover text-text-dim opacity-50 cursor-not-allowed'
              }`}
            >
              Kokoro AI {!kokoroReady && '(download first)'}
            </button>
          </div>
          {kokoroReady && (
            <p className="mt-2 text-xs text-text-dim">
              Kokoro runtime: {player.kokoroRuntime.backend === 'unknown'
                ? 'auto-selecting WebGPU with WASM fallback'
                : `${player.kokoroRuntime.backend.toUpperCase()} · ${player.kokoroRuntime.dtype}`}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-text-muted mb-2">Default Speed</label>
          <select
            value={player.rate}
            onChange={e => player.setRate(Number(e.target.value))}
            className="bg-page text-text text-sm rounded-lg px-3 py-2 border border-border w-full max-w-xs"
          >
            {RATES.map(r => <option key={r} value={r}>{r}x</option>)}
          </select>
        </div>

        {player.voices.length > 1 && (
          <div>
            <label className="block text-sm text-text-muted mb-2">Voice</label>
            <select
              value={player.voiceName}
              onChange={e => player.setVoiceName(e.target.value)}
              className="bg-page text-text text-sm rounded-lg px-3 py-2 border border-border w-full max-w-xs"
            >
              {player.voices.map(v => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
