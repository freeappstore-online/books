import './fas-capabilities/pwa'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AudioPlayerProvider } from './hooks/useAudioPlayer'
import { App } from './App'
import './index.css'
import { applyUiScale, getUiScale } from './hooks/usePreferences'

applyUiScale(getUiScale())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AudioPlayerProvider>
        <App />
      </AudioPlayerProvider>
    </BrowserRouter>
  </StrictMode>,
)
