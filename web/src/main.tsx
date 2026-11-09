import './fas-capabilities/pwa'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AudioPlayerProvider } from './hooks/useAudioPlayer'
import { App } from './App'
import './index.css'
import { applyUiScale, getUiScale } from './hooks/usePreferences'
import { warmFontCacheOnFirstControl } from './hooks/fontCache'

applyUiScale(getUiScale())
if (import.meta.env.PROD) warmFontCacheOnFirstControl()

// Free the storage of the in-browser voice generation removed in books#23: its
// generated chapters (IndexedDB) and the ~160 MB model (Cache Storage)
try { indexedDB.deleteDatabase('bp-audio-cache') } catch {}
if (typeof caches !== 'undefined') {
  caches.keys().then(keys => keys.filter(k => k.includes('transformers')).forEach(k => caches.delete(k))).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AudioPlayerProvider>
        <App />
      </AudioPlayerProvider>
    </BrowserRouter>
  </StrictMode>,
)
