# Restored complete texts

The three original catalogue files were excerpts. They now use complete Standard Ebooks editions
whose source archives and commits are pinned in their book TOMLs and `sources.lock.json`.

| Book | Source | Pinned revision | Chapters |
|---|---|---|---|
| As I Lay Dying | https://standardebooks.org/ebooks/william-faulkner/as-i-lay-dying | `0e5f8c957484e15eb60da6ff4aefc7aa13ee4660` | 59 |
| Red Harvest | https://standardebooks.org/ebooks/dashiell-hammett/red-harvest | `49eaa501d92df037623fdc9093aec73b24ff7e88` | 27 |
| To the Lighthouse | https://standardebooks.org/ebooks/virginia-woolf/to-the-lighthouse | `e8c69c4ec7580134270a0027a714a0d5473bac4a` | 42 |

Completeness was checked against every bodymatter entry in each edition's EPUB spine, including
the last chapter and its closing words. To the Lighthouse retains all three parts: The Window
(19 chapters), Time Passes (10), and The Lighthouse (13). As I Lay Dying retains every narrator
chapter, including its one-sentence chapter, and Cash's numbered list. Its inline coffin image is
represented by the source's accessible description. Verse line breaks and paragraph order remain.

The book TOMLs record the reviewed chapter counts and final-text anchors; builds fail when those
checks differ. `qa.py` additionally compares every committed chapter against a complete rebuild.
Reproduce the three checks with:

```sh
python3 scripts/catalog/fetch.py ~/.cache/books-gutenberg --check as-i-lay-dying red-harvest to-the-lighthouse
python3 scripts/catalog/qa.py ~/.cache/books-gutenberg as-i-lay-dying red-harvest to-the-lighthouse
```

The corrected texts use narration revision `complete-text-v1`. The earlier As I Lay Dying audio
belongs to the excerpt and must not play against this complete text. Narration must be explicitly
rebuilt for the revision before it becomes available; see [adding books](adding-books.md).
