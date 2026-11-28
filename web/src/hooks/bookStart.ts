const normalized = (title: string) => title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
const FRONT_MATTER = /^(?:(?:the )?(?:author[’']s|translator[’']s|editor[’']s) )?(?:preface|foreword|introduction|dedication|acknowledg(?:e)?ments|prefacio|prologo|introduccion|dedicatoria|agradecimientos)\b/
const FIRST_DIVISION = /^(?:(?:book|part|volume|section|libro|parte|volumen|seccion)\s+(?:\d+|[ivxlcdm]+)\s*[,.:—–-]\s*)*(?:chapter|stave|act|book|part|canto|capitulo|acto|libro|parte)\s+(?:1|i|one|uno|primero)\b/

/** Start after introductory material, preserving later progress and unnumbered works. */
export function bookStart(chapters: { title: string }[], savedChapter: number, skipPreface: boolean): number {
  const saved = Number.isInteger(savedChapter) && savedChapter >= 0 && savedChapter < chapters.length ? savedChapter : 0
  if (!skipPreface || !chapters.length || !FRONT_MATTER.test(normalized(chapters[0].title))) return saved
  // Some books have letters or other introductory sections between the preface and Chapter 1.
  let first = chapters.findIndex(c => FIRST_DIVISION.test(normalized(c.title)))
  if (first < 0) first = chapters.findIndex(c => !FRONT_MATTER.test(normalized(c.title)))
  return Math.max(saved, first < 0 ? 0 : first)
}
