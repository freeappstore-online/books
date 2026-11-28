import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RATES, type SleepChoice, type SleepTimer } from '../hooks/useAudioPlayer'
import { loadSleepChoice } from '../hooks/audioStorage'
import { t } from '../locales'

/** The player bar's speed and sleep timer buttons, each with its popover menu. */

export function SpeedButton({ rate, setRate }: { rate: number; setRate: (r: number) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = () => { setMenuOpen(false); buttonRef.current?.focus() }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setMenuOpen(!menuOpen)}
        onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
        className="min-w-[40px] sm:min-w-11 h-[40px] px-1 sm:px-1.5 text-xs font-semibold tabular-nums text-text-muted hover:text-text transition select-none [-webkit-touch-callout:none]"
        title={t('player.speedTitle')}
        aria-label={`${t('listening.speed')} ${t('player.rate', { rate })}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-keyshortcuts="[ ]"
      >
        {t('player.rate', { rate })}
      </button>
      {menuOpen && (
        <BarMenu label={t('listening.speed')} onClose={close}>
          {RATES.map(r => (
            <MenuItem key={r} checked={r === rate} onClick={() => { setRate(r); close() }}>
              {t('player.rate', { rate: r })}
            </MenuItem>
          ))}
        </BarMenu>
      )}
    </div>
  )
}

const SLEEP_CHOICES: SleepChoice[] = [5, 15, 30, 45, 60, 'chapter']

const sleepLabel = (c: SleepChoice) => c === 'chapter' ? t('sleep.endOfChapter') : t('sleep.minutes', { count: c })

interface SleepControls {
  timer: SleepTimer | null
  start: (c: SleepChoice) => void
  extend: (minutes: number) => void
  cancel: () => void
}

/** Same live timer in Settings and the expanded player's Listening panel. */
export function SleepTimerSettings({ timer, start, extend, cancel }: SleepControls) {
  const id = useId()
  const [minutes, setMinutes] = useState(() => {
    const last = loadSleepChoice()
    return String(typeof last === 'number' ? last : 20)
  })
  const value = Number(minutes)
  const valid = Number.isInteger(value) && value >= 1 && value <= 1440
  const selected = timer?.choice ?? 'off'
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <h3 id={`${id}-title`} className="text-sm text-text">{t('sleep.title')}</h3>
      <p className="text-xs text-text-dim">{t('sleep.hint')}</p>
      <label htmlFor={`${id}-choice`} className="block text-sm text-text-muted">{t('sleep.stopAfter')}</label>
      <select
        id={`${id}-choice`}
        value={selected}
        onChange={e => e.target.value === 'off' ? cancel() : start(e.target.value === 'chapter' ? 'chapter' : Number(e.target.value))}
        className="min-h-10 bg-page text-text rounded-lg px-3 py-2 border border-border w-full max-w-xs"
      >
        <option value="off">{t('sleep.disabled')}</option>
        {SLEEP_CHOICES.map(c => <option key={c} value={c}>{sleepLabel(c)}</option>)}
        {typeof selected === 'number' && !SLEEP_CHOICES.includes(selected) && <option value={selected}>{sleepLabel(selected)}</option>}
      </select>
      <form onSubmit={e => { e.preventDefault(); if (valid) start(value) }}>
        <label htmlFor={`${id}-minutes`} className="block text-sm text-text-muted mb-1">{t('sleep.custom')}</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`${id}-minutes`} type="number" min="1" max="1440" step="1" required
            value={minutes} onChange={e => setMinutes(e.target.value)} aria-describedby={`${id}-range`}
            className="min-h-10 w-24 bg-page text-text rounded-lg px-3 py-2 border border-border" />
          <button type="submit" disabled={!valid} className="min-h-10 rounded-lg bg-accent text-btn-text px-3 py-2 text-sm disabled:opacity-50">{t('sleep.start')}</button>
        </div>
        <p id={`${id}-range`} className="text-xs text-text-dim mt-1">{t('sleep.customHint')}</p>
      </form>
      <p className="text-sm text-accent tabular-nums" data-sleep-status="">
        {timer ? t('sleep.set', { until: timer.choice === 'chapter' ? t('sleep.endOfChapterLower') : formatTime(timer.remaining / 1000) }) : t('sleep.disabled')}
      </p>
      {timer && <div className="flex flex-wrap gap-2">
        {timer.choice !== 'chapter' && [5, 15].map(n => <button key={n} onClick={() => extend(n)} className="min-h-10 px-3 py-2 rounded-lg bg-surface-hover text-sm">{t('sleep.extend', { count: n })}</button>)}
        <button onClick={cancel} className="min-h-10 px-3 py-2 rounded-lg bg-surface-hover text-sm">{t('sleep.off')}</button>
      </div>}
    </section>
  )
}

/** Moon button: picks a sleep timer, then shows its countdown; tapping that cancels or extends it. */
export function SleepButton({ timer, start, extend, cancel }: SleepControls) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const last = menuOpen ? loadSleepChoice() : null
  const close = () => { setMenuOpen(false); buttonRef.current?.focus() }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`flex items-center justify-center gap-1 min-w-[40px] h-[40px] px-2 text-xs font-semibold tabular-nums transition ${timer ? 'text-accent' : 'text-text-muted hover:text-text'}`}
        title={t('sleep.title')}
        aria-label={timer
          ? t('sleep.set', { until: timer.choice === 'chapter' ? t('sleep.endOfChapterLower') : formatTime(timer.remaining / 1000) })
          : t('sleep.title')}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.3 2a10 10 0 1 0 9.7 12.6A8 8 0 0 1 12.3 2z"/></svg>
        {timer && <span>{timer.choice === 'chapter' ? t('sleep.chapterShort') : formatTime(timer.remaining / 1000)}</span>}
      </button>
      {menuOpen && (
        <BarMenu label={t('sleep.title')} onClose={close}>
          {timer && timer.choice !== 'chapter' && (
            <>
              <MenuItem onClick={() => { extend(5); close() }}>{t('sleep.extend', { count: 5 })}</MenuItem>
              <MenuItem onClick={() => { extend(15); close() }}>{t('sleep.extend', { count: 15 })}</MenuItem>
            </>
          )}
          {timer && <MenuItem onClick={() => { cancel(); close() }}>{t('sleep.off')}</MenuItem>}
          {timer && <div role="separator" className="my-1 border-t border-border" />}
          {SLEEP_CHOICES.map(c => (
            <MenuItem key={c} checked={timer ? timer.choice === c : last === c} onClick={() => { start(c); close() }}>
              {sleepLabel(c)}
            </MenuItem>
          ))}
          <Link to="/settings" role="menuitem" tabIndex={-1} onClick={close} className="block min-h-10 whitespace-nowrap px-4 py-2 text-sm text-text-muted hover:bg-surface-hover">{t('sleep.customLink')}</Link>
        </BarMenu>
      )}
    </div>
  )
}

/**
 * Popover above a bar button; a click outside closes it. Keyboard (books#15): focus moves
 * into it, arrows/Home/End move between items, Escape or Tab closes it (onClose returns focus).
 */
function BarMenu({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    ;(menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (j: number) => items[(j + items.length) % items.length]?.focus()
    const keys: Record<string, () => void> = {
      Escape: onClose, Tab: onClose,
      ArrowDown: () => go(i + 1), ArrowUp: () => go(i - 1), Home: () => go(0), End: () => go(items.length - 1),
    }
    if (!keys[e.key]) return
    e.preventDefault()
    keys[e.key]()
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div ref={menuRef} role="menu" aria-label={label} onKeyDown={onKeyDown} className="absolute bottom-full right-0 mb-2 z-20 max-h-[min(18rem,60dvh)] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
        {children}
      </div>
    </>
  )
}

function MenuItem({ checked, onClick, children }: { checked?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      tabIndex={-1}
      aria-checked={checked}
      onClick={onClick}
      className={`block w-full min-h-10 whitespace-nowrap px-4 py-2 text-left text-sm tabular-nums transition ${
        checked ? 'text-accent font-semibold' : 'text-text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
