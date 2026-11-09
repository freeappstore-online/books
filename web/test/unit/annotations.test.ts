import { describe, expect, it } from 'vitest'
import { addAnnotation, anchorHighlight, reanchorAnnotations, removeAnnotation, type Annotation } from '../../src/hooks/annotations'
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

describe('highlights after a text change', () => {
  const text = 'Alice was beginning to get very tired. So she was considering. Alice was tired.'
  const hl = (start: number, end: number, t = text.slice(start, end).trim()): Annotation =>
    ({ id: 'hl-1', kind: 'highlight', chapterIdx: 0, start, end, text: t, created: 1 })

  it('stays put while its text is there (spaces around the selection included)', () => {
    expect(anchorHighlight(hl(0, 5), text)).toEqual([0, 5])
    expect(anchorHighlight({ ...hl(9, 20), text: 'beginning' }, text)).toEqual([9, 20])
  })

  it('moves to the occurrence nearest its old offset, else anywhere in the chapter', () => {
    const edited = 'Chapter I. ' + text
    // "Alice was" at 0 is now at 11, not the one near the end
    expect(anchorHighlight(hl(0, 9), edited)).toEqual([11, 20])
    expect(anchorHighlight(hl(text.length - 6, text.length), `${text.slice(-6)} …and more`)).toEqual([0, 6])
  })

  it('is null when its own text changed', () => {
    expect(anchorHighlight({ ...hl(0, 5), text: 'Dorothy' }, text)).toBeNull()
  })

  it('reanchorAnnotations saves the moves and marks the lost ones, only when something changed', () => {
    const moved = { ...hl(0, 9), id: 'hl-moved' }
    const lost = { ...hl(10, 19), id: 'hl-lost', text: 'nothing' }
    localStorage.setItem('bp-annotations', JSON.stringify({ [SLUG]: [moved, lost] }))
    reanchorAnnotations(SLUG, ['Chapter I. ' + text])
    const [a, b] = stored('bp-annotations')[SLUG] as Annotation[]
    expect([a.start, a.end, a.stale]).toEqual([11, 20, undefined])
    expect(b.stale).toBe(true)
    const before = localStorage.getItem('bp-annotations')
    localStorage.setItem('bp-annotations', before!.replace(/^/, ' '))
    reanchorAnnotations(SLUG, ['Chapter I. ' + text])
    expect(localStorage.getItem('bp-annotations'), 'nothing rewritten').toBe(' ' + before)
    // The text back again: drawn again
    reanchorAnnotations(SLUG, [text.replace('Alice was beginning', 'nothing was beginning')])
    expect((stored('bp-annotations')[SLUG] as Annotation[])[1].stale).toBeUndefined()
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
