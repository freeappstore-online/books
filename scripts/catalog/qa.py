"""Check complete catalogue texts against their reproducible sources (books#5).

usage: qa.py CACHE_DIR [SLUG...]
Per book: exact source rebuild, completeness anchors, source/body retention for Gutenberg,
chapter sizes and flags for anything that should not be in the text. Exits 1 on any failure.
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books import CATALOG  # noqa: E402
from fetch import BOOKS, OUT_DIR, UNSOURCED, build, differences, download, gutenberg_body, volumes  # noqa: E402

# Books that knowingly keep less than 90% of their Gutenberg body, and why.
SHORT_OK = {
    "the-republic": "Jowett's 'Introduction and Analysis' is left out",
    "walden": "'On the Duty of Civil Disobedience' is left out",
    "the-awakening": "the selected short stories are left out",
    "meditations": "the translator's introduction, appendix, notes and glossary are left out",
    "thus-spoke-zarathustra": "Elisabeth Förster-Nietzsche's introduction and Ludovici's notes are left out",
    "the-prince": "Marriott's introduction and the two shorter works printed with it are left out",
    "the-odyssey": "Butler's prefaces and footnotes are left out",
    "aesops-fables": "Townsend's preface and the 'Life of Aesop' are left out",
    "poetry-poe": "Ingram's memoir and notes and Poe's essays are left out",
    "the-canterbury-tales": "only the Tales from Purves' 'Canterbury Tales and Other Poems', without his glosses and notes",
    "rob-roy": "Scott's 1829 introduction and its appendix, Lang's editor's introduction, the postscript and notes are left out",
    "symposium": "Jowett's introduction is left out",
    "apology": "Jowett's introduction is left out",
    "faust": "Bayard Taylor's preface and his German dedication to Goethe are left out",
    "hedda-gabler": "William Archer's introduction and the list of characters are left out",
    "doctor-faustus": "the editor's footnotes are left out",
    "on-liberty": "W. L. Courtney's introduction and the footnotes are left out",
    "the-enchiridion": "Albert Salomon's introduction, the bibliography and the footnotes are left out",
    "waverley": "Scott's prefaces and introduction, Lang's editor's introduction, the notes and the glossaries are left out",
    "life-on-the-mississippi": "Twain's four appendices of extracts from other writers are left out",
}
LEFTOVER = [
    ("gutenberg", r"Project Gutenberg|gutenberg\.(?:org|net)|\bPG\b"),
    ("ebook", r"\be-?book\b|\betext\b"),
    ("licence", r"Literary Archive Foundation|Gutenberg-tm|electronic works?\b|public domain in the"),
    ("illustration", r"\[Illustration|\[Footnote|\[Sidenote|\.(?:jpg|png)\b"),
    ("contents", r"(?m)^(?:TABLE OF )?CONTENTS\.?$|^Contents\.?$"),
    ("markup", r"\b_[A-Za-z]|[A-Za-z]_\b|\^\{|\{[^}]{0,30}\}|=[A-Z][a-z]+="),
    ("transcriber", r"[Tt]ranscriber|(?m:^Produced by)|[Pp]roofreading [Tt]eam"),
]


def check_chapters(chapters: list[dict], source: dict | None = None) -> list[str]:
    """Structural checks, with reviewed completeness anchors where the source supplies them.

    A short chapter or a repeated narrator's name is legitimate literary content. Neither is
    proof of truncation; compare with the reproducible source instead of exempting whole books.
    """
    flags = []
    if not chapters:
        return ["no chapters"]
    if any(not c.get("title", "").strip() for c in chapters):
        flags.append("empty title")
    if any(not c.get("content", "").strip() for c in chapters):
        flags.append("empty chapter content")
    source = source or {}
    if "expected_chapters" in source and len(chapters) != source["expected_chapters"]:
        flags.append(f"expected {source['expected_chapters']} chapters, found {len(chapters)}")
    if "ending" in source and not chapters[-1]["content"].rstrip().endswith(source["ending"]):
        flags.append("last chapter does not end with the reviewed source ending")
    return flags


def report(cache: str, slug: str) -> list[str]:
    with open(os.path.join(OUT_DIR, f"{slug}.json"), encoding="utf-8") as f:
        data = json.load(f)
    chapters = data["chapters"]
    out_chars = sum(len(c["content"]) for c in chapters)
    sizes = [len(c["content"]) for c in chapters]
    flags = check_chapters(chapters, CATALOG[slug]["source"])
    if data.get("narrationRevision") != CATALOG[slug].get("narration_revision"):
        flags.append("narrationRevision does not match the book's narration_revision; rebuild the text")
    pct = None
    if slug in BOOKS:
        # An exact rebuild catches even a one-character cutoff, which a 90% size threshold cannot.
        flags.extend(f"source mismatch: {d}" for d in differences(build(cache, slug), chapters))
    else:
        flags.append("no reproducible full-text source; completeness cannot be verified")
    if "gutenberg" in CATALOG[slug]["source"] or "volumes" in CATALOG[slug]["source"]:
        body = "".join(gutenberg_body(download(cache, g)) for g in dict.fromkeys(g for g, _ in volumes(slug)))
        # compare on non-space characters: unwrapping and markup removal change whitespace
        src = len(re.sub(r"\s|_|\[Illustration[^\]]*\]", "", body))
        dst = len(re.sub(r"\s", "", "".join(c["content"] + c["title"] for c in chapters)))
        pct = 100 * dst / src
        if pct < 90 and slug not in SHORT_OK:
            flags.append(f"retained {pct:.0f}%")
        if pct > 101:
            flags.append(f"grew {pct:.0f}%")
    text = "\n".join(c["content"] for c in chapters)
    for name, pat in LEFTOVER:
        m = re.search(pat, text, re.I if name == "ebook" else 0)
        if m:
            flags.append(f"{name}: …{text[max(0, m.start() - 40): m.end() + 40]!r}…")
    status = "UNSOURCED" if slug in UNSOURCED else "SOURCE" if pct is None else f"{pct:5.1f}%"
    print(f"{slug:36} {status:>9} {out_chars:>9,} chars {len(chapters):4} ch "
          f"min {min(sizes, default=0):>7,} max {max(sizes, default=0):>7,}" + ("".join(f"\n    ! {f}" for f in flags)))
    return flags


def check_books(cache: str, slugs: list[str]) -> list[str]:
    """Report every failure, including missing sources, rather than stop at the first book."""
    bad = []
    for slug in slugs:
        try:
            flags = report(cache, slug)
        except (OSError, ValueError, KeyError, TypeError, SystemExit) as err:
            print(f"{slug:36}\n    ! source/check failed: {err}")
            flags = [str(err)]
        if flags:
            bad.append(slug)
    return bad


def main():
    cache, *slugs = sys.argv[1:]
    slugs = slugs or sorted(set(BOOKS) | UNSOURCED)
    bad = check_books(cache, slugs)
    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    biggest = max(os.listdir(OUT_DIR), key=lambda f: os.path.getsize(os.path.join(OUT_DIR, f)))
    print(f"\n{len(slugs)} books, {len(bad)} flagged; catalogue {total / 1e6:.1f} MB, "
          f"largest {biggest} {os.path.getsize(os.path.join(OUT_DIR, biggest)) / 1e6:.1f} MB")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
