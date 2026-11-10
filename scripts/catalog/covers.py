"""Self-host each catalogue book's Project Gutenberg cover (books#8).

usage: covers.py CACHE_DIR [SLUG...]
For each book in fetch.py's BOOKS (its first volume's id) downloads the cover into CACHE_DIR
(once, sequentially, a pause between requests): the full-size scan `images/cover.jpg` when the
ebook has one, else Gutenberg's `pg<id>.cover.medium.jpg` (200 px). Writes
web/public/covers/<slug>.webp (WIDTH px wide at most) and web/src/data/covers.ts, the list of
books that have a cover. Needs Pillow.
"""
import io, os, sys, time, urllib.error, urllib.parse, urllib.request

from PIL import Image

from fetch import BOOKS, ROOT, USER_AGENT, volumes

OUT_DIR = os.path.join(ROOT, "web/public/covers")
COVERS_TS = os.path.join(ROOT, "web/src/data/covers.ts")
WIDTH = 384  # 2x the largest cover on screen (BookCover lg, 192 CSS px)
QUALITY = 60  # no visible difference from 72 on the most detailed cover (Pride and Prejudice), 15% smaller

# Covers reviewed by eye on a contact sheet and left out (the gradient is shown instead): slug -> reason.
GENERATED = "Gutenberg's generated placeholder (title over abstract shapes, 'Project Gutenberg' label)"
SKIP = {
    "apology": GENERATED,
    "barnaby-rudge": GENERATED,
    "civil-disobedience": GENERATED,
    "father-goriot": GENERATED,
    "hedda-gabler": GENERATED,
    "hemingway-short-fiction": "first volume's cover, 'Three Stories & Ten Poems', not this collection",
    "jacobs-room": GENERATED,
    "les-miserables": "a marbled board with no title on it",
    "north-of-boston": GENERATED,
    "our-mutual-friend": GENERATED,
    "scaramouche": GENERATED,
    "symposium": GENERATED,
    "the-aeneid": GENERATED,
    "the-analects": GENERATED,
    "the-canterbury-tales": GENERATED,
    "the-old-curiosity-shop": GENERATED,
    "the-problems-of-philosophy": GENERATED,
    "the-sorrows-of-young-werther": GENERATED,
    "the-trial": GENERATED,
    "utopia": GENERATED,
}


# Covers taken from Wikimedia Commons instead (books#30), for books whose Gutenberg cover is in SKIP or
# missing: slug -> (Commons file name, crop). Only public-domain files; each was checked by eye to be the
# book's own cover or title page. crop is None or (left, top, right, bottom) as fractions of the image.
COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/"
SOURCES = {
    "a-little-princess": ('A_Little_Princess_cover.jpg', None),
    "agnes-grey": ('Agnes_Grey.jpg', None),
    "as-i-lay-dying": ('As_I_Lay_Dying_(1930_1st_ed_jacket_cover).jpg', None),
    "candide": ('Candide1759.jpg', None),
    "captain-blood": ('1922-captainblood-cover.jpg', None),
    "captains-courageous": ('Rudyard_Kipling_-_Captains_Courageous,_first_US_Edition_(1897).jpg', None),
    "dombey-and-son": ('Dombeyson_serial_cover.jpg', None),
    "evelina": ('Evelina_title_page.jpg', None),
    "hard-times": ('Hardtimes_serial_cover.jpg', None),
    "heidi": ('Spyri_Heidi_Cover_1887.jpg', None),
    "howards-end": ('Howards-End_1st-ed_cvr.jpg', None),
    "just-so-stories": ('Just_So_Stories_Kipling_1902.jpg', None),
    "lady-audleys-secret": ('Lady_Audleys_Secret_Cover.jpg', None),
    "lord-jim": ('LordJimCover.jpg', None),
    "lorna-doone": ('Lorna_Doone_by_RD_Blackmore,_first_edition_title_page_1869.png', None),
    "main-street": ('MainStreetNovel.jpg', None),
    "mansfield-park": ('MansfieldParkTitlePage.jpg', None),
    "my-antonia": ('My_antonia.jpg', None),
    "night-and-day": ('Night_and_Day_(Virginia_Woolf).JPG', None),
    "pinocchio": ('Pinocchio.jpg', None),
    "red-harvest": ('Red_Harvest_(1st_ed_cover).jpg', None),
    "robinson-crusoe": ('Robinson_Crusoe_1719_1st_edition.jpg', (0.5, 0, 1, 1)),
    "she": ('SHE,_A_History_of_Adventure_(1st_Edition_Cover),_by_H._Rider_Haggard.jpg', None),
    "shirley": ('Shirley_a_tale_-_Page_n8.jpg', None),
    "tess-of-the-durbervilles": ("Hardy_-_Tess_d'Urbervilles,_1891_-_3657925F.jpg", None),
    "the-age-of-innocence": ('Age_of_Innocence_(1st_ed_dust_jacket).jpg', None),
    "the-awakening": ('The_Awakening_(Chopin_novel)_cover.jpg', None),
    "the-communist-manifesto": ('Communist-manifesto.png', None),
    "the-great-god-pan": ('The_Great_God_Pan_Title_Page.jpg', None),
    "the-house-of-the-seven-gables": ('The_House_of_the_Seven_Gables.jpg', None),
    "the-lost-world": ('Lost_world.jpg', None),
    "the-mysterious-island": ('Ile_Mysterieuse_02.jpg', None),
    "the-portrait-of-a-lady": ('The_Portrait_of_a_lady_cover.jpg', None),
    "the-railway-children": ('Nesbit-railway001.gif', None),
    "the-scarlet-pimpernel": ('Thescarletpimpernel1908.jpg', None),
    "the-secret-agent": ('SecretAgent.jpg', None),
    "the-tenant-of-wildfell-hall": ('The_Tenant_of_Wildfell_Hall.jpg', None),
    "the-voyage-out": ('The_Voyage_Out.jpg', None),
    "the-woodlanders": ('The_Woodlanders.jpg', None),
    "villette": ('Villette-Page_n8.jpg', None),
    "winesburg-ohio": ('Winesburg,_Ohio_1st.jpg', None),
    "women-in-love": ('Women_in_Love_(first_edition).jpg', None),
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


def download_commons(cache: str, slug: str) -> bytes:
    name, _ = SOURCES[slug]
    path = os.path.join(cache, f"commons-{slug}.jpg")
    if not os.path.exists(path):
        # ?width= asks Commons for a raster thumbnail, which also covers PDF/DjVu pages and SVGs.
        data = get(COMMONS + urllib.parse.quote(name) + f"?width={WIDTH * 2}")
        with open(path, "wb") as f:
            f.write(data)
    return open(path, "rb").read()


def convert(data: bytes, out: str, crop=None):
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if crop:
        img = img.crop(tuple(round(c * s) for c, s in zip(crop, (img.width, img.height) * 2)))
    if img.width > WIDTH:
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    img.save(out, "WEBP", quality=QUALITY, method=6)


def main():
    cache, *slugs = sys.argv[1:]
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    for slug in slugs or BOOKS:
        out = os.path.join(OUT_DIR, f"{slug}.webp")
        if slug in SOURCES:
            data = download_commons(cache, slug)
        else:
            data = None if slug in SKIP else download(cache, volumes(slug)[0][0])
        if data is None:
            if os.path.exists(out):
                os.remove(out)
            print(f"{slug}: no cover ({SKIP.get(slug, 'none on Gutenberg')})", flush=True)
            continue
        convert(data, out, SOURCES.get(slug, (None, None))[1])
        print(f"{slug}: {os.path.getsize(out) // 1024} KB", flush=True)
    have = sorted(f[:-5] for f in os.listdir(OUT_DIR) if f.endswith(".webp"))
    with open(COVERS_TS, "w", encoding="utf-8") as f:
        f.write("// Generated by scripts/catalog/covers.py: books with a cover in public/covers/<id>.webp.\n")
        f.write("export const COVERS = new Set([\n" + "".join(f"  '{s}',\n" for s in have) + "])\n")


if __name__ == "__main__":
    main()
