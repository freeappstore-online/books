# Language apps: which language first

Research for books#38, done 2026-11-11. The language apps are forks of this repo (books#58), each with
its own `edition/` (books#53). This page records which language goes first and why, with the numbers
behind the choice. The chosen language's catalogue, rights rule, voice and SEO plan are in
[es.md](es.md).

## Decision

1. **Spanish** goes first (books#59).
2. **Brazilian Portuguese** is second.
3. **French** is third.
4. **Italian** comes after those.
5. **German and Russian** wait for a second narration engine (books#57), or for LibriVox recordings
   aligned to our texts (see "Other ways to get audio").

Why Spanish:

- **Largest reachable audience after English.** About 364M internet users, which is 2.5 times French
  and twice Portuguese.
- **Interest in the classics is as high as anywhere.** Wikipedia readers view the classics' articles
  in Spanish as often as in French, Russian or German.
- **Little competing free audio.** French already has Littérature Audio, about 8,000 free human-read
  audiobooks, which takes the "livre audio gratuit" searches. Spanish has no such site: free classics
  audio is spread across LibriVox (about 560 recordings) and YouTube uploads.
- **Enough good texts.** Gutenberg has 914 Spanish texts, with the canon of Spain and Latin America,
  and they're clean: 50 of the 57 checked are usable as they are (es.md). Wikisource fills the gaps.
- **Kokoro speaks it.** Kokoro v1.0 has three Spanish voices, so no new engine is needed. In an
  automatic check they were as intelligible as the French and Italian voices.

Why not French first, although it has the best-graded voice and the most Gutenberg texts: the free
audio market is taken, and the audience is smaller. Portuguese has the least competition and the
cleanest Kokoro output, but about half the audience and a third of the interest.

## The numbers

| | es | pt | fr | it | de | ru | ja |
|---|---|---|---|---|---|---|---|
| Internet users (millions, Internet World Stats) | 364 | 172 | 145 | – | 93 | 116 | 119 |
| Views of 60 classics' Wikipedia articles, 12 months to Oct 2026 (millions) | 6.78 | 2.28 | 6.50 | 4.74 | 6.01 | 6.79 | 4.23 |
| Wikisource page views, Oct 2026 (millions) | 3.67 | 2.81 | 12.89 | 8.27 | 5.16 | 8.44 | 0.99 |
| Gutenberg texts | 914 | 656 | 4,252 | 1,113 | 2,455 | 5 | 21 |
| Downloads of the top 100 Gutenberg texts, last 30 days (thousands) | 218 | 131 | 230 | 117 | – | – | – |
| LibriVox recordings | 564 | 107 | 315 | 89 | 850 | 76 | 37 |
| Large free human-read audio site | none found | none found | Littérature Audio (~8,000) | Liber Liber (some) | LibriVox | many | Aozora audio |
| Kokoro v1.0 voices (grade) | 3 (not graded) | 3 (not graded) | 1 (B-) | 2 (C) | 0 | 0 | 5 (C+ to C-) |
| Whisper word error on a sample (lower is clearer) | 0.11–0.12 | 0.05 | 0.17 | 0.06–0.10 | – | – | – |

How each number was made, so it can be redone:

- **Internet users:** Internet World Stats' users by language, as quoted on Wikipedia's
  "Languages used on the Internet". The snapshot is older than 2025, so read it for proportions only.
- **Classics interest:**
  - Method: monthly user page views (Wikimedia REST API, Nov 2025 to Oct 2026) of the same 60 works'
    articles in each language's Wikipedia. The articles were found through each work's Wikidata
    sitelinks.
  - The works: world classics (Don Quixote, War and Peace, Hamlet, Les Misérables…) plus national
    ones from each language (Dom Casmurro, I promessi sposi, Eugene Onegin, Kokoro…).
  - It measures interest in the books themselves, which is close to what a reader searches for.
- **Wikisource views:** the same API, aggregate user views per Wikisource, October 2026. These are
  people reading public-domain texts online: the closest existing audience to ours.
- **Gutenberg:** text counts come from `pg_catalog.csv` (type Text, by language). Downloads are the
  sum over the top 100 of `gutenberg.org/ebooks/search/?query=l.<lang>&sort_order=downloads`.
- **LibriVox:** archive.org's `librivoxaudio` collection, counted by language code (`spa`, `por`,
  `fre` plus `fra`, `ita`, `deu` plus `ger`, `rus`, `jpn`).
- **Kokoro:** grades come from hexgrad/Kokoro-82M `VOICES.md`.
- **Word error:**
  - Each voice read one opening paragraph from its language's literature, with dialogue, a chapter
    heading in Roman numerals and a year.
  - Whisper `small` transcribed the result, and the word error rate was measured against the text.
  - Most errors are numbers written as digits ("50" for "cincuenta") and archaic words ("adarga",
    "rocín").
  - French read "Chapitre XII" as "douze romain" ("twelve Roman"), so its language profile must
    spell Roman numerals out (books#56).
  - This measures intelligibility, not how pleasant the voice is: a person still has to listen
    (es.md, "Voice").

## Other ways to get audio

- **Littérature Audio (French):** its licence isn't clear. At best it is non-commercial, and the
  readers keep their rights, so we can't republish it.
- **LibriVox (all languages):** recordings are public domain, so they can be used. Each one reads a
  different edition from ours, though, so its chapters don't match ours and read-along would need
  forced alignment (matching the recorded audio to our text). Recording quality also varies by
  volunteer.

  LibriVox is the realistic way to give German (about 850 recordings) and Russian audio before a
  second engine exists. It would be its own pipeline: download, then align to our text, then
  `timings.json`. It isn't planned yet.

## Risks of starting with Spanish

- **Search competition for the texts.** Biblioteca Virtual Miguel de Cervantes, Wikisource and ebook
  sites rank for "<title> leer online". Our edge is reading and listening together, with the words
  highlighted, free and offline. Each book's static page (books#47) should lead with the audio.
- **Voice quality isn't graded.** The three Spanish voices are intelligible but haven't been judged
  for naturalness. The owner listens before any narration batch (es.md).
- **Rights across twenty countries.** Spain applies life+80 for authors who died before 1987, and
  Mexico life+100 for recent deaths. es.md sets a two-tier rule.
