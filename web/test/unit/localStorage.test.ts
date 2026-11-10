import { describe, expect, it, vi } from 'vitest'
import { readLocal, readLocalRecord, writeLocal, retryLocalWrites } from '../../src/hooks/localStorage'

describe('personal data when browser storage is full', () => {
  it.each(['null', '[]', '12', 'not json'])('ignores malformed record data: %s', value => {
    localStorage.setItem('data', value)
    expect(readLocalRecord('data')).toEqual({})
  })
  it('keeps the latest edits in memory and retries them without losing earlier failed edits', () => {
    localStorage.setItem('notes', '["saved"]')
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    expect(writeLocal('notes', '["saved","first edit"]')).toBe(false)
    const notes = JSON.parse(readLocal('notes')!)
    notes.push('second edit')
    expect(writeLocal('notes', JSON.stringify(notes))).toBe(false)
    expect(localStorage.getItem('notes')).toBe('["saved"]')
    expect(JSON.parse(readLocal('notes')!)).toEqual(['saved', 'first edit', 'second edit'])
    set.mockRestore()
    retryLocalWrites()
    expect(JSON.parse(localStorage.getItem('notes')!)).toEqual(['saved', 'first edit', 'second edit'])
  })

  it('reads nothing, rather than throwing, when storage is blocked', () => {
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    expect(readLocal('notes')).toBeNull()
    expect(readLocalRecord('notes')).toEqual({})
    get.mockRestore()
  })

  it('retrying one key does not discard a different pending change', () => {
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
    writeLocal('progress', 'chapter 4')
    writeLocal('notes', 'remember this')
    set.mockRestore()
    writeLocal('progress', 'chapter 5')
    expect(readLocal('notes')).toBe('remember this')
    retryLocalWrites()
    expect(localStorage.getItem('progress')).toBe('chapter 5')
    expect(localStorage.getItem('notes')).toBe('remember this')
  })
})
