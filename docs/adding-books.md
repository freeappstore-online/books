# Adding a book

A catalogue book is a whole Project Gutenberg text split into chapters, with optional pre-generated
Kokoro narration. Adding one takes two steps:

1. **Text:** `scripts/catalog/fetch.py` writes `web/public/catalog/<slug>.json`, then you push to `main`
   and the app redeploys.
2. **Narration:** the *Generate audio* workflow uploads `<voice>/<slug>/<chapter>.m4a` and its
   `<chapter>.timings.json` to the
   [`serge-ivo/books-audio`](https://huggingface.co/datasets/serge-ivo/books-audio) dataset on Hugging Face
   and updates its `manifest.json`. The app reads that manifest at runtime, so narration needs no
   redeploy.

Do step 2 only after the text is final on `main`, because audio files are keyed by chapter *index*
(see [Changing a book after it is narrated](#changing-a-book-after-it-is-narrated)).

You need Python 3 (`fetch.py` and `qa.py` use only the standard library), pnpm, and `gh`.

## Text

### 1. Pick the text

- Use Project Gutenberg plain text (`https://www.gutenberg.org/ebooks/<id>`). Check that its type is
  *Text*, not *Sound*, and that it is English. Pre-generated narration is English only: `generate.py`
  uses `en-gb` for `b*` voices and `en-us` for the rest.
- The rights bar is **public domain in the US**, the basis Gutenberg publishes under. If the author died
  after 1955, the book is still in copyright in Australia and other life+70 countries. Say so in the
  issue.
- Check the book isn't already in the catalogue under another title or Gutenberg ID:
  `grep -n "<id>" scripts/catalog/fetch.py` and `grep -in "<title>" web/src/data/catalog.ts`.
- Mind the deploy size. `web/dist` must stay under the platform's 250 MB per-app limit
  (`MAX_TOTAL_BYTES` in `freeappstore-online/platform` `packages/backend/src/routes/deploy.ts`), and no
  single file may exceed 25 MB. A book's JSON is roughly the size of its Gutenberg `.txt` file.

### 2. Register it in `scripts/catalog/fetch.py`

Add an entry to `BOOKS`, mapping the slug to `(gutenberg_id, options)`:

```python
"north-and-south": (4276, {}),
```

Start with `{}`. Add options only when step 5 shows a problem. The comment above `BOOKS` documents them
(`start`, `end`, `heads`, `toc`, `drop`, `strip`, `titles`, …), and the existing entries are worked
examples. A book published in several Gutenberg volumes takes a tuple of IDs, as `don-quixote` does:

```python
"the-portrait-of-a-lady": ((2833, 2834), {}),
```

### 3. Add the catalogue entry in `web/src/data/catalog.ts`

Append a `CatalogBook` to `CATALOG`. Keep `id` equal to the slug, and write `chapters: 0,` and
`readTime: '',` as placeholders: `fetch.py` fills both in from the generated file. It finds them by those
exact `chapters: N,` / `readTime: '…',` shapes, so keep them.

```ts
{ id: 'north-and-south', title: 'North and South', author: 'Elizabeth Gaskell', authorBio: '…', year: 1855, genre: 'Fiction', tags: ['classic', 'romance', 'british', 'social commentary'], description: '…', excerpt: 'The opening line…', chapters: 0, readTime: '', coverGradient: 'from-slate-900 to-zinc-950', coverAccent: '#94A3B8', contentPath: '/catalog/north-and-south.json' },
```

- `genre`: one of the existing values (`Fiction`, `Non-Fiction`, `Drama`, `Poetry`). The genre filter
  is built from whatever values appear (`GENRES`), so a new value adds a new option to it.
- `year`: first publication year. Use a negative number for BCE, as `the-art-of-war` does.
- `coverGradient` / `coverAccent`: a Tailwind `from-*-900 to-*-950` pair and a matching hex. Pick ones
  that aren't already used by neighbouring books.
- `excerpt`: the book's real opening words, ending with `...`.

### 4. Build the text

```bash
python3 scripts/catalog/fetch.py ~/.cache/books-gutenberg north-and-south
```

This downloads the text once into the cache (at about one request per second), writes
`web/public/catalog/north-and-south.json` and updates `chapters` and `readTime` in `catalog.ts`. If it
fails with an `AssertionError` from `update_catalog_ts`, a `BOOKS` entry and a `catalog.ts` entry don't
match up one-to-one.

### 5. Check it

```bash
python3 scripts/catalog/qa.py ~/.cache/books-gutenberg north-and-south
```

`qa.py` compares the output with the Gutenberg body and exits 1 if it flags a book: leftover licence
text, `[Illustration]` markers, contents lists, a text much shorter than its source, or chapters that are
too small or too large. Fix a flag with options in `BOOKS`. If the book deliberately leaves out more
than 10% (a translator's introduction, notes), add it to `SHORT_OK` with the reason.

Then read it in the app (`pnpm dev`):

- the chapter list matches the book's own contents,
- chapter 1 starts at the first line of the text, with no title page, preface boilerplate or contents,
- the last chapter ends with the author's last line, with no index or notes unless they are the author's.

### 6. Typecheck and build

```bash
pnpm test && pnpm build && du -sh web/dist
```

### 7. Commit and push

Commit the `fetch.py`, `catalog.ts` and `web/public/catalog/<slug>.json` changes, referencing the issue
(`Refs #N`). A push to `main` deploys. Add books in batches rather than one commit per book.

## Narration

Narration runs in the **Generate audio** workflow (`.github/workflows/generate-audio.yml`), started by
hand. It runs from `main`, so push the text first.

```bash
gh workflow run generate-audio.yml -R freeappstore-online/books \
  -f books="north-and-south villette"     # space-separated slugs; empty = every un-narrated chapter
  # -f voice=af_heart                      # Kokoro voice id; af_heart is the default
  # -f force=true                          # narrate these books again even where audio exists
gh run watch -R freeappstore-online/books  # or the Actions tab
```

The workflow runs three jobs:

1. **plan** (`scripts/audio/plan.py`) lists every chapter that has no
   `<voice>/<slug>/<chapter>.m4a` in the dataset yet (every chapter of `books` with `force`). It packs them into shards of up to 600k characters
   (about 4 h of CPU), keeping a book's chapters together.
2. **generate** (`scripts/audio/generate.py`) runs one job per shard, at most 15 at once. It narrates
   each chapter with Kokoro v1.0 one sentence at a time
   (`scripts/audio/segments.py` splits them), joins them with short pauses, and encodes 40 kbps mono AAC.
   Next to the audio it writes `<chapter>.timings.json`, `{"v":1,"segments":[[charStart,charEnd,startSec,endSec],...]}`,
   one segment per sentence with UTF-16 offsets into the chapter's `content` (books#22); the reader
   uses it to follow and highlight the narration. At most every 10 minutes it commits the new chapters
   together with an updated `manifest.json`, so they appear in the app while the run goes on and a job
   that dies keeps most of its work.
3. **manifest** (`scripts/audio/manifest.py`) rebuilds the `books`' entries in `manifest.json` from
   the dataset once all shards are done, in case one died before its last commit. Only the run's
   `books` are touched (every book when `books` is empty), so audio of other books in the dataset
   stays out of the app until a run is asked for them. The app's "Audiobook" badge,
   its Play button and playback come from this file (`web/src/hooks/preparedAudio.ts`).

Audio narrated before timings existed (everything uploaded before books#22, except Alice) has no
`timings.json`. Either narrate it again with `force`, or derive timings from the pauses in the audio
with `scripts/audio/backfill_timings.py CATALOG_DIR REPO VOICE [SLUG...]` (needs `HF_TOKEN` and ffmpeg;
approximate, see books#22).

The upload uses the `HUGGINGFACE_TOKEN` repo secret (listed in `ops` `inventory.yaml`; it has write
access to `serge-ivo/books-audio`). Never print it.

### Capacity: dispatch in batches

- Kokoro narrates about **40 characters per second** on a GitHub runner. That is about 7 runner-hours
  per 1M characters, and 1M characters is about 18 h of audio.
- The `freeappstore-online` org runs **20 jobs at once**. The `generate` matrix is capped at 15
  (`max-parallel`), but a big run still slows the deploy and compliance runs of *every* repo in the
  org. On 2026-11-09 the uncapped full-catalogue run 42611075147 held this repo's deploys for more than 11 h.
- So dispatch batches of at most **~3M characters (≤5 shards)**, one *Generate audio* run at a time.
  Check before you start: `gh run list -R freeappstore-online/books -w "Generate audio" -s in_progress`.
  Two runs over the same books would narrate the same chapters twice, because each plan only sees what
  was uploaded before it started.

### Resuming and verifying

- If a shard fails or times out (the job limit is 355 minutes), re-run the failed jobs or dispatch the
  same `books` again. Chapters that were already uploaded are skipped.
- A book is done when the manifest has a duration for every chapter:

  ```bash
  curl -sL https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main/manifest.json \
    | python3 -c 'import json,sys; m=json.load(sys.stdin)["af_heart"]; s=sys.argv[1]; print(s, "missing" if s not in m else f"{sum(d is None for d in m[s])} of {len(m[s])} chapters missing")' north-and-south
  ```

- In the app, a book with no narration is reading-only: no Play button and no Audiobook pill. It becomes
  listenable once the manifest has a chapter of it in the app's voice (`af_heart`). So a newly added book stays
  reading-only until its narration lands. Check that the book now shows the Audiobook pill and that
  chapters play at once on a phone.

## Changing a book after it is narrated

Audio is stored by chapter **index** (`<voice>/<slug>/<i>.m4a`), and `plan.py` only checks whether a
file exists. So:

- If re-running `fetch.py` changes the chapter split, every later chapter's audio belongs to the wrong
  text.
- If it only changes the words inside a chapter, that chapter's audio is stale.

In either case, narrate the book again; if it now has fewer chapters, delete its folder from the
dataset first:

```bash
hf repos delete-files serge-ivo/books-audio "af_heart/<slug>/*" --repo-type dataset   # only if chapters were dropped
gh workflow run generate-audio.yml -R freeappstore-online/books -f books="<slug>" -f force=true
```

A book that is removed from the catalogue keeps its audio in the dataset, and `manifest.py` ignores it
because it builds the manifest from `web/public/catalog`.
