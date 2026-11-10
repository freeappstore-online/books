# Editions: one engine, an app per language

Books is the engine of several apps: this one (English), and language apps such as `libros` (Spanish,
books#59). Each language app is a **fork** of this repository that merges `books` main from time to time
(books#38, #58). Each one keeps its own **edition**. What separates them is one folder.

## The boundary

| Owned by each app (never merged from `books`) | Shared: the engine (only ever changed in `books`) |
|---|---|
| `edition/`: `config.json`, `books/`, `sources.lock.json`, `texts/`, `books.json`, `covers/`, `covers.json` | everything else: `web/`, `scripts/`, the workflows except `deploy.yml`, `docs/` |
| `README.md`, `fas.json`, `.github/workflows/deploy.yml` (written by `fas publish`) | |

Engine code never names an app. Anything that differs between apps, such as the name, language,
addresses, title, descriptions or narration dataset and voice, comes from `edition/config.json`. The
format of each file is in [edition/README.md](../edition/README.md).

## How the engine reads the edition

- **The app:** `@edition/*` is an alias for the edition folder (`web/vite.config.ts`,
  `web/vitest.config.ts`, the `paths` in the tsconfigs):
  - `src/data/edition.ts` exposes `config.json` as `EDITION`;
  - `src/data/catalog.ts` reads `books.json`, and `src/data/covers.ts` reads `covers.json`.
- **The build config** can't use that alias. `vite.config.ts` reads the edition's files from disk, and
  imports only modules that don't load edition data (`src/data/book.ts`, `src/hooks/manifest.ts`,
  `src/seo/bookPages.ts`). A module that needs the edition imports it through `@edition`, and the
  config must not import that module.
- **The build** (the `edition` plugin in `vite.config.ts`):
  - fills `{{edition.<key>}}` in `index.html` from the config;
  - writes `manifest.json` from `manifest.template.json` and the config;
  - copies `texts/` to `/catalog/` and `covers/` to `/covers/`. Those URLs never change: saved books,
    read-along timings and resume positions are keyed by them.
- **The scripts:** `scripts/catalog/books.py` resolves the edition (`EDITION`, `CONFIG`), and the
  other scripts take their paths from it. The workflows read `audio.dataset` and `audio.voice` from
  the config.
- **Another edition:** `BOOKS_EDITION=/path/to/edition` points the build, the unit tests, the
  scripts and the marketing generator at it.
