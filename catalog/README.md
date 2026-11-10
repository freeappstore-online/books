# The catalogue's books

Each book in the catalogue is one file, `books/<slug>.toml`, and that file is the only place the book
is described (books#38). The slug is the file name. It is also the book's id in the app, its address
(`/read/<slug>/`) and its folder in the narration dataset, so never rename a published book.

Everything else is generated from these files:

| Generated | By | Holds |
|---|---|---|
| `web/public/catalog/<slug>.json` | `scripts/catalog/fetch.py` | the text, split into chapters |
| `web/src/data/books.json` | `scripts/catalog/books.py` (also run by `fetch.py`) | what the app lists, with each book's chapter count and reading time |
| `web/public/covers/<slug>.webp`, `web/src/data/covers.ts` | `scripts/catalog/covers.py` | the covers |

Never edit a generated file by hand. CI's *Catalogue pipeline* workflow checks that `books.json`
matches the book files and that every text rebuilds from its source unchanged. After you edit only a
book's metadata (its description, tags and so on), regenerate `books.json`:

```bash
python3 scripts/catalog/books.py
```

How to add a book, step by step: [docs/adding-books.md](../docs/adding-books.md). How the pipeline
works and how to change it safely: [docs/catalogue-pipeline.md](../docs/catalogue-pipeline.md).

## A book file

```toml
title = "Pride and Prejudice"
author = "Jane Austen"
year = 1813                      # first publication; negative for BCE (-500 is 500 BC)
genre = "Fiction"                # Fiction, Non-Fiction, Drama or Poetry (the app's genre filter)
tags = ["romance", "classic", "social commentary", "british"]
language = "en"                  # BCP 47 language of the text
author_bio = "English novelist known for her sharp social commentary and witty prose about the British landed gentry."
description = "The turbulent relationship between Elizabeth Bennet and Fitzwilliam Darcy as they overcome their pride and prejudice."
excerpt = "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife..."

[look]                           # the cover's colours, also shown when there is no cover image
gradient = "from-rose-900 to-pink-950"   # a Tailwind from-*-900 to-*-950 pair
accent = "#FB7185"

[source]                         # where the text comes from, and how it is split into chapters
gutenberg = 1342
start = "It is a truth universally.*"
first = "Chapter 1"
end = "CHISWICK PRESS.*"

[cover]                          # optional; without it the cover is Gutenberg's
commons = "File_name_on_Wikimedia_Commons.jpg"
```

Every key above is required, except `[cover]` and the split options. A misspelt or unknown key stops
every script with the file's name and what is wrong.

Strings: use `"..."` for text, and `'...'` (a literal string, where a backslash is just a backslash) for
regular expressions, so `'CHAPTER \d+'` needs no escaping. A literal string cannot contain `'`; use
`"..."` with `\\` for each backslash then.

## [source]

Exactly one of:

- `gutenberg = 1342`: one Project Gutenberg plain-text ebook.
- `gutenberg = [2833, 2834]`: one book published as several ebooks, joined in order.
- `[[source.volumes]]` tables, one per ebook, when the volumes need options of their own. A volume's
  options are added to the book's (set the shared ones in `[source]`, before the first volume):

  ```toml
  [source]
  drop = "Introduction.*"

  [[source.volumes]]
  gutenberg = 996
  end = 'DEDICATION OF VOLUME II\.'

  [source.volumes.titles]
  "^Chapter" = "Part 1, Chapter"

  [[source.volumes]]
  gutenberg = 996
  start = 'DEDICATION OF VOLUME II\.'
  ```

- `standardebooks = "author-slug/book-slug"`, plus `revision = "<40-character Git commit>"`:
  a complete Standard Ebooks edition, read in EPUB spine order from the pinned
  `https://github.com/standardebooks/author-slug_book-slug` source archive. Add
  `expected_chapters = N` and `ending = 'the reviewed final words'`. The archive hash is locked
  just like a Gutenberg source. Only bodymatter is included; chapter titles, publisher pages and
  part-divider headings stay out of narrated content. Authorial short chapters and verse are kept.
- `none = "why"`: a legacy text without a reproducible source. QA fails until it is replaced.

Every Gutenberg file or Standard Ebooks source archive a book is built from is pinned by its SHA-256 in
`scripts/catalog/sources.lock.json` (see the pipeline guide).

### Split options

Start with none. Add one only when the built book shows a problem (`qa.py` flags it, or the chapter
list is wrong). The existing book files are worked examples: `grep -l "heads_only" catalog/books/*`.

| Option | Type | What it does |
|---|---|---|
| `heads` | regex, or a list of them | extra heading patterns (matched against the whole stripped line), tried before the generic ones. Groups `kind`, `num` and `rest` make the title; a `fold` group marks a sub-heading folded into its chapter |
| `heads_only` | bool | no generic headings (CHAPTER I, BOOK II, bare numerals…), only `heads` |
| `toc` | bool | also take headings from the book's own contents list |
| `start` | regex | the line where the text begins (its first match, or match number `start_n`) |
| `start_n` | int | which match of `start` (0 is the first) |
| `end` | regex | the line where the text ends, itself excluded (its last match, or match number `end_n`) |
| `end_n` | int | which match of `end` (-1 is the last) |
| `drop` | regex | headings whose sections are left out (editorial notes, indexes…) |
| `first` | string | title of the text before the first heading, when that heading is lost in markup |
| `sub` | bool | take a title-case line after a bare heading as its subtitle |
| `nosub` | bool | never take the line after a heading as its subtitle |
| `label` | string | what a bare numeral heading is called (`Chapter` by default) |
| `titles` | table, regex = replacement | applied in order to the final chapter titles (`[source.titles]`) |
| `level` | int | the heading level that makes a chapter: 0 book/part/act, 1 chapter/scene, 2 bare numeral |
| `keep` | regex | a heading that looks like back matter but is the author's (an appendix) |
| `cut` | list of [start, end] regex pairs | remove every run of lines from a start line to the next end line |
| `gloss` | bool | remove Purves' marginal glosses and note references (Chaucer) |
| `strip` | regex | whole lines to remove (running heads, part dividers…) |
| `verse` | bool | a poetry book: a block whose lines all start with a capital keeps its line breaks even when they fill the wrap width (long rhymed lines, as in "The Raven"). In other books such a block is prose that happens to wrap at capitals, and is unwrapped |

A text with no headings at all is split at paragraph boundaries into parts of about 20,000 characters.

## [cover]

Optional. Without it, `covers.py` uses the Gutenberg cover of the book's first volume. Otherwise
exactly one of:

- `commons = "File_name.jpg"`: a public-domain file on Wikimedia Commons, the book's own cover or
  title page (rules in [docs/adding-books.md](../docs/adding-books.md#5-add-the-cover)). Add
  `page = 5` for a PDF or DjVu whose title page is inside the scan (count from 1, including blank
  flyleaves). Inspect the selected page; the default first page may be blank. Add
  `crop = [left, top, right, bottom]`, as fractions of the image, to cut out part of it, for example
  `[0.5, 0, 1, 1]` for the right-hand page of a two-page scan.
- `none = "why"`: the book has no cover image (its Gutenberg cover is a generated placeholder, say),
  so the app shows the `[look]` gradient.
