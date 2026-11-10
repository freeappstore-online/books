import { retryLocalWrites, usePendingLocalWrites } from '../hooks/localStorage'

export function StorageWarning() {
  const count = usePendingLocalWrites()
  if (!count) return null
  return (
    <aside role="alert" className="fixed right-4 left-4 sm:left-auto sm:max-w-sm z-90 rounded-xl border border-danger bg-surface p-4 shadow-xl text-sm"
      style={{ bottom: 'calc(max(var(--player-h, 0px), env(safe-area-inset-bottom)) + 1rem)' }}>
      <p className="font-medium text-danger">Your latest changes could not be saved on this device.</p>
      <p className="mt-2 text-text-muted">Keep this page open. Free up space or allow this site to use browser storage, then retry saving your notes, settings and progress.</p>
      <button onClick={retryLocalWrites} className="mt-3 min-h-10 px-3 rounded-lg bg-accent text-white">Retry saving</button>
    </aside>
  )
}
