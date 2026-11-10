# The catalogue pipeline

How the catalogue's texts are built, how a build is kept reproducible, and how to change the
pipeline without breaking published books or their narration. To add a book, follow
[adding-books.md](adding-books.md). The plan to make the pipeline multi-language is books#38.

## What it produces

| Output | Made by | From |
|---|---|---|
| `web/public/catalog/<slug>.json`: `{"chapters": [{"title", "content"}]}` | `scripts/catalog/fetch.py` | the Gutenberg plain text, and the book's options in `BOOKS` |
| `chapters` and `readTime` in `web/src/data/catalog.ts` | `fetch.py` | the built files |
| `web/public/covers/<slug>.webp` and `web/src/data/covers.ts` | `scripts/catalog/covers.py` | the Gutenberg cover, or `SOURCES` (Wikimedia Commons) |
| narration on Hugging Face (`<voice>/<slug>/<chapter>.m4a` and `.timings.json`) | `scripts/audio/` via the *Generate audio* workflow | the built files |

A chapter's `content` is exactly what the reader shows and what the narration reads. Narration
files are keyed by chapter **index**, and `timings.json` points at character offsets in `content`.
So once a book is narrated:

- **Changing its chapter split** (adding, removing or merging a chapter) makes every later
  chapter's audio belong to the wrong text.
- **Changing the length of a chapter's text** shifts the highlighted words.
- **Changing whitespace for whitespace** (a line break for a space) is safe. It keeps every offset,
  and the sentence splitter treats both alike.

## Reproducible builds

- **`scripts/catalog/sources.lock.json`** pins the SHA-256 of every Gutenberg file a book is
  built from. Gutenberg sometimes re-releases a file. When that happens, `fetch.py` stops with
  "differs from the one in sources.lock.json" instead of quietly changing the book.
  - Rebuild the book and review the difference, including what it does to any narration.
  - Then run `fetch.py CACHE_DIR --relock SLUG` to accept the new file.
  - A new book's files are added to the lock on its first build.
- **`fetch.py CACHE_DIR --check [SLUG...]`** rebuilds books in memory and compares them with the
  committed files, writing nothing. It prints what differs, chapter by chapter, and exits 1 on any
  difference. It runs on every core, so the whole catalogue takes under a minute.
- **The *Catalogue pipeline* workflow** (`.github/workflows/pipeline.yml`) runs the unit and
  consistency tests and `--check` on every push that touches `scripts/`, the catalogue or its data.
  It caches the Gutenberg files between runs.

`scripts/catalog/test_catalog.py` holds the unit tests. Its consistency tests check that:
- `BOOKS`, `catalog.ts`, the built files, `covers.ts`, the cover files, `SKIP`/`SOURCES` and the
  lock all agree;
- every source is locked.

```bash
python3 scripts/catalog/test_catalog.py                            # needs Pillow
python3 scripts/catalog/fetch.py ~/.cache/books-gutenberg --check   # downloads missing sources first
```

## Changing the pipeline

A change to `fetch.py`'s cleaning or splitting can change many books at once. Before you push one:

1. Run `--check` over the whole catalogue and read what changed. A check that passes means the
   change touched no book.
2. Sort the changes into **whitespace-only** (safe for narration), **text** and **structure**
   (chapter count or titles). Look at a sample from every book type: prose, verse, drama, and
   books with notes or letters.
3. If the change is right, rebuild (`fetch.py CACHE_DIR`), commit the rebuilt files with the
   script, and say in the commit which books changed and how.
4. If a narrated book's structure or text length changed, re-narrate it (see "Changing a book
   after it is narrated" in [adding-books.md](adding-books.md)).

A prose paragraph is unwrapped, while verse keeps its line breaks (`is_verse`). A block whose
lines all start with a capital used to count as verse. Prose that happened to wrap at capitals
("replied the / Scarecrow;") then kept its line breaks in 175 books, including Oz (books#33 fixed
two of those by hand). A block whose lines fill the wrap width and break mid-phrase is now prose,
unless the book sets `verse` (Poe's poems, *Cane*), whose long rhymed lines look the same.
