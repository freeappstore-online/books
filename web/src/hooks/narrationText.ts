/**
 * The sentences a chapter is narrated in (books#66), as scripts/audio/segments.py splits them with
 * the English profile (scripts/catalog/languages/en.py), so a chapter narrated on a listener's device
 * is timed in the same pieces as one from the narration pipeline. Blank lines end paragraphs; a
 * sentence ends at . ! ? or … (with closing quotes or brackets) before whitespace and no lowercase
 * word, and not after a title like Mr. or an initial. Offsets are JavaScript string indices.
 */
const PARAGRAPH = /\S[\s\S]*?(?=\s*\n\s*\n|\s*$)/g
const END = /[.!?…]+[”’"')\]]*(?=\s+(?![a-z]))/g
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Rev|Capt|Col|Gen|Lt|Mt|[A-HJ-Z])$/

/** [start, end, endsParagraph] of every sentence, in order, trimmed of surrounding space. */
export function narrationSentences(content: string): [number, number, boolean][] {
  const out: [number, number, boolean][] = []
  for (const para of content.matchAll(PARAGRAPH)) {
    const from = para.index
    const text = para[0]
    let start = from
    for (const m of text.matchAll(END)) {
      const at = from + m.index
      if (m[0] === '.' && ABBREVIATION.test(content.slice(start, at))) continue
      const end = at + m[0].length
      out.push([start, end, false])
      const rest = text.slice(end - from)
      start = end + rest.length - rest.trimStart().length
    }
    if (start < from + text.length) out.push([start, from + text.length, false])
    out[out.length - 1][2] = true
  }
  return out
}
