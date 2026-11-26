import './fas-capabilities/pwa'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AudioPlayerProvider } from './hooks/useAudioPlayer'
import { App } from './App'
import './index.css'
import { applyUiScale, getUiScale } from './hooks/usePreferences'
import { warmFontCacheOnFirstControl } from './hooks/fontCache'
import { deleteVoice, getContributeOptIn } from './hooks/contribute'

applyUiScale(getUiScale())
if (import.meta.env.PROD) warmFontCacheOnFirstControl()

// Free the storage of the in-browser voice generation removed in books#23: its
// generated chapters (IndexedDB) and the ~160 MB model (Cache Storage). The model stays
// for a listener who opted in to narrate chapters for everyone (books#66).
try { indexedDB.deleteDatabase('bp-audio-cache') } catch {}
if (!getContributeOptIn()) deleteVoice()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AudioPlayerProvider>
        <App />
      </AudioPlayerProvider>
    </BrowserRouter>
  </StrictMode>,
)
