import { Routes, Route, Navigate } from 'react-router-dom'
import { CatalogPage } from './pages/CatalogPage'
import { ReaderPage } from './pages/ReaderPage'
import { SettingsPage } from './pages/SettingsPage'
import { LibraryPage } from './pages/LibraryPage'
import { AudioPlayer } from './components/AudioPlayer'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { UpdateToast } from './components/UpdateToast'
import { StorageWarning } from './components/StorageWarning'

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/read/:slug" element={<ReaderPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>

      {/* Global persistent audio player - lives outside routing */}
      <AudioPlayer />
      <KeyboardShortcuts />
      <UpdateToast />
      <StorageWarning />
    </>
  )
}
