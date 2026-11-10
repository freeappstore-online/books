# The test edition

The unit and end-to-end tests run against this edition, not the app's own (`edition/`), so a language
app (a fork with other books, docs/editions.md) runs the same suite unchanged.

It is a frozen copy of thirteen books of the English edition, with its `config.json`, `books.json` entries,
texts and covers. Each book is one the tests need:

| Book | Why |
|---|---|
| `alice-in-wonderland` | the narrated book (`SLUG` in `e2e/fixtures.ts`) |
| `manhattan-transfer` | the partly narrated book (`PARTIAL`) |
| `as-i-lay-dying` | a book with a narration revision |
| `dracula`, `pride-and-prejudice` | reading-only books (not narrated in the stubbed manifest) |
| `a-little-princess`, `a-christmas-carol` | the chapter list; a preface before chapter 1 |
| `a-connecticut-yankee`, `narrative-of-frederick-douglass` | My books layout |
| `the-wind-in-the-willows`, `she`, `paradise-lost`, `les-miserables` | text wrapping: long words, Greek, verse, a table |

The suite builds with `BOOKS_EDITION` set to this folder (`playwright.config.ts`), and the unit tests
resolve `@edition` here (`vitest.config.ts`). When a test needs another kind of book, copy it in from
`edition/` and add it to `books.json` and, if it has a cover, `covers.json`. Don't edit copied texts by
hand: tests compare them with what the reader shows.
