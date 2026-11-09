import { type Theme, setTheme } from '../hooks/useTheme'
import { TextSizeControls } from './TextSizeControls'

interface ReadingSettingsProps {
  currentTheme: Theme
  setCurrentTheme: (t: Theme) => void
}

export function ReadingSettings({ currentTheme, setCurrentTheme }: ReadingSettingsProps) {

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">Reading</h2>
      <div className="space-y-4">
        <div>
          <div id="theme-label" className="block text-sm text-text-muted mb-3">Reading Theme</div>
          <div role="group" aria-labelledby="theme-label" className="flex gap-2">
            {(['dark', 'light', 'sepia'] as Theme[]).map(t => (
              <button
                key={t}
                onClick={() => { setCurrentTheme(t); setTheme(t) }}
                aria-pressed={currentTheme === t}
                className={`px-4 py-2 rounded-lg text-sm transition ${
                  currentTheme === t
                    ? 'bg-accent text-btn-text font-semibold'
                    : 'bg-surface-hover text-text-muted hover:text-text'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <TextSizeControls />
      </div>
    </div>
  )
}
