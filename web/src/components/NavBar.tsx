import { Link, useLocation } from 'react-router-dom'
import { useOnline } from '../hooks/offlineBooks'

interface Props {
  /** Optional title shown next to back button (e.g. book title) */
  title?: string
  /** Optional subtitle (e.g. author, genre) */
  subtitle?: string
  /** Right-side actions (e.g. Listen button, chapter toggle) */
  actions?: React.ReactNode
}

export function NavBar({ title, subtitle, actions }: Props) {
  const location = useLocation()

  const isHome = location.pathname === '/'
  const online = useOnline()

  return (
    <header className="border-b border-border px-4 md:px-6 py-2.5 md:py-3">
      <div className="flex items-center justify-between gap-3">
        {/* Left: logo/back + nav links */}
        <div className="flex items-center gap-3 md:gap-5 min-w-0">
          {/* Logo — always visible, always links home */}
          <Link to="/" className="text-lg md:text-xl font-display hover:text-accent transition shrink-0">
            Books
          </Link>

          {/* Nav links — desktop only */}
          <nav className="hidden md:flex items-center gap-4 text-sm">
            <Link
              to="/"
              className={`transition ${isHome ? 'text-text font-medium' : 'text-text-muted hover:text-text'}`}
            >
              Books
            </Link>
            <Link
              to="/library"
              className={`transition ${location.pathname === '/library' ? 'text-text font-medium' : 'text-text-muted hover:text-text'}`}
            >
              Library
            </Link>
            <Link
              to="/settings"
              className={`transition ${location.pathname === '/settings' ? 'text-text font-medium' : 'text-text-muted hover:text-text'}`}
            >
              Settings
            </Link>
          </nav>

          {/* Page title (reader, book editor, etc) */}
          {title && (
            <>
              <span className="text-text-dim hidden md:inline">/</span>
              <div className="min-w-0">
                <div className="text-sm md:text-base font-medium truncate">{title}</div>
                {subtitle && <div className="text-xs text-text-dim truncate">{subtitle}</div>}
              </div>
            </>
          )}
        </div>

        {/* Right: actions + mobile nav */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {!online && (
            <span className="px-2 py-1 rounded-full text-[11px] font-semibold bg-warning/15 text-warning" title="No connection: saved books still open">
              Offline
            </span>
          )}
          {actions}

          {/* Mobile nav icons */}
          <div className="flex md:hidden items-center gap-1">
            <Link
              to="/"
              className={`p-2 rounded-lg transition ${isHome ? 'text-text' : 'text-text-dim hover:text-text-muted'}`}
              title="Books"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
            </Link>
            <Link
              to="/library"
              className={`p-2 rounded-lg transition ${location.pathname === '/library' ? 'text-text' : 'text-text-dim hover:text-text-muted'}`}
              title="Library"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            </Link>
            <Link
              to="/settings"
              className={`p-2 rounded-lg transition ${location.pathname === '/settings' ? 'text-text' : 'text-text-dim hover:text-text-muted'}`}
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
