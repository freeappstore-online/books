import { describe, expect, it } from 'vitest'
import {
  BOOK_TEXT, UI_TEXT, getReaderFontSize, getUiScale, setReaderFontSize, setUiScale,
  getChapterPause, getContinueChapters, getReadTitles, getVolumeBoost,
  setChapterPause, setContinueChapters, setReadTitles, setVolumeBoostPref,
} from '../../src/hooks/usePreferences'

const rootFontSize = () => (document.documentElement.style as { fontSize?: string }).fontSize

describe('text size preferences', () => {
  it('default when nothing is saved or the value is not a number', () => {
    expect(getReaderFontSize()).toBe(BOOK_TEXT.default)
    expect(getUiScale()).toBe(UI_TEXT.default)
    localStorage.setItem('bp-font-size', 'large')
    localStorage.setItem('bp-ui-scale', '')
    expect(getReaderFontSize()).toBe(BOOK_TEXT.default)
    expect(getUiScale()).toBe(UI_TEXT.default)
  })

  it('clamp saved values from older versions or hand edits', () => {
    localStorage.setItem('bp-font-size', '99')
    localStorage.setItem('bp-ui-scale', '10')
    expect(getReaderFontSize()).toBe(BOOK_TEXT.max)
    expect(getUiScale()).toBe(UI_TEXT.min)
  })

  it('clamp what is set', () => {
    setReaderFontSize(BOOK_TEXT.min - 5)
    expect(getReaderFontSize()).toBe(BOOK_TEXT.min)
    setReaderFontSize(BOOK_TEXT.max + 5)
    expect(getReaderFontSize()).toBe(BOOK_TEXT.max)
    setUiScale(UI_TEXT.max + 50)
    expect(getUiScale()).toBe(UI_TEXT.max)
    expect(rootFontSize()).toBe(`${UI_TEXT.max}%`)
  })

  it('book and interface sizes are independent', () => {
    setReaderFontSize(20)
    setUiScale(120)
    expect(getReaderFontSize()).toBe(20)
    expect(getUiScale()).toBe(120)
    expect(rootFontSize()).toBe('120%')
    setReaderFontSize(24)
    expect(getUiScale()).toBe(120)
    expect(rootFontSize()).toBe('120%')
  })

  it('tell the app when they change', () => {
    let changes = 0
    const count = () => { changes++ }
    window.addEventListener('bp-preferences-changed', count)
    setReaderFontSize(18)
    setUiScale(90)
    window.removeEventListener('bp-preferences-changed', count)
    expect(changes).toBe(2)
  })
})

describe('listening preferences (books#37)', () => {
  it('default: titles read, 1.5 s pause, continue, no boost', () => {
    expect(getReadTitles()).toBe(true)
    expect(getChapterPause()).toBe(1.5)
    expect(getContinueChapters()).toBe(true)
    expect(getVolumeBoost()).toBe(false)
  })

  it('keep what is set, including off', () => {
    setReadTitles(false)
    setChapterPause(0)
    setContinueChapters(false)
    setVolumeBoostPref(true)
    expect(getReadTitles()).toBe(false)
    expect(getChapterPause()).toBe(0)
    expect(getContinueChapters()).toBe(false)
    expect(getVolumeBoost()).toBe(true)
    setChapterPause(5)
    expect(getChapterPause()).toBe(5)
  })

  it('a pause that is not offered, or a bad flag, reads as the default', () => {
    localStorage.setItem('bp-chapter-pause', '2')
    localStorage.setItem('bp-read-titles', 'maybe')
    expect(getChapterPause()).toBe(1.5)
    expect(getReadTitles()).toBe(true)
    localStorage.setItem('bp-chapter-pause', '')
    expect(getChapterPause()).toBe(1.5)
  })
})
