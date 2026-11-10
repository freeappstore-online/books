"""Self-host each catalogue book's Project Gutenberg cover (books#8).

usage: covers.py CACHE_DIR [SLUG...]
For each book in fetch.py's BOOKS (its first volume's id) downloads the cover into CACHE_DIR
(once, sequentially, a pause between requests): the full-size scan `images/cover.jpg` when the
ebook has one, else Gutenberg's `pg<id>.cover.medium.jpg` (200 px). Writes
web/public/covers/<slug>.webp (WIDTH px wide at most) and web/src/data/covers.ts, the list of
books that have a cover. Needs Pillow.
"""
import io, os, sys, time, urllib.error, urllib.request

from PIL import Image

from fetch import BOOKS, ROOT, USER_AGENT, volumes

OUT_DIR = os.path.join(ROOT, "web/public/covers")
COVERS_TS = os.path.join(ROOT, "web/src/data/covers.ts")
WIDTH = 384  # 2x the largest cover on screen (BookCover lg, 192 CSS px)
QUALITY = 60  # no visible difference from 72 on the most detailed cover (Pride and Prejudice), 15% smaller

# Covers reviewed by eye on a contact sheet and left out (the gradient is shown instead): slug -> reason.
GENERATED = "Gutenberg's generated placeholder (title over abstract shapes, 'Project Gutenberg' label)"
SKIP = {
    "a-little-princess": GENERATED,
    "agnes-grey": GENERATED,
    "apology": GENERATED,
    "barnaby-rudge": GENERATED,
    "candide": GENERATED,
    "captain-blood": GENERATED,
    "captains-courageous": GENERATED,
    "civil-disobedience": GENERATED,
    "dombey-and-son": GENERATED,
    "evelina": GENERATED,
    "father-goriot": GENERATED,
    "hard-times": GENERATED,
    "hedda-gabler": GENERATED,
    "heidi": GENERATED,
    "hemingway-short-fiction": "first volume's cover, 'Three Stories & Ten Poems', not this collection",
    "howards-end": GENERATED,
    "jacobs-room": GENERATED,
    "just-so-stories": GENERATED,
    "lady-audleys-secret": GENERATED,
    "les-miserables": "a marbled board with no title on it",
    "lord-jim": GENERATED,
    "lorna-doone": GENERATED,
    "main-street": GENERATED,
    "mansfield-park": GENERATED,
    "my-antonia": GENERATED,
    "night-and-day": GENERATED,
    "north-of-boston": GENERATED,
    "our-mutual-friend": GENERATED,
    "pinocchio": GENERATED,
    "robinson-crusoe": GENERATED,
    "scaramouche": GENERATED,
    "she": GENERATED,
    "shirley": GENERATED,
    "symposium": GENERATED,
    "tess-of-the-durbervilles": GENERATED,
    "the-aeneid": GENERATED,
    "the-age-of-innocence": GENERATED,
    "the-analects": GENERATED,
    "the-awakening": GENERATED,
    "the-canterbury-tales": GENERATED,
    "the-communist-manifesto": GENERATED,
    "the-house-of-the-seven-gables": GENERATED,
    "the-lost-world": GENERATED,
    "the-mysterious-island": GENERATED,
    "the-old-curiosity-shop": GENERATED,
    "the-portrait-of-a-lady": GENERATED,
    "the-problems-of-philosophy": GENERATED,
    "the-railway-children": GENERATED,
    "the-scarlet-pimpernel": GENERATED,
    "the-secret-agent": GENERATED,
    "the-sorrows-of-young-werther": GENERATED,
    "the-tenant-of-wildfell-hall": GENERATED,
    "the-trial": GENERATED,
    "the-voyage-out": GENERATED,
    "the-woodlanders": GENERATED,
    "utopia": GENERATED,
    "villette": GENERATED,
    "winesburg-ohio": GENERATED,
    "women-in-love": GENERATED,
}


def get(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        return urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    finally:
        time.sleep(2)


def download(cache: str, gid: int) -> bytes | None:
    """The cover's bytes: full size if the ebook has one, else the medium thumbnail; None if neither."""
    for name, url in ((f"pg{gid}.cover.jpg", f"https://www.gutenberg.org/cache/epub/{gid}/images/cover.jpg"),
                      (f"pg{gid}.cover.medium.jpg", f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.cover.medium.jpg")):
        path, missing = os.path.join(cache, name), os.path.join(cache, name + ".404")
        if os.path.exists(path):
            return open(path, "rb").read()
        if os.path.exists(missing):
            continue
        data = get(url)
        if data is None:
            open(missing, "w").close()
            continue
        with open(path, "wb") as f:
            f.write(data)
        return data
    return None


def convert(data: bytes, out: str):
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if img.width > WIDTH:
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    img.save(out, "WEBP", quality=QUALITY, method=6)


def main():
    cache, *slugs = sys.argv[1:]
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    for slug in slugs or BOOKS:
        out = os.path.join(OUT_DIR, f"{slug}.webp")
        data = None if slug in SKIP else download(cache, volumes(slug)[0][0])
        if data is None:
            if os.path.exists(out):
                os.remove(out)
            print(f"{slug}: no cover ({SKIP.get(slug, 'none on Gutenberg')})", flush=True)
            continue
        convert(data, out)
        print(f"{slug}: {os.path.getsize(out) // 1024} KB", flush=True)
    have = sorted(f[:-5] for f in os.listdir(OUT_DIR) if f.endswith(".webp"))
    with open(COVERS_TS, "w", encoding="utf-8") as f:
        f.write("// Generated by scripts/catalog/covers.py: books with a cover in public/covers/<id>.webp.\n")
        f.write("export const COVERS = new Set([\n" + "".join(f"  '{s}',\n" for s in have) + "])\n")


if __name__ == "__main__":
    main()
