# Books

Listen to 130+ classic audiobooks with text-to-speech. Read or listen — your progress saves automatically.

**Category:** Learning  
**Live:** [books.freeappstore.online](https://books.freeappstore.online)

## Development

```bash
pnpm install
pnpm dev
```

## Tests

In `web/` (CI runs all of them on every push and pull request: `.github/workflows/test.yml`):

```bash
pnpm exec tsc -b          # typecheck, app and tests
pnpm test:unit            # Vitest: read-along, narration manifest, positions, text sizes, offline helpers
pnpm exec playwright install chromium firefox webkit   # once
pnpm test:e2e             # Playwright: builds, serves the build, runs every project
pnpm test:e2e --project=chromium   # one project: chromium, firefox, webkit (iPhone 13) or edge
```

The e2e tests stub Hugging Face with silent WAVs and generated timings (`web/e2e/fixtures.ts`), so
they need no network. The `edge` project covers offline and app-update edge cases in Chromium with
the real service worker, against `web/e2e/edge/server.ts`, which can stall a stream and serve a second
build of the app.

Before closing a playback issue, also check on real devices, which headless browsers can't stand in for:

- **iPhone, Safari** (and added to the Home Screen): Play starts on the first tap; audio carries on
  with the screen locked; lock-screen play/pause, ±seek and previous/next chapter work; the next
  chapter starts by itself with the screen locked; a call or unplugged headphones pause it and the
  app shows Paused.
- **Android, Chrome**: the same, from the notification controls.

## Adding books

See [docs/adding-books.md](docs/adding-books.md): text from Project Gutenberg, then pre-generated narration.

## Deploy

Push to main — auto-deploys to R2 via GitHub Actions.

## License

MIT
