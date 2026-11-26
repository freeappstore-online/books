import { useEffect, useState } from 'react'
import type { FreeAppStore, User } from '@freeappstore/sdk'
import { CATALOG } from '../data/catalog'
import {
  ANDROID_CONTRIBUTE_URL, COMMUNITY_SET, getContributeOptIn, getFas, isAndroid, loadSubmissions, setContributeOptIn,
  startContributing, stopContributing, useContribute, webSupport, type ContributeStage,
} from '../hooks/contribute'
import { t } from '../locales'
import { Toggle } from './ListeningSettings'

/** Community narration (books#66): in Settings, for editions with a job set. */
export function ContributeSettings() {
  return COMMUNITY_SET ? <Contribute /> : null
}

const button = 'min-h-10 px-4 py-2 rounded-lg text-sm transition'
const primary = `${button} bg-accent text-btn-text font-semibold`
const secondary = `${button} bg-surface-hover text-text-muted hover:text-text`

function Contribute() {
  const [support, setSupport] = useState<Awaited<ReturnType<typeof webSupport>> | null>(null)
  const [app, setApp] = useState<FreeAppStore | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [optIn, setOptIn] = useState(getContributeOptIn)
  const { running, status, sent, submissions } = useContribute()

  useEffect(() => { webSupport().then(setSupport) }, [])
  useEffect(() => {
    let off = () => {}
    let live = true
    getFas().then(fas => {
      if (!live) return
      setApp(fas)
      off = fas.auth.onChange(u => {
        setUser(u)
        if (u) loadSubmissions().catch(() => {})
      })
    }).catch(() => {})
    return () => { live = false; off() }
  }, [])

  const toggle = (on: boolean) => {
    setContributeOptIn(on)
    setOptIn(on)
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 md:p-6">
      <h2 className="text-lg font-semibold mb-2">{t('contribute.title')}</h2>
      <p className="text-sm text-text-muted mb-4">{t('contribute.intro')}</p>
      {support === 'language' && <p className="text-sm text-text-muted">{t('contribute.unsupportedLanguage')}</p>}
      {support === 'browser' && <p className="text-sm text-text-muted">{t('contribute.unsupportedBrowser')}</p>}
      {support && typeof support === 'object' && app && !user && (
        <div>
          <p className="text-sm text-text mb-2">{t('contribute.signIn')}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => app.auth.signIn('github')} className={secondary}>{t('contribute.github')}</button>
            <button onClick={() => app.auth.signIn('google')} className={secondary}>{t('contribute.google')}</button>
          </div>
        </div>
      )}
      {support && typeof support === 'object' && app && user && (
        <div className="space-y-4">
          <Toggle label={t('contribute.optIn')} hint={t('contribute.optInHint')} checked={optIn} onChange={toggle} />
          {optIn && (
            <>
              <p className="text-xs text-text-dim">{t('contribute.keepOpen')}</p>
              <div className="flex flex-wrap items-center gap-3">
                {running
                  ? <button onClick={stopContributing} className={secondary}>{t('contribute.stop')}</button>
                  : <button onClick={() => startContributing(support)} className={primary}>{t('contribute.start')}</button>}
                <span role="status" className="text-sm text-text-muted">{statusText(status)}</span>
              </div>
              {sent > 0 && <p className="text-sm text-text-muted">{t('contribute.sent', { count: sent })}</p>}
              {submissions && Object.keys(submissions).length > 0 && (
                <p className="text-sm text-text-muted">
                  {t('contribute.results', {
                    accepted: submissions.accepted ?? 0,
                    pending: submissions.pending ?? 0,
                    rejected: (submissions.rejected ?? 0) + (submissions.superseded ?? 0),
                  })}
                </p>
              )}
            </>
          )}
          <p className="text-xs text-text-dim">
            {t('contribute.signedIn', { name: user.login })}
            {' '}
            <button onClick={() => { stopContributing(); app.auth.signOut() }} className="text-accent underline">{t('contribute.signOut')}</button>
          </p>
        </div>
      )}
      {isAndroid && (
        <p className="text-sm text-text-muted mt-4">
          {t('contribute.android')}
          {' '}
          <a href={ANDROID_CONTRIBUTE_URL} className="text-accent underline">{t('contribute.androidLink')}</a>
        </p>
      )}
    </div>
  )
}

function statusText(status: ContributeStage): string {
  switch (status.stage) {
    case 'loading': return t('contribute.loading', { percent: Math.round(status.progress * 100) })
    case 'claiming': return t('contribute.claiming')
    case 'narrating': {
      // The job key is <slug>/<chapter>, or <slug>/<revision>/<chapter>
      const parts = status.key.split('/')
      const book = CATALOG.find(b => b.id === parts[0])?.title ?? parts[0]
      return t('contribute.narrating', { book, chapter: Number(parts.at(-1)) + 1, percent: Math.round(status.progress * 100) })
    }
    case 'no-work': return t('contribute.noWork')
    case 'error': return t('contribute.error', { message: status.message })
    default: return ''
  }
}
