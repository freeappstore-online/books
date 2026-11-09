import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { ReadingSettings } from '../components/ReadingSettings'
import { KokoroSettings } from '../components/KokoroSettings'
import { ListeningSettings } from '../components/ListeningSettings'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { getReaderFontSize, getUiScale } from '../hooks/usePreferences'
import { isKokoroDownloaded, verifyKokoroCache } from '../hooks/useKokoro'
import { getTheme, type Theme } from '../hooks/useTheme'
import { getLanguage } from '../hooks/useLanguage'

export function SettingsPage() {
  const player = useAudioPlayer()
  const [readerFont, setReaderFont] = useState(getReaderFontSize)
  const [uiScale, setUiScale] = useState(getUiScale)
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme)
  const [language, setLanguageState] = useState(getLanguage)
  const [kokoroReady, setKokoroReady] = useState(isKokoroDownloaded)

  // Verify cache is actually present (user may have cleared browser data)
  useEffect(() => {
    verifyKokoroCache().then(ok => setKokoroReady(ok))
  }, [])

  return (
    <div className={`min-h-dvh bg-page text-text ${player.book ? 'pb-20' : ''}`}>
      <NavBar title="Settings" />

      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4 md:space-y-6">
        <ReadingSettings
          currentTheme={currentTheme}
          setCurrentTheme={setCurrentTheme}
          readerFont={readerFont}
          setReaderFont={setReaderFont}
          uiScale={uiScale}
          setUiScale={setUiScale}
          language={language}
          setLanguage={setLanguageState}
        />

        <KokoroSettings kokoroReady={kokoroReady} setKokoroReady={setKokoroReady} />

        <ListeningSettings kokoroReady={kokoroReady} />

        {/* Listening History */}
        {player.history.length > 0 && (
          <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
            <h2 className="text-lg font-semibold mb-4">Listening History</h2>
            <div className="space-y-2">
              {player.history.map(h => (
                <Link
                  key={h.slug}
                  to={`/read/${h.slug}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover transition"
                >
                  <div>
                    <div className="text-sm font-medium">{h.title}</div>
                    <div className="text-xs text-text-muted">{h.author} · Chapter {h.chapterIdx + 1}</div>
                  </div>
                  <div className="text-xs text-text-dim">
                    {new Date(h.timestamp).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
