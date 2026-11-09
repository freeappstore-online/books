import { describe, expect, it } from 'vitest'
import { addAnnotation, removeAnnotation, type Annotation } from '../../src/hooks/annotations'
import { setFinished } from '../../src/hooks/useReadingProgress'

// Two tabs (or the installed app and the browser) share localStorage: a change
// in one must not erase what the other wrote meanwhile (books#26).
const SLUG = 'alice-in-wonderland'
const stored = (key: string) => JSON.parse(localStorage.getItem(key) || '{}')

describe('annotations across tabs', () => {
  it('adding keeps what another tab saved meanwhile', () => {
    const mine = addAnnotation(SLUG, { kind: 'bookmark', chapterIdx: 0, start: 5, end: 5, text: 'Mine' })
    // Another tab writes its list straight to storage
    const theirs: Annotation = { id: 'hl-other', kind: 'highlight', chapterIdx: 1, start: 0, end: 4, text: 'Down', created: 1 }
    localStorage.setItem('bp-annotations', JSON.stringify({ [SLUG]: [mine, theirs], dracula: [{ ...theirs, id: 'hl-d' }] }))
    const next = addAnnotation(SLUG, { kind: 'bookmark', chapterIdx: 2, start: 9, end: 9, text: 'Later' })
    expect(stored('bp-annotations')[SLUG].map((a: Annotation) => a.id)).toEqual([mine.id, 'hl-other', next.id])
    expect(stored('bp-annotations').dracula).toHaveLength(1)
    removeAnnotation(SLUG, mine.id)
    expect(stored('bp-annotations')[SLUG].map((a: Annotation) => a.id)).toEqual(['hl-other', next.id])
  })
})

describe('finished books across tabs', () => {
  it('marking one keeps the books another tab marked', () => {
    setFinished('dracula', true)
    localStorage.setItem('bp-finished', JSON.stringify({ ...stored('bp-finished'), emma: 7 }))
    setFinished(SLUG, true)
    expect(Object.keys(stored('bp-finished')).sort()).toEqual([SLUG, 'dracula', 'emma'])
    setFinished('dracula', false)
    expect(Object.keys(stored('bp-finished')).sort()).toEqual([SLUG, 'emma'])
  })
})
