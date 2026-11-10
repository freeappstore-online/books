# Your own books: design

Status: design, nothing built yet. Epic: books#46. Issues: #39 import, #40 storage, #41 reader and player,
#42 on-device narration, #44 encoding, #43 narration jobs, #45 compliance and checks.

The goal is to let a person add a book file from their device, read it offline for as long as the browser keeps
the site's data, and optionally turn it into an audiobook on that device. Nothing leaves the device.

## Decisions (owner, 2026-11-10)

| Question | Decision |
|---|---|
| "Forever" | As long as the browser keeps the site's storage. We ask for persistent storage, nudge people to install the app, and offer backup and restore. |
| Narration on phones | Allowed when the user chooses it. Before starting, show the estimated time and battery cost. |
| Languages to narrate | English only for now, because the voice is English. Books in other languages can be imported and read, but not narrated. |
| Keep the original file | No. Only the converted text, cover and metadata are stored. |
| Formats | Book formats that have a mature, standard parser. See below. |

## Formats

The rule is to support a format only when a standard, maintained parser gives reliable chapters and paragraphs.
Formats that would need heuristics we have to maintain ourselves are out.

| Format | Parser | Verdict |
|---|---|---|
| EPUB 2/3 | [foliate-js](https://github.com/johnfactotum/foliate-js) `epub.js` (MIT; the engine of the Foliate reader), with its vendored zip.js | **Yes.** Spine order, navigation and table of contents, metadata and cover all come from the standard. |
| MOBI, AZW3/KF8 (no DRM) | foliate-js `mobi.js` | **Yes.** It is the same library, and many older Kindle-era book files use these formats. |
| FB2, FBZ | foliate-js `fb2.js` | **Yes.** It is plain XML with explicit sections, and is common for Russian books. Those can be read but not narrated (English only). |
| Plain text (.txt) | Our own code. The format is trivial, and we already handle Gutenberg-style text: the header and footer, `CHAPTER IV` headings, and unwrapping hard line breaks (scripts/catalog, books#33 and #37). | **Yes.** Chapters come from detecting headings; if none are found, the text is split into parts of about 10,000 words. |
| DOCX | [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2; the standard DOCX→HTML converter) | **Deferred.** It is a solved problem, but a DOCX is a document rather than a book format. Add it later if people ask; the pipeline below accepts any HTML source. |
| PDF | pdf.js extracts text, but a PDF has no paragraphs or reading order. Columns, running headers and footers, hyphenation and footnotes all need heuristics. | **No.** No standard parser gives book structure. |
| HTML, Markdown | | **No** for now; they are not book formats. |
| DRM-protected files (Adobe ADEPT, Apple FairPlay, Kindle DRM) | | **Refused** with a clear message. Detected from `META-INF/encryption.xml` and from MOBI header flags. |

foliate-js is not published on npm. We vendor the files we need (`epub.js`, `mobi.js`, `fb2.js`, the zip
loader) into `web/src/vendor/foliate/` at a pinned commit, with its LICENSE, and lazy-load them only on the
import screen.

### Conversion

All formats convert to the app's existing book shape, the same as `web/public/catalog/*.json`:

```ts
interface ImportedBook {
  id: string                 // "local-" + uuid
  title: string; author: string; language: string   // BCP 47, from metadata or detection
  cover?: Blob               // from the file, else the gradient cover (BookCover)
  chapters: { title: string; content: string }[]     // paragraphs separated by blank lines
  added: number; sourceName: string; sourceBytes: number; hash: string  // the hash is for duplicate detection
}
```

- **Text extraction:** foliate-js gives each section as an XHTML document. A small DOM walker produces plain
  text:
  - Each block element (p, div, h1–h6, blockquote, li) becomes a paragraph.
  - Line breaks are kept inside verse (`<br>` within a block).
  - script, style, svg and images are dropped, and footnote markers are removed.
- **Chapters:** sections come in spine order.
  - Tiny front-matter sections (cover, title page, copyright, under about 300 characters) are merged into
    the next section.
  - Sections over about 60,000 characters are split at their headings.
  - Chapter titles come from the book's table of contents, then from the first heading, then "Part N".
- **Parsing happens in a Web Worker**, so the UI stays responsive. Text larger than 50 MB is refused. Content from
  the file is never inserted as HTML; the reader renders plain text, as it already does.
- **Preview before saving:** title, author, language, cover and the chapter list with sizes. The user can rename
  chapters and merge them with their neighbours.

## Storage

Imported books are kept in IndexedDB, in a database called `books-local`, using the small `idb` wrapper or about
50 lines of our own code:

| Store | Key | Value |
|---|---|---|
| `books` | id | metadata and the cover blob |
| `chapters` | [id, index] | `{ title, content }` |
| `audio` | [id, index] | `{ blob, mime, seconds, timings, titleBlob?, titleSeconds?, voice, engine }` |
| `jobs` | id | narration job state (see below) |

- **Persistence:**
  - When the first book is added, explain why and call `navigator.storage.persist()`.
  - Show `navigator.storage.estimate()` in My books and in Settings.
  - The Safari warning from books#24 also covers imported books.
- **Backup and restore:** **Back up** downloads one `.zip` with everything for the books chosen: the book JSON,
  cover, audio, timings, annotations and progress. **Restore** imports such a file and skips books that are
  already present (same hash).
- **Errors:** a write that hits the quota rolls back what it started, the person is told what to delete,
  and nothing is left half-saved.
- **Deleting:** a whole book, or only its narration.
- **Existing app data:** annotations (books#11) and reading progress are already keyed by the book id, so imported
  books use them unchanged.

## Reading and playing (#41)

- **My books** gets a "Your books" section with an **Add a book** button. File input and drag and drop work
  everywhere. Where supported, the PWA `file_handlers` and `share_target` open book files straight in the app.
- **Reader route:** `/read/local-<id>`, with the same `ReaderPage`. `fetchChapters` (from books#28) gets a local
  source that reads from IndexedDB instead of `/catalog/<slug>.json`. Search, bookmarks, highlights, text size
  and keyboard shortcuts work unchanged.
- **Player:** plays local narration through the shared `<audio>` element in `hooks/narration.ts`, using blob
  URLs as offline-saved catalogue books already do. Read-along uses the stored timings, and the books#37
  settings apply: chapter titles, pause between chapters, continue to the next chapter, volume boost. A local
  book's narrated chapters are the ones present in the `audio` store; this is the local version of the
  manifest check.
- **Offline:** everything works offline. Book titles never go into analytics events.

## Narration on the device (#42, #44, #43)

### Engine

- **Model:** Kokoro-82M through [kokoro-js](https://www.npmjs.com/package/kokoro-js) (Apache-2.0, ONNX through
  transformers.js), in a dedicated Web Worker. This is the same model family and default voice (`af_heart`) as
  the prepared audiobooks, so imported books sound like the catalogue.
  - Before #23 the app had an in-browser engine for catalogue books. It can serve as reference code; see
    `git show a34e613^:web/src/hooks/useKokoro.ts`.
  - Catalogue books do **not** get on-device narration back. They keep the prepared recordings.
- **Hardware:** WebGPU (fp32 or fp16) when the device has it, otherwise WASM (q8). The model is downloaded from
  Hugging Face only when someone first creates an audiobook. It is about 90 MB in q8 and more in fp32; the size
  is shown before downloading. It is cached in Cache Storage and can be removed in Settings.
- **Language guard:** only books whose language is English (`en`, `en-*`) can be narrated. Detection uses the
  file's metadata first, then a cheap stop-word check on the text, and the person can correct it in the preview.
  Other books are reading-only and say why. A book is never narrated in a voice that doesn't match its language;
  that mismatch was the bug that led to #23.
- **Voices:** a few English Kokoro voices, which can be previewed. The voice is stored per book.

### Same segmentation and timings as the server

`scripts/audio/segments.py` is ported to `web/src/narration/segments.ts`. That includes the sentence ends,
quotes, abbreviations, the initials rule from #33 and paragraph ends.

- **Shared test vectors:** a JSON file of inputs and expected segments is run by both
  `scripts/audio/test_audio.py` and Vitest, so the two implementations cannot drift apart.
- **Timings:** each sentence is synthesised and its PCM appended, and every segment is recorded as
  `[charStart, charEnd, startSec, endSec]` in UTF-16 offsets. The format is the same `{"v":1,"segments":…}`, so
  `hooks/readAlong.ts` works unchanged.
- **Pauses:** the gaps between sentences and paragraphs match the server's, about 0.5 s and 0.9 s (see the #33
  measurements).
- **Title clips** (books#37) are made on the device the same way.
- **Loudness:** normalised to about −18 LUFS with a simple integrated-loudness gain (ITU-R BS.1770 K-weighting)
  and a peak limiter, both computed in the worker.

### Encoding (#44)

- **Preferred:** WebCodecs `AudioEncoder` producing AAC-LC (`mp4a.40.2`) at about 40 kbps, mono, 24 kHz, muxed
  into MP4 with a small dependency-free muxer, `mp4-muxer` (MIT). This plays everywhere, including iOS, and is
  about 18 MB per hour, the same as the prepared audio.
- **Fallback:** Opus in WebM, for browsers that can encode Opus but not AAC. Each choice is checked with
  `AudioEncoder.isConfigSupported` and `audio.canPlayType`.
- **Last resort:** 16-bit WAV at about 170 MB per hour, with a storage warning, for browsers with no encoder.
- **Durations** must be correct in the container so seeking works in Safari. This is verified in Playwright on
  WebKit and on a real iPhone.

### Jobs (#43)

- **Start:** **Create audiobook** shows an estimate before starting: the time on this device (from a 10-second
  benchmark sentence), the storage needed, and a battery note on phones. One job runs at a time.
- **Progress:** stored in `jobs` after every chapter, and within a chapter after every sentence batch. Reloads,
  closed tabs and app updates resume from the last saved point on the next visit. The app says plainly that the
  browser cannot keep narrating while the app is closed.
- **Listen while it's being made:** a finished chapter is playable straight away. Pressing Play on a chapter that
  isn't ready moves it to the front of the queue.
- **Controls:** pause, resume and cancel. Cancelling removes partial audio. The Screen Wake Lock toggle keeps the
  screen on while narrating in the foreground. On low battery the job pauses, where the Battery API exists.
- **Failures** (model load, out of memory, quota) stop the job cleanly with Retry. Half-written chapters are never
  kept.
- **Notification** when a long job finishes, if the person allowed notifications.

## Rules that stay

- **One Play button and one player**, playing narration that exists. There is no device speech.
- **No "AI" and no ✦ in the UI.** Use "Create audiobook", "Narrate on this device" and "narration".
  `e2e/wording.spec.ts` covers the new screens.
- **The FreeAppStore compliance check stays green:**
  - The model comes from Hugging Face on demand and is never bundled.
  - The import and narration code are lazy-loaded chunks.
  - The app needs no new host allowances beyond the Hugging Face files it already uses.
- **Accessibility:** axe-clean, with keyboard and screen-reader flows for import, preview and job progress.
- **Tests:**
  - Unit tests for the converters, using fixture EPUB2, EPUB3, MOBI, AZW3, FB2 and TXT files plus a DRM sample.
  - Unit tests for storage, segmentation parity and encoding checks.
  - Playwright for import → read → highlight → offline → play stubbed local narration → back up → clear →
    restore.
  - A real-device checklist for iPhone (installed and not installed) and Android.

## Milestones

- **A. Add any book and read it offline:** #39, #40, #41, #45.
- **B. Create an audiobook on your device:** #42, #44, #43, #45.
