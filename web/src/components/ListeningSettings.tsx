import { useId } from 'react'
import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'
import { canBoostVolume } from '../hooks/narration'
import { SleepTimerSettings } from './PlayerMenus'
import {
  CHAPTER_PAUSES, setChapterPause, setContinueChapters, setReadTitles,
  useChapterPause, useContinueChapters, useReadTitles, useVolumeBoost,
  setFollowAudio, useFollowAudio,
  setSkipPreface, useSkipPreface,
} from '../hooks/usePreferences'
import { t } from '../locales'

export function ListeningSettings() {
  const player = useAudioPlayer()

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-4">{t('listening.title')}</h2>
      <div className="space-y-4">
        <div className="max-w-sm">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="speed" className="text-sm text-text-muted">{t('listening.speed')}</label>
            <output htmlFor="speed" className="text-sm text-text tabular-nums">{t('player.rate', { rate: player.rate })}</output>
          </div>
          <input
            id="speed"
            type="range"
            min={RATES[0]}
            max={RATES[RATES.length - 1]}
            step={0.05}
            value={player.rate}
            onChange={e => player.setRate(Number(e.target.value))}
            aria-valuetext={t('player.rate', { rate: player.rate })}
            aria-describedby="speed-hint"
            className="block w-full h-10 accent-accent cursor-pointer"
          />
          <div className="flex justify-between text-xs text-text-dim tabular-nums" aria-hidden="true">
            <span>{t('player.rate', { rate: RATES[0] })}</span>
            <span>{t('player.rate', { rate: RATES[RATES.length - 1] })}</span>
          </div>
          <p id="speed-hint" className="text-xs text-text-dim mt-2">{t('listening.speedHint')}</p>
        </div>
        <ListeningOptions />
      </div>
    </div>
  )
}

/** Between chapters, and loudness (books#37): in Settings and the player's panel. */
export function ListeningOptions() {
  const player = useAudioPlayer()
  const pause = useChapterPause()
  const pauseLabel = useId()
  const boost = useVolumeBoost()

  return (
    <div className="space-y-4">
      <Toggle
        label={t('listening.skipPreface')}
        hint={t('listening.skipPrefaceHint')}
        checked={useSkipPreface()}
        onChange={setSkipPreface}
      />
      <Toggle
        label={t('listening.readTitles')}
        hint={t('listening.readTitlesHint')}
        checked={useReadTitles()}
        onChange={setReadTitles}
      />
      <div>
        <div id={pauseLabel} className="text-sm text-text">{t('listening.pause')}</div>
        <p className="text-xs text-text-dim mb-2">{t('listening.pauseHint')}</p>
        <div role="group" aria-labelledby={pauseLabel} className="flex flex-wrap gap-2">
          {CHAPTER_PAUSES.map(s => (
            <button
              key={s}
              onClick={() => setChapterPause(s)}
              aria-pressed={pause === s}
              className={`min-h-10 px-4 py-2 rounded-lg text-sm transition ${
                pause === s ? 'bg-accent text-btn-text font-semibold' : 'bg-surface-hover text-text-muted hover:text-text'
              }`}
            >
              {s === 0 ? t('listening.pauseOff') : t('listening.pauseSeconds', { s })}
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label={t('listening.continue')}
        hint={t('listening.continueHint')}
        checked={useContinueChapters()}
        onChange={setContinueChapters}
      />
      <Toggle
        label={t('listening.follow')}
        hint={t('listening.followHint')}
        checked={useFollowAudio()}
        onChange={setFollowAudio}
      />
      <SleepTimerSettings
        timer={player.sleepTimer}
        start={player.startSleepTimer}
        extend={player.extendSleepTimer}
        cancel={player.cancelSleepTimer}
      />
      {canBoostVolume && (
        <Toggle
          label={t('listening.boost')}
          hint={t('listening.boostHint')}
          checked={boost}
          onChange={player.setVolumeBoost}
        />
      )}
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId()
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span>
        <span id={`${id}-label`} className="block text-sm text-text">{label}</span>
        <span id={`${id}-hint`} className="block text-xs text-text-dim">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 w-5 h-5 shrink-0 accent-accent cursor-pointer"
      />
    </label>
  )
}
