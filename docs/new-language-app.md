# Creating a language app

How to create a language app such as `libros` (Spanish, books#59): a fork of `books` with its own
edition (books#38, #58). Read [editions.md](editions.md) first: it explains which files the app owns
and which it takes from `books`.

## Before you start

- **Research and decisions.** There is a research page `docs/languages/<lang>.md` (like
  [es.md](languages/es.md)), and the owner has decided:
  - the app id and name;
  - the rights rule;
  - the narrator voice.
- **Engine support for the language**, landed in `books`:
  - a locale, `web/src/locales/<lang>.json` (books#54);
  - a language profile, `scripts/catalog/languages/<lang>.py` (books#56);
  - a voice the narration engine can use (books#57).

  Without these, the app shows English text, splits chapters wrongly or can't be narrated.
- **Access:** you can push to `freeappstore-online` and are signed in to the store's CLI (`fas login`).

## 1. Make the fork locally

```bash
git clone https://github.com/freeappstore-online/books.git libros
cd libros
git remote rename origin upstream        # books: the engine comes from here
```

## 2. Replace the edition

Remove the English books and write the app's own files. Never touch anything outside these paths.

```bash
git rm -r -q edition/books edition/texts edition/covers edition/public
echo '{}' > edition/sources.lock.json
echo '[]' > edition/covers.json
```

1. **`edition/config.json`:** the app's id, name, short name, language, site
   (`https://<id>.freeappstore.online`), marketing site, `index.html` title and descriptions in the
   language, and `audio`:
   - `dataset`: `serge-ivo/books-audio-<lang>`;
   - `voice`: the chosen voice;
   - `engine`: `kokoro`.

   The format is in [edition/README.md](../edition/README.md).
2. **`fas.json`:** set `appId` to the app id.
3. **`README.md`:** the app's own: what it is, its address, a link back to `books` for development.
4. **Books:** add them as in [adding-books.md](adding-books.md). The scripts work on this checkout's
   `edition/`. Then regenerate `edition/books.json` (`python3 scripts/catalog/books.py`) and the
   covers.
5. **`edition/public/`:** files the app's address needs at its root, such as search engine
   verification. Leave it empty until there are some.

Check:

```bash
python3 scripts/catalog/books.py --check && python3 scripts/catalog/test_catalog.py
cd web && pnpm install && pnpm exec tsc -b && pnpm test && pnpm build
fas check                                 # platform compliance, from the repo root
```

The tests use the test edition (`web/test/edition`), not the app's, so they pass whatever books it
has. Look at the build in a browser with `pnpm dev`. Everything should be in the app's language,
with its name and its books.

Commit: "Libros edition: config, first books".

## 3. Publish

```bash
fas publish --name libros --category Learning --type standalone --oneliner "<one line in the language>"
```

This provisions the repository (`freeappstore-online/libros`), hosting, the domain and the store
listing. It never creates a repository any other way (stores/CLAUDE.md). The listing text must give
counts that are true (books#51). Then push the fork:

```bash
git remote add origin https://github.com/freeappstore-online/libros.git
git push origin main
```

The push deploys the app in about a minute. Check `https://libros.freeappstore.online`.

## 4. Narration

- **Secret:** the *Generate audio* workflow needs `HUGGINGFACE_TOKEN` as a repository secret of the
  new repo, with write access to the app's dataset.
  - Secrets live in `~/dev/ops` (its AGENTS.md). Add the repo to the token's `consumers:` in
    `inventory.yaml` and extend its permissions to the new dataset, through an issue in
    `serge-ivo/ops`.
  - Never paste a token anywhere else.
- **Running it:** run *Generate audio* in the new repo with the books to narrate. It creates the
  dataset on its first run.
- **Before each batch,** listen to two minutes of a book (docs/languages/<lang>.md, "Voice").

## 5. Keep it in sync

- **Sync:** `.github/workflows/sync.yml` merges `books` main every Monday. It keeps the app's own
  files, runs the checks, then pushes, deploys and starts the tests. Run it once by hand after
  publishing: `gh workflow run sync.yml -R freeappstore-online/libros`.
- **Drift check:** `.github/workflows/engine-check.yml` fails any push that changes engine files in
  the app.

### When the sync fails

The workflow opens an issue named "Sync with books failed" in the app's repo, and pushes nothing.

- **The merge conflicted.** Someone changed engine files in the app. Revert that change in the app,
  and make it in `books` if it's still wanted. Then run the sync again. The script prints the files:
  `scripts/edition/sync-upstream.sh` (run it locally with a clean tree).
- **A check failed.**
  - If it's an engine bug, fix it in `books`; the next sync brings the fix.
  - If the app's books no longer fit a changed engine (for example `books.py --check` after a format
    change), regenerate the edition's files in the app and commit them. Then run the sync again.

## 6. After launch

- **Search Console:** put its verification file in `edition/public/`, then submit the sitemap.
- **IndexNow:** put its key file in `edition/public/`, as `books` did (books#48, #49).
- **Device checks:** go through the real-device checks in the README on an iPhone and an Android
  phone.
