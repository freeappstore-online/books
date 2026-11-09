import { type Theme, setTheme } from '../hooks/useTheme'
import { READER_FONTS, UI_SCALES, setReaderFontSize, setUiScaleValue, applyUiScale } from '../hooks/usePreferences'
import { LANGUAGES, setLanguage as saveLanguage } from '../hooks/useLanguage'

interface ReadingSettingsProps {
  currentTheme: Theme
  setCurrentTheme: (t: Theme) => void
  readerFont: number
  setReaderFont: (size: number) => void
  uiScale: number
  setUiScale: (scale: number) => void
  language: string
  setLanguage: (code: string) => void
}

export function ReadingSettings({ currentTheme, setCurrentTheme, readerFont, setReaderFont, uiScale, setUiScale, language, setLanguage }: ReadingSettingsProps) {
  function handleReaderFontChange(size: number) {
    setReaderFont(size)
    setReaderFontSize(size)
  }

  function handleUiScaleChange(scale: number) {
    setUiScale(scale)
    setUiScaleValue(scale)
    applyUiScale(scale)
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">Reading</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-text-muted mb-3">Language</label>
          <p className="text-xs text-text-dim mb-2">Sets the voice language for text-to-speech playback.</p>
          <select
            value={language}
            onChange={e => { setLanguage(e.target.value); saveLanguage(e.target.value) }}
            className="bg-page text-text text-sm rounded-lg px-3 py-2 border border-border w-full max-w-xs mb-4"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.nativeName} ({l.name})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-text-muted mb-3">Reading Theme</label>
          <div className="flex gap-2">
            {(['dark', 'light', 'sepia'] as Theme[]).map(t => (
              <button
                key={t}
                onClick={() => { setCurrentTheme(t); setTheme(t) }}
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

        <div>
          <label className="block text-sm text-text-muted mb-3">App Font Size</label>
          <p className="text-xs text-text-dim mb-2">Scales all UI text: menus, buttons, labels.</p>
          <div className="flex gap-2 flex-wrap">
            {UI_SCALES.map(s => (
              <button
                key={s.value}
                onClick={() => handleUiScaleChange(s.value)}
                className={`px-3 py-2 rounded-lg text-sm transition ${
                  uiScale === s.value
                    ? 'bg-accent text-btn-text font-semibold'
                    : 'bg-surface-hover text-text-muted hover:text-text'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-text-muted mb-3">Book Text Size</label>
          <p className="text-xs text-text-dim mb-2">Only affects book reading text, not the rest of the app.</p>
          <div className="flex gap-2 flex-wrap">
            {READER_FONTS.map(s => (
              <button
                key={s.value}
                onClick={() => handleReaderFontChange(s.value)}
                className={`px-3 py-2 rounded-lg text-sm transition ${
                  readerFont === s.value
                    ? 'bg-accent text-btn-text font-semibold'
                    : 'bg-surface-hover text-text-muted hover:text-text'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-text-muted rounded-lg bg-page p-3" style={{ fontSize: `${readerFont}px` }}>
            Preview book text at {readerFont}px
          </p>
        </div>
      </div>
    </div>
  )
}
