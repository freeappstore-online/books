"""Build the catalogue's book texts from Project Gutenberg (books#5).

usage: fetch.py CACHE_DIR [--check | --relock] [SLUG...]
Downloads each book's plain text into CACHE_DIR (once, ~1 req/s), keeps only the text between
the `*** START/END OF` markers, drops front and back matter, splits on the book's own headings
and writes web/public/catalog/<slug>.json = {"chapters": [{"title", "content"}]}. Then rewrites
web/src/data/books.json, the list the app shows, with each book's chapter count and reading time.
No caps: whole books.

Each book's source and split options are its [source] in catalog/books/<slug>.toml (books.py);
what each option does is documented in catalog/README.md.

Builds are reproducible (books#38): sources.lock.json pins the SHA-256 of every Gutenberg file a
book is built from, so a file Gutenberg re-releases stops the build instead of silently changing a
book (and misaligning its narration, which is keyed by chapter index). --relock accepts the new
files after you have reviewed the result. --check rebuilds the books in memory and compares them
with the committed web/public/catalog/<slug>.json, writing nothing; it exits 1 on any difference,
so a hand edit of a catalogue file or a change to this script that re-splits a book is caught.

Content is what the reader shows and TTS reads verbatim, so headings, licence text, tables of
contents and markup never reach it, nor the title page a volume repeats between chapters.
Paragraphs are separated by a blank line; prose is unwrapped, verse keeps its line breaks.
"""
import hashlib, json, os, re, sys, time, urllib.request
from concurrent.futures import ProcessPoolExecutor

from books import CATALOG, ROOT, read_time, source, write_app_data  # noqa: F401 (read_time: qa, tests)

OUT_DIR = os.path.join(ROOT, "web/public/catalog")
LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources.lock.json")
USER_AGENT = "freeappstore-books/1.0 (+https://github.com/freeappstore-online/books)"

# slug -> (Gutenberg id, or a tuple of volumes (id, options), split options), from catalog/books/*.toml
BOOKS = {slug: src for slug, book in CATALOG.items() if (src := source(book))}
# Not on Project Gutenberg: their committed files are kept as they are.
UNSOURCED = {slug for slug, book in CATALOG.items() if source(book) is None}


# ── Download ──

class Lock:
    """sources.lock.json: Gutenberg id -> SHA-256 of the file its book was built from."""

    def __init__(self, mode: str = "verify"):  # verify | record (add new ids) | relock (accept changes)
        self.mode = mode
        self.hashes = {}
        if os.path.exists(LOCK_PATH):
            with open(LOCK_PATH) as f:
                self.hashes = json.load(f)
        self.dirty = False

    def check(self, gid: int, data: bytes):
        digest, known = hashlib.sha256(data).hexdigest(), self.hashes.get(str(gid))
        if known == digest:
            return
        if known is None and self.mode in ("record", "relock") or self.mode == "relock":
            self.hashes[str(gid)] = digest
            self.dirty = True
            return
        what = "is not in sources.lock.json" if known is None else "differs from the one in sources.lock.json"
        raise SystemExit(f"pg{gid}.txt {what}: Gutenberg may have re-released it. Rebuild the book, review "
                         f"the result (and its narration, which is keyed by chapter), then run with --relock.")

    def save(self):
        if self.dirty:
            with open(LOCK_PATH, "w") as f:
                json.dump(dict(sorted(self.hashes.items(), key=lambda kv: int(kv[0]))), f, indent=0)
                f.write("\n")


LOCK = Lock()


def download(cache: str, gid: int) -> str:
    path = os.path.join(cache, f"pg{gid}.txt")
    if not os.path.exists(path):
        url = f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        for attempt in range(5):  # Gutenberg drops connections under load; back off and retry
            try:
                data = urllib.request.urlopen(req, timeout=120).read()
                break
            except OSError as e:  # URLError, RemoteDisconnected, timeouts
                if attempt == 4:
                    raise SystemExit(f"pg{gid}.txt: download failed after 5 attempts: {e}")
                time.sleep(5 * 2 ** attempt)
        with open(path, "wb") as f:
            f.write(data)
        time.sleep(1)
    with open(path, "rb") as f:
        data = f.read()
    LOCK.check(gid, data)
    return data.decode("utf-8-sig")


def gutenberg_title(raw: str) -> str:
    """The book's title from the header ("Title: Rob Roy — Complete" -> "Rob Roy"), or ""."""
    m = re.search(r"^Title:\s*(.+)$", raw, re.M)
    return re.split(r"\s+—\s+|[:;]", m[1])[0].strip() if m else ""


def gutenberg_body(raw: str) -> str:
    """The text between the *** START OF / *** END OF markers."""
    raw = raw.replace("\r", "").replace("\ufeff", "")
    start = re.search(r"^\*\*\* ?START OF.*$", raw, re.M)
    end = re.search(r"^\*\*\* ?END OF.*$", raw, re.M)
    return raw[start.end() if start else 0: end.start() if end else len(raw)]


# ── Cleaning ──

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
         "nineteen", "twenty"]
ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
            "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth",
            "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"]
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90}
TENS_ORD = {"twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50, "sixtieth": 60}


def number(tok: str) -> int | None:
    """'XIV' / '14' / 'fourteen' / 'Fourteenth' / 'twenty-one' -> 14, 21; else None."""
    t = tok.strip(".:").replace("—", "-")
    if t.isdigit():
        return int(t)
    if re.fullmatch(r"[IVXLCDM]+", t):
        n = 0
        for a, b in zip(t, t[1:] + " "):
            v = ROMAN[a]
            n += -v if b != " " and ROMAN[b] > v else v
        return n
    t = t.lower()
    for table in (WORDS, ORDINALS):
        if t in table:
            return table.index(t)
    m = re.fullmatch(r"(\w+)[- ](\w+)", t)
    if m and m[1] in TENS:
        unit = m[2]
        for table in (WORDS, ORDINALS):
            if unit in table and 0 < table.index(unit) < 10:
                return TENS[m[1]] + table.index(unit)
    return TENS.get(t) or TENS_ORD.get(t)


SMALL = {"a", "an", "the", "and", "but", "or", "nor", "of", "in", "on", "at", "to", "by", "for",
         "with", "from", "as", "into", "upon", "de", "la", "le", "du", "von", "van"}


def titlecase(s: str) -> str:
    """Title case for ALL-CAPS headings; anything already mixed-case is left alone."""
    if any(c.islower() for c in s):
        return s
    out = []
    for i, w in enumerate(re.split(r"(?<=—)|\s", s)):
        lw = w.lower()
        if i and lw in SMALL:
            out.append(lw)
        elif re.fullmatch(r"[IVXLC]+[.,:]?", w) and w not in ("I", "LIVE"):
            out.append(w)  # roman numerals stay
        else:
            out.append("-".join(p[:1].upper() + p[1:] for p in lw.split("-")) if lw else lw)
            out[-1] = re.sub(r"^([\"“‘'(\[])(\w)", lambda m: m[1] + m[2].upper(), out[-1])
    return re.sub(r"— ", "—", " ".join(out))


def clean_inline(text: str) -> str:
    """Markup removal on the raw text (bepub's cleanContent rules, plus footnote markers)."""
    text = re.sub(r"\[_?Copyright[^\]]*\]", "", text)
    text = re.sub(r"\[Illustration[^\]]*\]", "", text, flags=re.S)
    text = re.sub(r"\[(?:Footnote|Sidenote|Transcriber|Note)[^\]]*\]", "", text, flags=re.S | re.I)
    text = re.sub(r"\^\{[^}]*\}", "", text)
    text = re.sub(r"\^(\w)", r"\1", text)
    text = re.sub(r"\{[^}]{1,60}\}", "", text)
    text = re.sub(r"(?m)^[ \t]*\*Transcriber[’']?s? [Nn]otes?\b.*(?:\n(?![ \t]*\n).*)*", "", text)
    text = re.sub(r"(?m)^[ \t]*(?:\(\*\d+\)|\[\d{1,3}\]).*(?:\n(?![ \t]*\n).*)*", "", text)  # footnote paragraphs
    text = re.sub(r"\[\d{1,3}\]|\[[a-z]\]|\(\*\d+\)", "", text)  # footnote markers
    text = text.replace("_", "")
    text = re.sub(r"/\* ?(?:NIND ?)?| ?\*/", "", text)  # /* NIND ... */ letter markup
    text = re.sub(r"(?m)^[ \t]*(?:\*[ \t]*){2,}$", "", text)  # * * * dividers
    text = re.sub(r"(?m)^[ \t]*[-=~·.]{3,}[ \t]*$", "", text)
    text = re.sub(r"(?m)^[ \t]*(?:ACT DROP|CURTAIN\.?)[ \t]*$", "", text)
    text = re.sub(r"(?mi)^[ \t]*end of (?:the )?(?:first|second|third|fourth|fifth|\w+) (?:volume|part|book)\.?[ \t]*$", "", text)
    text = re.sub(r"\(Mem\.,?[^)]*\)|\(Kept in [^)]*\)", "", text)
    text = re.sub(r"(?m)^.*\.(?:jpg|jpeg|png|gif) \(\d+K\)\s*$|^\s*Full Size\s*$", "", text)
    text = re.sub(r"(?m)^[ \t]*\d{4,5}m[ \t]*$", "", text)  # illustration ids like 0107m (books#37)
    return text


def is_verse(lines: list[str], verse: bool = False) -> bool:
    """A block is verse (keep its line breaks) when its lines start with capitals, as verse lines
    do and wrapped prose lines don't, or when they mostly stop short of the wrap width and only
    rarely start in lowercase."""
    if len(lines) < 2:
        return False
    lower = sum(1 for l in lines[1:] if l.strip()[:1].islower()) / (len(lines) - 1)
    # prose wrapped at capitals ("replied the / Scarecrow;"): lines filled to the wrap width, some
    # breaking mid-phrase; verse lines end in punctuation or run past the width (Whitman)
    body = [l.strip() for l in lines[:-1]]
    wrapped = not verse and all(60 <= len(l) <= 80 for l in body) and any(re.search(r"\w$", l) for l in body)
    if lower == 0 and len(lines) >= 3 and not wrapped:
        return True
    short = sum(1 for l in lines[:-1] if len(l.strip()) < 55) / (len(lines) - 1)
    return short > 0.5 and lower < 0.2


def unwrap(block: str, verse: bool = False) -> str:
    lines = [l.rstrip() for l in block.split("\n") if l.strip()]
    indent = min(len(l) - len(l.lstrip()) for l in lines)
    joined = []
    for l in lines:  # a long verse line's wrapped tail is indented further and starts in lowercase
        if joined and len(l) - len(l.lstrip()) >= indent + 3 and l.strip()[:1].islower():
            joined[-1] += " " + l.strip()
        else:
            joined.append(l)
    lines = joined
    if is_verse(lines, verse):
        return "\n".join(re.sub(r"\s+", " ", l.strip()) for l in lines)
    return re.sub(r"\s+", " ", " ".join(l.strip() for l in lines)).strip()


def blocks_to_content(blocks: list[str], verse: bool = False) -> str:
    paras = [unwrap(b, verse) for b in blocks]
    # section numbers ("1.", "II") between paragraphs are headings, not text
    return "\n\n".join(p for p in paras if re.search(r"\w", p) and not re.fullmatch(r"[IVXLC\d]+\.?", p))


# ── Headings ──

KIND = r"(?:CHAPTER|Chapter|BOOK|Book|PART|Part|VOLUME|Volume|STAVE|Stave|LETTER|Letter|ACT|Act|SCENE|Scene|CANTO|Canto|ADVENTURE|EPISODE|Episode|SECTION|Section)"
NUMTOK = r"(?:[IVXLCDM]+|\d+|[A-Za-z]+(?:[- ][A-Za-z]+)?)"
SEP = r"(?:\s*[.:—–-]\s*|\s+)"
SPECIAL = r"(?:THE\s+)?(?:PROLOGUE|EPILOGUE|Prologue|Epilogue|CONCLUSION|Conclusion|PREFACE|Preface|INTRODUCTION|Introduction|AFTERWORD|POSTSCRIPT|FINALE|Finale|PRELUDE|Prelude)"
GENERIC = [  # (level, regex): 0 = book/part/act, 1 = chapter/scene, 2 = bare numeral
    (None, rf"(?P<kind>{KIND})\.?\s+(?:THE\s+|the\s+)?(?P<num>{NUMTOK})\b\.?(?:{SEP}(?P<rest>.*))?"),
    (0, r"(?:THE\s+)?(?P<num>FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+(?P<kind>PART|BOOK|ACT)\.?(?:" + SEP + r"(?P<rest>.*))?"),
    (2, rf"(?P<num>[IVX]|[IVXLC]{{2,}})\.?(?:{SEP}(?P<rest>[A-Z“‘\"'].*))?"),
    (1, rf"(?P<kind>{SPECIAL})\.?(?:{SEP}(?P<rest>.*))?"),
]
MAJOR = {"book", "part", "volume", "act"}
FOLD = 9  # a sub-heading whose text stays in the chapter it is in
BACK_MATTER = r"(?i:footnotes?:?|notes:?|notes to the \w+ volume|endnotes|index|glossary|transcriber.*|appendix.*|the end\.?|finis\.?)"
EDITORIAL = r".*\b(?:[Tt]ranslator|[Ee]ditor|[Tt]ranscriber)\b.*|(?:Introduction|Preface|Foreword).*\b[Bb]y [A-Z].*"


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def toc_entries(lines: list[str]) -> dict[str, str]:
    """Entries of the first contents list (normalised -> as printed): the short lines after a
    'Contents' line, until a wider gap between lines than between its first two entries."""
    for i, l in enumerate(lines):
        if re.fullmatch(r"\s*(?:Table of )?CONTENTS?[.:]?", l, re.I):
            out, blank, gap = [], 0, None
            for l2 in lines[i + 1:]:
                if not l2.strip():
                    blank += 1
                    continue
                if out and gap is None:
                    gap = blank
                if len(l2.strip()) > 80 or (gap is not None and blank > gap + 1):
                    break
                blank = 0
                entry = re.sub(r"\s{2,}(?:\d+|[ivxlc]+)$", "", l2.strip())
                if out and norm(entry) == norm(out[0]):
                    break  # the text itself has begun
                out.append(entry)
            return {norm(e): e for e in out if norm(e) and norm(e) != "page"}
    return {}


def match_heading(line: str, opts: dict, toc: dict[str, str]):
    """-> (level, kind, number, rest) for a heading line, or None."""
    s = line.strip()
    if not s or len(s) > 110 or re.search(r"\s{2,}\d+$|\.{4,}", s):
        return None  # contents entries end in page numbers
    heads = opts.get("heads", [])
    for m in (re.fullmatch(hp, s) for hp in ([heads] if isinstance(heads, str) else heads)):
        if m:
            g = m.groupdict()
            if g.get("fold"):
                return (FOLD, "", None, g["fold"])
            kind = (g.get("kind") or "").strip()
            rest = g["rest"] if "rest" in g else (None if "num" in g else s)
            return (0 if kind.lower() in MAJOR | {"section"} else 1, kind, g.get("num"), (rest or "").strip())
    if norm(s) in toc and (s == toc[norm(s)] or not re.search(r"[a-z]", s)):
        return (1, "", None, s)
    if opts.get("heads_only"):
        return None
    for level, pat in GENERIC:
        m = re.fullmatch(pat, s)
        if not m:
            continue
        g = m.groupdict()
        kind = g.get("kind") or ""
        num = g.get("num")
        if num is not None and number(num) is None and num.upper() != "LAST":
            continue
        rest = (g.get("rest") or "").strip()
        if kind and num and not kind.isupper() and rest and rest[0].islower():
            continue  # "Chapter one of the story..." is prose
        if rest and (len(rest) > 90 or rest.endswith((",", ";"))):
            continue
        if not kind and rest and any(w[0].islower() and w.lower() not in SMALL for w in rest.split()):
            continue  # "I TEACH YOU THE SUPERMAN. Man is something..." is prose
        if level is None:
            level = 0 if kind.lower() in MAJOR else 1
        return (level, kind, num, rest)
    return None


def heading_title(h, opts: dict) -> str:
    level, kind, num, rest = h
    rest = titlecase(rest.strip(" .:—–-")) if rest else ""
    if num is None:
        name = titlecase(re.sub(r"^(?:THE|The)\s+", "", kind)) if kind else ""
    elif num.upper() == "LAST":
        name = f"{titlecase(kind)} the Last"
    else:
        name = f"{(titlecase(kind) if kind else opts.get('label', 'Chapter'))} {number(num)}"
    if name and rest:
        return f"{name}: {rest}"
    return name or rest


# ── Splitting ──

def is_prose(block: str) -> bool:
    lines = block.split("\n")
    return len(block) >= 200 and not is_verse(lines)


BYLINE = r"[Bb]y (?:[A-Z][\w.’'-]*\s?){1,5}"


def strip_title_pages(chapters: list[list[str]], title: str) -> list[list[str]]:
    """Each chapter's blocks without the book's title page left at its end ("WAVERLEY" / "OR" /
    "’TIS SIXTY YEARS SINCE", "The Wonderful Wizard of Oz", "ROB ROY" / "By Sir Walter Scott"), nor
    the byline left at the start of the chapter after one, or of the first (books#37). Only the
    blocks from the one naming the book onwards go, so a signature like "HENRY JAMES" stays, and
    a quoted line is speech, not a title ("‘Little Dorrit.’")."""
    key = norm(title)

    def title_like(block):
        s = block.strip()
        return len(s) <= 100 and "\n" not in s and not re.search(r"^[‘“\"']|[.!?][’”\"')]*$", s) \
            and (norm(s) == key or s.isupper() or bool(re.fullmatch(BYLINE, s)))

    out, cut = [], True
    for blocks in chapters:
        while cut and blocks and re.fullmatch(BYLINE, blocks[0].strip()):
            blocks = blocks[1:]
        n = len(blocks)
        while n and title_like(blocks[n - 1]):
            n -= 1
        named = [k for k in range(n, len(blocks)) if key and key in norm(blocks[k])]
        cut = bool(named)
        out.append(blocks[:named[0]] if named else blocks)
    return out


def split_book(body: str, opts: dict, book_title: str = "") -> list[dict]:
    lines = body.split("\n")
    toc = toc_entries(clean_inline(body).split("\n")) if opts.get("toc") else {}
    if opts.get("start"):
        idx = [i for i, l in enumerate(lines) if re.fullmatch(opts["start"], l.strip())]
        if not idx:
            raise SystemExit(f"start not found: {opts['start']}")
        lines = lines[idx[opts.get("start_n", 0)]:]
        if opts.get("first") and len(lines[0].strip()) <= 40 and not re.search(r"[a-z]", lines[0]):
            lines = lines[1:]  # the start line is the heading "first" replaces
    if opts.get("end"):
        idx = [i for i, l in enumerate(lines) if re.fullmatch(opts["end"], l.strip())]
        if not idx:
            raise SystemExit(f"end not found: {opts['end']}")
        lines = lines[: idx[opts.get("end_n", -1)]]
    for cut_start, cut_end in opts.get("cut", []):
        out, cutting = [], False
        for l in lines:
            if cutting and re.fullmatch(cut_end, l.strip()):
                cutting = False
            elif not cutting and re.fullmatch(cut_start, l.strip()):
                cutting = True
            if not cutting:
                out.append(l)
        lines = out
    text = "\n".join(lines)
    if opts.get("gloss"):  # Purves' Chaucer: glosses in the right margin, *starred* words, <n> notes
        text = re.sub(r"(?m)[ \t]{3,}\*[^\n]*$", "", text)
        text = re.sub(r"(?m)^[ \t]{25,}\S[^\n]*$", "", text)
        text = re.sub(r"<\w{1,3}>", "", text).replace("*", "")
        text = re.sub(r"\[[^\]\n]{1,80}\]", "", text)
    text = clean_inline(text)
    if opts.get("strip"):
        text = re.sub(rf"(?m)^[ \t]*(?:{opts['strip']})[ \t]*$", "", text)
    lines = text.split("\n")

    # blocks: runs of non-blank lines
    blocks, cur = [], []
    for l in lines + [""]:
        if l.strip():
            cur.append(l)
        elif cur:
            blocks.append(cur)
            cur = []

    # sections: a heading block starts one; its title may take a subtitle from the rest of the
    # block or from the next short block
    sections = [[1, opts["first"], [], True]] if opts.get("first") else []  # [level, title, blocks, named]
    pre = []
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if len(b) >= 2 and re.fullmatch(KIND, b[0].strip()):
            b = [f"{b[0].strip()} {b[1].strip()}"] + b[2:]  # "CHAPTER" / "1" on two lines
        if len(b) <= 2 and re.fullmatch(BACK_MATTER, b[0].strip()) and i > len(blocks) * 0.8 \
                and not re.fullmatch(opts.get("keep", "$^"), b[0].strip()):
            break  # back matter: everything after is dropped
        h = match_heading(b[0], opts, toc) if len(b) <= 4 and sum(len(x) for x in b) < 240 else None
        if len(b) == 1 and re.fullmatch(r"(?:TABLE OF )?CONTENTS?[.:]?|Contents[.:]?", b[0].strip()):
            i += 1  # a contents list: skip it and the entry blocks that follow
            while i < len(blocks) and all(len(x.strip()) <= 80 for x in blocks[i]) \
                    and (len(blocks[i]) > 1 or not match_heading(blocks[i][0], opts, toc)) \
                    and not any(is_prose("\n".join(x)) for x in blocks[i:i + 2]):
                i += 1
            continue
        if h is None:
            (sections[-1][2] if sections else pre).append("\n".join(b))
            i += 1
            continue
        level, kind, num, rest = h
        extra = [x.strip() for x in b[1:]]
        if num is None and not extra and norm(b[0]) not in toc and i + 1 < len(blocks) and len(blocks[i + 1]) == 1:
            nxt = blocks[i + 1][0].strip()  # "THE CUSTOM-HOUSE" / "INTRODUCTORY TO ..."
            if re.sub(r"[^A-Za-z]", "", nxt).isupper() and len(nxt) <= 100 and not match_heading(nxt, opts, toc):
                rest = f"{titlecase(rest)}: {titlecase(nxt)}" if rest else nxt
                i += 1
        if not rest and extra:
            rest = " ".join(extra)
        elif not rest and i + 1 < len(blocks) and len(blocks[i + 1]) <= 2 and not opts.get("nosub"):
            nxt = " ".join(x.strip() for x in blocks[i + 1])
            letters = re.sub(r"[^A-Za-z]", "", nxt)
            upper = letters and letters.isupper() and len(nxt) <= 160 and nxt not in ("I", "A", "O", "SCENE")
            titled = opts.get("sub") and len(nxt) <= 80 and not nxt.endswith((",", ";"))
            if (upper or titled) and not match_heading(blocks[i + 1][0], opts, toc) \
                    and not match_heading(nxt, opts, toc):
                rest = nxt
                i += 1
        sections.append([level, heading_title((level, kind, num, rest), opts), [], num is None])
        i += 1

    # front matter: drop everything before the first section that holds prose (or a scene's
    # worth of short blocks), keeping the empty parent headings right above it
    def listing(block):  # a contents list: most lines are numbered or headings
        ls = block.split("\n")
        return sum(bool(re.match(rf"\s*(?:{KIND}\b|[IVXLC]+\.|\d+\.)", l)) for l in ls) > len(ls) * 0.3

    def has_text(blks):  # prose, a poem, or a scene's worth of speeches
        return (any(is_prose(x) or (len(x) >= 400 and not listing(x)) for x in blks)
                or (len(blks) >= 8 and sum(map(len, blks)) >= 40 * len(blks)))

    first = next((k for k, s in enumerate(sections) if has_text(s[2])), None)
    if first is None:
        return split_long([{"title": "", "content": blocks_to_content(pre, opts.get("verse", False))}]) if pre else []
    # (with at most a line or two under them: a contents list there is front matter)
    while first > 0 and sections[first - 1][0] < sections[first][0] \
            and all(x.count("\n") < 3 for x in sections[first - 1][2]) and not has_text(sections[first - 1][2]):
        first -= 1
    sections = sections[first:]
    drop = opts.get("drop", EDITORIAL)
    kept, dropping = [], False
    for sec in sections:  # a dropped section takes its folded sub-sections with it
        if sec[0] != FOLD:
            dropping = bool(drop and re.fullmatch(drop, sec[1]))
        if not dropping:
            kept.append(sec)
    sections = kept

    # chapter level: the numbered headings below book/part level; finer headings (section
    # numerals inside chapters) are folded into their chapter, coarser ones become parents
    # named headings (Preface, Epilogue, story titles...) are always chapters of their own
    counts = {}
    for s in sections:
        if 0 < s[0] < FOLD and not re.match(SPECIAL, s[1], re.I):
            counts[s[0]] = counts.get(s[0], 0) + 1
    chapter_level = opts.get("level", min((l for l, n in counts.items() if n >= 2), default=0))
    chapters, parent, carry = [], None, []
    for k, (lvl, title, blks, named) in enumerate(sections):
        if named and not has_text(blks) and k + 1 < len(sections) and not sections[k + 1][3] \
                and sections[k + 1][0] == chapter_level:
            parent, carry = title, carry + blks  # "EPILOGUE" over its own Chapter 1, 2...
            continue
        if lvl == FOLD or (named and chapters and title == chapters[-1]["title"]):
            chapters[-1]["blocks"] += blks  # a story's title repeated over its last part
            continue
        if named:
            lvl = chapter_level
        if lvl > chapter_level and chapters:
            chapters[-1]["blocks"] += blks
            continue
        if lvl < chapter_level:
            parent = title
            if any(is_prose(x) for x in blks) and sum(len(x) for x in blks) >= 300:
                chapters.append({"title": title, "blocks": blks, "parent": None})
            else:
                carry += blks
            continue
        chapters.append({"title": title, "blocks": carry + blks, "parent": None if named else parent})
        carry = []
    titles = [c["title"].split(":")[0] for c in chapters if c["parent"]]
    if len(set(titles)) < len(titles):  # numbering restarts in each part
        for c in chapters:
            if c["parent"]:
                c["title"] = f"{c['parent'].split(':')[0]}, {c['title']}"
    texts = strip_title_pages([c["blocks"] for c in chapters], book_title)
    out = [{"title": c["title"], "content": blocks_to_content(b, opts.get("verse", False))}
           for c, b in zip(chapters, texts)]
    out = [c for c in out if c["content"]]
    merged = []
    for c in out:  # a few lines (a short poem, an epigraph) join the chapter before
        if merged and len(c["content"]) < 300:
            merged[-1]["content"] += f"\n\n{c['title']}\n\n{c['content']}" if c["title"] else f"\n\n{c['content']}"
        else:
            merged.append(c)
    out = merged
    for pat, repl in opts.get("titles", {}).items():
        for c in out:
            c["title"] = re.sub(pat, repl, c["title"])
    seen = {}
    for c in out:  # two poems both called "To Helen"
        seen[c["title"]] = seen.get(c["title"], 0) + 1
        if seen[c["title"]] > 1:
            c["title"] += f" ({seen[c['title']]})"
    if len(out) == 1 and len(out[0]["content"]) > 60000:
        return split_long(out)
    return out


def split_long(chapters: list[dict], target: int = 20000) -> list[dict]:
    """One undivided text -> parts of ~target chars at paragraph boundaries."""
    text = "\n\n".join(c["content"] for c in chapters)
    paras, parts, cur = text.split("\n\n"), [], ""
    for p in paras:
        if cur and len(cur) + len(p) > target:
            parts.append(cur)
            cur = ""
        cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        if parts and len(cur) < target / 3:
            parts[-1] += "\n\n" + cur
        else:
            parts.append(cur)
    return [{"title": f"Part {i + 1}", "content": c} for i, c in enumerate(parts)]


# ── Catalogue metadata ──

def volumes(slug: str) -> list[tuple[int, dict]]:
    """(Gutenberg id, options) per volume; a volume may add its own options to the book's."""
    ids, opts = BOOKS[slug]
    return [(v, opts) if isinstance(v, int) else (v[0], {**opts, **v[1]})
            for v in (ids if isinstance(ids, tuple) else (ids,))]


def build(cache: str, slug: str) -> list[dict]:
    chapters = []
    for gid, opts in volumes(slug):
        raw = download(cache, gid)
        chapters += split_book(gutenberg_body(raw), opts, gutenberg_title(raw))
    return chapters


def differences(built: list[dict], committed: list[dict]) -> list[str]:
    """How a rebuilt book differs from its committed file, chapter by chapter (at most a few lines)."""
    out = []
    if len(built) != len(committed):
        out.append(f"{len(committed)} chapters committed, {len(built)} built")
    for i, (b, c) in enumerate(zip(built, committed)):
        if b["title"] != c["title"]:
            out.append(f"chapter {i} title: {c['title']!r} committed, {b['title']!r} built")
        if b["content"] != c["content"]:
            k = next((k for k, (x, y) in enumerate(zip(b["content"], c["content"])) if x != y),
                     min(len(b["content"]), len(c["content"])))
            out.append(f"chapter {i} text from char {k}: {c['content'][max(0, k - 30):k + 30]!r} committed, "
                       f"{b['content'][max(0, k - 30):k + 30]!r} built")
    return out[:6]


def main():
    args = sys.argv[1:]
    check, relock = "--check" in args, "--relock" in args
    cache, *slugs = [a for a in args if a not in ("--check", "--relock")]
    unknown = [s for s in slugs if s not in BOOKS]
    if unknown:
        raise SystemExit(f"no catalog/books/<slug>.toml with a Gutenberg source: {' '.join(unknown)}")
    LOCK.mode = "verify" if check else "relock" if relock else "record"
    os.makedirs(cache, exist_ok=True)
    slugs = slugs or list(BOOKS)
    for slug in slugs:  # downloads one at a time (Gutenberg's rate limit), checking the lock
        for gid, _ in volumes(slug):
            download(cache, gid)
    LOCK.save()  # the build workers read the lock afresh
    changed = []
    with ProcessPoolExecutor() as pool:
        built = pool.map(build, [cache] * len(slugs), slugs)
    for slug, chapters in zip(slugs, built):
        if check:
            committed = json.load(open(os.path.join(OUT_DIR, f"{slug}.json"), encoding="utf-8"))["chapters"]
            diff = differences(chapters, committed)
            if diff:
                changed.append(slug)
                print(f"{slug}: DIFFERS\n" + "".join(f"    {d}\n" for d in diff), end="", flush=True)
            continue
        with open(os.path.join(OUT_DIR, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump({"chapters": chapters}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{slug}: {len(chapters)} chapters, {sum(len(c['content']) for c in chapters):,} chars", flush=True)
    if check:
        n = len(slugs)
        print(f"{n - len(changed)} of {n} books match their committed files" + (f"; differ: {' '.join(changed)}" if changed else ""))
        sys.exit(1 if changed else 0)
    write_app_data()


if __name__ == "__main__":
    main()
