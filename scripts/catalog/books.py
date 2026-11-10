"""The catalogue's books: one file per book, catalog/books/<slug>.toml (books#38).

A book's file is the only place it is described: what the app shows about it, where its text comes
from and how that text is split ([source]), and where its cover comes from ([cover]). The format is
documented in catalog/README.md. Everything else is derived from these files:

- web/public/catalog/<slug>.json, the text: fetch.py
- web/src/data/books.json, the list the app shows (with each book's chapter count and reading
  time, measured from its text): write_app_data(), which fetch.py calls after a build. After
  editing only a book's metadata, run this module on its own: python3 scripts/catalog/books.py
- web/public/covers/<slug>.webp and web/src/data/covers.ts: covers.py

usage: books.py [--check]   (--check writes nothing and exits 1 if books.json is out of date)
"""
import json, os, sys, tomllib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BOOKS_DIR = os.path.join(ROOT, "catalog/books")
TEXT_DIR = os.path.join(ROOT, "web/public/catalog")
APP_DATA = os.path.join(ROOT, "web/src/data/books.json")
WORDS_PER_MIN = 250

REQUIRED = {"title": str, "author": str, "author_bio": str, "year": int, "genre": str, "tags": list,
            "language": str, "description": str, "excerpt": str, "look": dict, "source": dict}
OPTIONAL = {"cover": dict}
# fetch.py's split options (what each does: catalog/README.md)
SPLIT_OPTIONS = {"heads", "heads_only", "toc", "start", "start_n", "end", "end_n", "drop", "first", "sub",
                 "nosub", "label", "titles", "level", "keep", "cut", "gloss", "strip", "verse"}


def _validate(slug: str, book: dict):
    """A book file is hand-edited, so say exactly what is wrong with one rather than fail later."""
    def bad(msg):
        raise SystemExit(f"catalog/books/{slug}.toml: {msg}")
    for key, kind in {**REQUIRED, **OPTIONAL}.items():
        if key in book and not isinstance(book[key], kind):
            bad(f"{key} must be a {kind.__name__}")
    if missing := [k for k in REQUIRED if k not in book]:
        bad(f"missing {', '.join(missing)}")
    if unknown := set(book) - set(REQUIRED) - set(OPTIONAL):
        bad(f"unknown key(s) {', '.join(sorted(unknown))}")
    if set(book["look"]) != {"gradient", "accent"}:
        bad("[look] needs exactly gradient and accent")
    src = book["source"]
    if sum(k in src for k in ("gutenberg", "volumes", "none")) != 1:
        bad("[source] needs exactly one of gutenberg, volumes (with [[source.volumes]]) or none")
    for opts in [src, *src.get("volumes", [])]:
        if unknown := set(opts) - SPLIT_OPTIONS - {"gutenberg", "volumes", "none"}:
            bad(f"unknown [source] option(s) {', '.join(sorted(unknown))}")
    cover = book.get("cover", {})
    if cover and sum(k in cover for k in ("commons", "none")) != 1 or set(cover) - {"commons", "crop", "none"}:
        bad("[cover] holds either commons (and an optional crop) or none")


def load() -> dict[str, dict]:
    books = {}
    for name in sorted(os.listdir(BOOKS_DIR)):
        if name.endswith(".toml"):
            with open(os.path.join(BOOKS_DIR, name), "rb") as f:
                books[name[:-5]] = book = tomllib.load(f)
            _validate(name[:-5], book)
    return books


CATALOG = load()


def source(book: dict):
    """(Gutenberg id, or a tuple of volumes (id, options), split options) as fetch.py takes them;
    None for a book not on Gutenberg, whose committed text is kept as it is."""
    src = book["source"]
    if "none" in src:
        return None
    opts = {k: v for k, v in src.items() if k not in ("gutenberg", "volumes")}
    if "volumes" in src:
        return tuple((v["gutenberg"], {k: x for k, x in v.items() if k != "gutenberg"}) for v in src["volumes"]), opts
    ids = src["gutenberg"]
    return (tuple(ids) if isinstance(ids, list) else ids), opts


def read_time(words: int) -> str:
    minutes = words / WORDS_PER_MIN
    if minutes < 60:
        return f"{max(15, round(minutes / 15) * 15)}min"
    h, m = divmod(round(minutes / 15) * 15, 60)
    return f"{h}h {m}min" if m else f"{h}h"


def app_data() -> list[dict]:
    """What the app lists (web/src/data/catalog.ts's CatalogBook), from the book files and texts."""
    out = []
    for slug, b in CATALOG.items():
        with open(os.path.join(TEXT_DIR, f"{slug}.json"), encoding="utf-8") as f:
            chapters = json.load(f)["chapters"]
        words = sum(len(c["content"].split()) for c in chapters)
        out.append({"id": slug, "title": b["title"], "author": b["author"], "authorBio": b["author_bio"],
                    "year": b["year"], "genre": b["genre"], "tags": b["tags"], "language": b["language"],
                    "description": b["description"], "excerpt": b["excerpt"], "chapters": len(chapters),
                    "readTime": read_time(words), "coverGradient": b["look"]["gradient"],
                    "coverAccent": b["look"]["accent"], "contentPath": f"/catalog/{slug}.json"})
    return out


def render_app_data() -> str:
    """One book per line, so a change to a book is a one-line diff."""
    return "[\n" + ",\n".join(json.dumps(b, ensure_ascii=False) for b in app_data()) + "\n]\n"


def write_app_data():
    with open(APP_DATA, "w", encoding="utf-8") as f:
        f.write(render_app_data())


if __name__ == "__main__":
    if "--check" in sys.argv[1:]:
        with open(APP_DATA, encoding="utf-8") as f:
            current = f.read()
        if current != render_app_data():
            raise SystemExit("web/src/data/books.json is out of date: run python3 scripts/catalog/books.py")
        print(f"web/src/data/books.json is up to date ({len(CATALOG)} books)")
    else:
        write_app_data()
        print(f"wrote web/src/data/books.json ({len(CATALOG)} books)")
