import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'

export function ListeningSettings() {
  const player = useAudioPlayer()

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">Listening</h2>
      <label htmlFor="speed" className="block text-sm text-text-muted mb-2">Speed</label>
      <select
        id="speed"
        value={player.rate}
        onChange={e => player.setRate(Number(e.target.value))}
        className="bg-page text-text text-base md:text-sm rounded-lg px-3 py-2 border border-border w-full max-w-xs"
      >
        {RATES.map(r => <option key={r} value={r}>{r}x</option>)}
      </select>
    </div>
  )
}
