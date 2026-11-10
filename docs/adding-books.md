# Adding a book

A catalogue book is a whole Project Gutenberg text split into chapters, with optional pre-generated
Kokoro narration. Adding one takes two steps:

1. **Text:** `scripts/catalog/fetch.py` writes `web/public/catalog/<slug>.json`, then you push to `main`
   and the app redeploys.
2. **Narration:** the *Generate audio* workflow uploads `<voice>/<slug>/<chapter>.m4a`, its
   `<chapter>.timings.json` and its title clip `<chapter>.title.m4a` to the
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

This downloads the text once into the cache (at about one request per second), records its SHA-256 in
`scripts/catalog/sources.lock.json`, writes `web/public/catalog/north-and-south.json` and updates
`chapters` and `readTime` in `catalog.ts`. If it fails with an `AssertionError` from `update_catalog_ts`,
a `BOOKS` entry and a `catalog.ts` entry don't match up one-to-one.

Never edit a `web/public/catalog/*.json` file by hand: the next rebuild would undo it, and CI's rebuild
check fails on it. Fix the text with options in `BOOKS` (or in `fetch.py` itself, see
[the pipeline guide](catalogue-pipeline.md)).

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

`qa.py` passing doesn't mean the split is right. Books that need options often still pass: a missed
heading folds two chapters into one, or untitled "Part N" chapters start with the heading text. So check
the chapter list of every book, not just a few. A quick way is to print each book's titles, its first 80
and last 80 characters, and any gaps in the chapter numbers.

### 6. Add the cover

```bash
cd scripts/catalog && python3 covers.py ~/.cache/books-covers north-and-south   # needs Pillow
```

`covers.py` downloads the Gutenberg cover (the full-size scan if there is one, otherwise the 200 px
thumbnail), writes `web/public/covers/<slug>.webp` and regenerates `web/src/data/covers.ts`. A book
with no cover shows its `coverGradient` instead.

Look at every new cover. Many Gutenberg books only have a *generated placeholder*: the title in a white
band over coloured geometric shapes, with a "Project Gutenberg" label. Add those slugs to `SKIP` in
`covers.py` with the `GENERATED` reason, then run the script again for them. That deletes their `.webp`
and drops them from `covers.ts`.

For a book with no usable Gutenberg cover, look for a free one on Wikimedia Commons. It is usually the
lead image of the book's Wikipedia article: the first-edition cover, its jacket or its title page. Use
it only if the file is on Commons and marked *Public domain*. Leave it out if it is stored only on
en.wikipedia (fair use), if it has a CC licence (it would need credit), or if it is a portrait, a
painting or a film still rather than the book itself. An illustration from the first edition is fine,
as with Pinocchio. Add the book to `SOURCES` in `covers.py` as
`(file name, crop)` (crop is `None`, or fractions to cut a two-page spread down to its title page) and
remove it from `SKIP`. `SOURCES` takes precedence over Gutenberg.

### 7. Typecheck and build

```bash
pnpm --filter @freebooksapp/web exec tsc -b && pnpm build && du -sh web/dist
```

Then run the pipeline's tests and rebuild check (the same as CI's *Catalogue pipeline* workflow):

```bash
python3 scripts/catalog/test_catalog.py
python3 scripts/catalog/fetch.py ~/.cache/books-gutenberg --check
```

### 8. Commit and push

Commit the `fetch.py`, `sources.lock.json`, `covers.py`, `catalog.ts`, `covers.ts`,
`web/public/catalog/<slug>.json` and `web/public/covers/<slug>.webp` changes, referencing the issue (`Refs #N`). A push to `main` deploys.
Add books in batches rather than one commit per book.

## Narration

Narration runs in the **Generate audio** workflow (`.github/workflows/generate-audio.yml`), started by
hand. It runs from `main`, so push the text first. For now only Alice (`alice-in-wonderland`) is to be
narrated: the owner decided on 2026-11-10 to perfect one book before starting others (books#27).

```bash
gh workflow run generate-audio.yml -R freeappstore-online/books \
  -f books="north-and-south villette"     # space-separated slugs, required; there is no "every book" mode
  # -f voice=af_heart                      # Kokoro voice id; af_heart is the default
  # -f force=true                          # narrate these books again even where audio exists
gh run watch -R freeappstore-online/books  # or the Actions tab
```

The workflow runs three jobs:

1. **plan** (`scripts/audio/plan.py`) refuses an empty `books` or a slug that is not in the catalogue,
   then lists every chapter of `books` that has no
   `<voice>/<slug>/<chapter>.m4a` in the dataset yet (every chapter of `books` with `force`). It packs them into shards of up to 600k characters
   (about 4 h of CPU), keeping a book's chapters together.
2. **generate** (`scripts/audio/generate.py`) runs one job per shard, at most 15 at once. It narrates
   each chapter with Kokoro v1.0 one sentence at a time
   (`scripts/audio/segments.py` splits them), joins them with short pauses, and encodes 40 kbps mono AAC
   (full band, about 18 MB per hour), loudness-normalised with a two-pass ffmpeg `loudnorm` to about
   **−18 LUFS** with a true peak of at most **−1 dBTP** (books#37). The normalisation only changes the level: no sample
   moves, so the timings stay exact. It also narrates the chapter's title as `<chapter>.title.m4a`: the
   catalogue title spoken ("Chapter 1: The Cyclone" → "Chapter One. The Cyclone.",
   `segments.spoken_title`), trimmed to at most 0.1 s of silence at each end, normalised the same way.
   Next to the audio it writes `<chapter>.timings.json`, `{"v":1,"segments":[[charStart,charEnd,startSec,endSec],...]}`,
   one segment per sentence with UTF-16 offsets into the chapter's `content` (books#22); the reader
   uses it to follow and highlight the narration. At most every 10 minutes it commits the new chapters
   together with an updated `manifest.json`, so they appear in the app while the run goes on and a job
   that dies keeps most of its work.
3. **manifest** (`scripts/audio/manifest.py`) rebuilds the `books`' entries in `manifest.json` from
   the dataset once all shards are done, in case one died before its last commit. Only the run's
   `books` in the run's `voice` are touched; every other entry is kept as it is, so audio of other
   books in the dataset stays out of the app until a run names them. A chapter's seconds are where its
   `timings.json` ends, or the audio's real length from `ffprobe` (over HTTP, else downloaded) for audio
   without timings; never a file-size estimate (books#31). A chapter with no audio is `null`. The app's
   "Audiobook" badge, its Play button and playback come from this file (`web/src/hooks/preparedAudio.ts`).

   Next to the voices, `manifest.json` has one more top-level key (books#37), so the app knows what
   else exists without probing for it:

   ```json
   {"af_heart": {"alice-in-wonderland": [655.2, 646.3, ...]},
    "extras": {"af_heart": {"alice-in-wonderland": {"timings": true, "titles": [2.41, 3.05, ...]}}}}
   ```

   `timings` is true when every narrated chapter of the book has a `timings.json`; `titles` has each
   chapter's title clip length in seconds (`null` without one). It is rebuilt with the book's entry,
   in every mode.

To publish audio that is already in the dataset without narrating anything, dispatch with
`mode=manifest`: it skips plan and generate and runs only the manifest job for `books`, which there
may also be `all-existing` (every book with audio in the voice). `all-existing` is refused in
`narrate` mode (books#31).

```bash
gh workflow run generate-audio.yml -R freeappstore-online/books -f mode=manifest -f books=all-existing
```

To add title clips to books narrated before they existed, without narrating their chapters again,
dispatch with `mode=titles`. It plans only the chapters that have audio but no `<chapter>.title.m4a`
(every narrated chapter with `force`), makes their clips, and rebuilds the manifest; `books` may be
`all-existing`. A title takes about 2 s of runner time, so even every narrated book (~1,700 chapters)
fits in one shard of about an hour. Each book's titles are made as loud as its published chapters
(measured on one of them, about −22 LUFS for books narrated before books#37), so no title jumps out
and no chapter is re-encoded.

```bash
gh workflow run generate-audio.yml -R freeappstore-online/books -f mode=titles -f books=all-existing
```

Wait for any running *Generate audio* run to finish first: its shards also commit `manifest.json`.

In the app, a partly narrated book plays its narrated chapters and passes over the others (Next,
Previous and auto-advance); its other chapters are reading-only (no Play). A chapter without timings
plays without the read-along highlight.

Audio narrated before timings existed (everything uploaded before books#22, except Alice) has no
`timings.json`. Either narrate it again with `force`, or derive timings from the pauses in the audio
with `scripts/audio/backfill_timings.py CATALOG_DIR REPO VOICE SLUG...` (needs `HF_TOKEN` and ffmpeg;
approximate, see books#22).

`python scripts/audio/test_audio.py` tests the scripts' pure parts against the catalogue, the spoken
titles and the loudness step (no network; needs ffmpeg).

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
  same `books` again. Chapters that were already uploaded are skipped. That check only sees whether a
  file exists, so after a `force` run that died, dispatching again *without* `force` keeps the old audio
  of the chapters it had not reached yet; dispatch with `force` again (it narrates the whole book anew).
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
