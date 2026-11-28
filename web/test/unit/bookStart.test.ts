import { describe, expect, it } from 'vitest'
import { bookStart } from '../../src/hooks/bookStart'

const chapters = (...titles: string[]) => titles.map(title => ({ title }))

describe('skip preface', () => {
  it('skips multiple introductory sections through the first chapter, preserving later progress', () => {
    const book = chapters('Preface', 'A Word of Explanation', "The Stranger’s History", 'Chapter 1: Camelot', 'Chapter 2')
    expect(bookStart(book, 0, false)).toBe(0)
    expect(bookStart(book, 0, true)).toBe(3)
    expect(bookStart(book, 1, true)).toBe(3)
    expect(bookStart(book, 4, true)).toBe(4)
    expect(bookStart(book, 99, true)).toBe(3)
  })

  it.each([
    ['Author’s Preface to the Second Edition', 'Chapter 1'],
    ['The Author’s Preface', 'Part 1, Chapter 1: A beginning'],
    ['Preface', 'Book 1, Chapter 1: M. Myriel'],
    ['Preface', 'Stave 1: Marley’s Ghost'],
    ['Preface', 'Act I'],
    ['Prefacio', 'Capítulo 1: El comienzo'],
    ['Prólogo', 'Parte I, Capítulo I'],
    ['Preface', 'The Raven'],
    ['Introduction', 'May 4'],
  ])('opens the first section of %s / %s', (preface, first) => {
    expect(bookStart(chapters(preface, first), 0, true)).toBe(1)
  })

  it('leaves books without introductory material, narrative prologues and ambiguous texts alone', () => {
    expect(bookStart(chapters('Chapter 1', 'Chapter 2'), 0, true)).toBe(0)
    expect(bookStart(chapters('Prologue', 'Chapter 1'), 0, true)).toBe(0)
    expect(bookStart(chapters('Preface'), 0, true)).toBe(0)
    expect(bookStart([], 0, true)).toBe(0)
    expect(bookStart(chapters('The First Story', 'Chapter 1'), 0, true)).toBe(0)
  })
})
