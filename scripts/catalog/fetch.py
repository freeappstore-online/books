"""Build the catalogue's book texts from Project Gutenberg (books#5).

usage: fetch.py CACHE_DIR [SLUG...]
Downloads each book's plain text into CACHE_DIR (once, ~1 req/s), keeps only the text between
the `*** START/END OF` markers, drops front and back matter, splits on the book's own headings
and writes web/public/catalog/<slug>.json = {"chapters": [{"title", "content"}]}. Then updates
`chapters` and `readTime` in web/src/data/catalog.ts from the files. No caps: whole books.

Content is what the reader shows and TTS reads verbatim, so headings, licence text, tables of
contents and markup never reach it. Paragraphs are separated by a blank line; prose is unwrapped,
verse keeps its line breaks.
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "web/public/catalog")
CATALOG_TS = os.path.join(ROOT, "web/src/data/catalog.ts")
USER_AGENT = "freeappstore-books/1.0 (+https://github.com/freeappstore-online/books)"
WORDS_PER_MIN = 250

# Not on Project Gutenberg (yet): their current files are kept as they are.
UNSOURCED = {"as-i-lay-dying", "red-harvest", "to-the-lighthouse"}

# slug -> (Gutenberg id, or a tuple of volumes: id or (id, volume options), options). Options:
#   heads: extra heading regex(es) (full stripped line), tried before the generic ones; groups kind,
#          num, rest make the title, a `fold` group marks a sub-heading folded into its chapter
#   heads_only: no generic headings (CHAPTER I, BOOK II, bare numerals...)
#   toc:   also take headings from the book's own contents list
#   start: regex of the line where the text begins (its first match, or match start_n)
#   end:   regex of the line where the text ends, excluded (its last match, or match end_n)
#   drop:  regex of headings whose sections are left out (editorial notes, indexes...)
#   first: title of the text before the first heading (when that heading is lost in markup)
#   sub:   take a title-case line after a bare heading as its subtitle
#   nosub: never take the line after a heading as its subtitle
#   label: what a bare numeral heading is called ("Chapter" by default)
#   titles: {regex: replacement} applied to the final chapter titles
#   level: heading level that makes a chapter (0 book/part/act, 1 chapter/scene, 2 bare numeral)
#   keep:  regex of a heading that looks like back matter but is the author's (an appendix)
#   cut:   [(start regex, end regex)]: remove every run of lines from a start line to the next end line
#   gloss: remove Purves' marginal glosses and note references (Chaucer)
#   strip: regex of whole lines to remove (running heads, part dividers...)
# A text with no headings at all is split at paragraph boundaries into ~20k-char parts.
BOOKS = {
    "alice-in-wonderland": (11, {}),
    "pride-and-prejudice": (1342, {"start": r"It is a truth universally.*", "first": "Chapter 1", "end": r"CHISWICK PRESS.*"}),
    "the-art-of-war": (17405, {}),
    "meditations": (2680, {"start": r"THE FIRST BOOK", "end": r"APPENDIX", "heads": r"THE (?P<num>[A-Z]+) BOOK", "heads_only": True, "label": "Book"}),
    "the-great-gatsby": (64317, {}),
    "romeo-and-juliet": (1513, {}),
    "frankenstein": (84, {}),
    "the-picture-of-dorian-gray": (174, {}),
    "dracula": (345, {}),
    "sherlock-holmes": (1661, {"heads": r"[IVX]+\. (?P<rest>(?:A|THE) [A-Z].*)"}),
    "metamorphosis": (5200, {}),
    "the-prince": (1232, {"start": r"DEDICATION", "start_n": 1, "first": "Dedication", "heads": r"(?P<rest>THE PRINCE)", "end": r"DESCRIPTION OF THE METHODS ADOPTED BY THE DUKE VALENTINO WHEN MURDERING"}),
    "a-tale-of-two-cities": (98, {}),
    "moby-dick": (2701, {"start": r"ETYMOLOGY\.", "start_n": 1, "heads": r"(?P<rest>ETYMOLOGY|EXTRACTS)\.?"}),
    "jane-eyre": (1260, {}),
    "wuthering-heights": (768, {}),
    "crime-and-punishment": (2554, {}),
    "treasure-island": (120, {"titles": {r"Chapter 27: Narrative Continued": "Chapter 17: Narrative Continued"}}),
    "jekyll-and-hyde": (43, {"toc": True}),
    "war-of-the-worlds": (36, {}),
    "the-time-machine": (35, {}),
    "a-christmas-carol": (46, {}),
    "heart-of-darkness": (219, {}),
    "the-call-of-the-wild": (215, {}),
    "walden": (205, {"toc": True}),
    "the-odyssey": (1727, {"start": r"BOOK I"}),
    "the-iliad": (2199, {}),
    "don-quixote": ((
        (996, {"end": r"DEDICATION OF VOLUME II\.", "titles": {r"^Chapter": "Part 1, Chapter"}}),
        (996, {"start": r"DEDICATION OF VOLUME II\.",
               "titles": {r"^Chapter": "Part 2, Chapter", r"^The Author’s Preface$": "The Author’s Preface to Part 2"}}),
    ), {"drop": r"Introduction.*", "heads": r"(?P<rest>THE AUTHOR’S PREFACE|SOME COMMENDATORY VERSES|DEDICATION OF (?:PART I|VOLUME II))\.?"}),
    "les-miserables": (135, {}),
    "the-count-of-monte-cristo": (1184, {}),
    "the-jungle-book": (236, {"toc": True}),
    "the-republic": (1497, {"start": r"BOOK I\.", "start_n": 1}),
    "a-study-in-scarlet": (244, {}),
    "the-hound-of-the-baskervilles": (2852, {}),
    "the-invisible-man": (5230, {}),
    "around-the-world-in-80-days": (103, {}),
    "twenty-thousand-leagues": (2488, {"sub": True, "drop": r"Introduction.*", "end": r"END OF THE SECOND PART"}),
    "great-expectations": (1400, {}),
    "david-copperfield": (766, {}),
    "the-adventures-of-tom-sawyer": (74, {}),
    "adventures-of-huckleberry-finn": (76, {"start": r"CHAPTER I\.", "start_n": 1}),
    "little-women": (514, {}),
    "sense-and-sensibility": (161, {}),
    "emma": (158, {}),
    "the-scarlet-letter": (33, {"heads": r"(?P<rest>THE CUSTOM-HOUSE|THE SCARLET LETTER)", "level": 2}),
    "thus-spoke-zarathustra": (1998, {"start": r"FIRST PART\. ZARATHUSTRA’S DISCOURSES\.", "end": r"APPENDIX\.?", "heads": [r"(?P<rest>ZARATHUSTRA’S PROLOGUE)\.", r"(?P<num>[LXVI]+)\. (?P<rest>[A-Z][^a-z]+)"], "strip": r"THUS SPAKE ZARATHUSTRA\. \w+ PART\.|(?:SECOND|THIRD|FOURTH AND LAST) PART\.|ZARATHUSTRA’S DISCOURSES\."}),
    "anna-karenina": (1399, {}),
    "the-secret-garden": (113, {}),
    "the-brothers-karamazov": (28054, {}),
    "bleak-house": (1023, {}),
    "northanger-abbey": (121, {"end": r"A NOTE ON THE TEXT"}),
    "persuasion": (105, {}),
    "mansfield-park": (141, {}),
    "a-room-with-a-view": (2641, {}),
    "the-age-of-innocence": (541, {"end": r"A Note on the Text"}),
    "uncle-toms-cabin": (203, {}),
    "the-scarlet-pimpernel": (60, {}),
    "oliver-twist": (730, {}),
    "gulliver-travels": (829, {}),
    "the-phantom-of-the-opera": (175, {}),
    "peter-pan": (16, {}),
    "the-wonderful-wizard-of-oz": (55, {}),
    "the-three-musketeers": (1257, {}),
    "the-importance-of-being-earnest": (844, {}),
    "middlemarch": (145, {"start": r"PRELUDE\.", "start_n": 1}),
    "tess-of-the-durbervilles": (110, {}),
    "robinson-crusoe": (521, {}),
    "ivanhoe": (82, {"end": r"NOTE TO CHAPTER I\.", "end_n": 1}),
    "anne-of-green-gables": (45, {}),
    "ethan-frome": (4517, {"start": r"I had the story, bit by bit, from various people, and, as generally", "first": "Prologue"}),
    "the-awakening": (160, {"end": r"BEYOND THE BAYOU", "end_n": 1}),
    "dead-souls": (1081, {"drop": r"Introduction.*"}),
    "sons-and-lovers": (217, {}),
    "the-man-who-was-thursday": (1695, {}),
    "silas-marner": (550, {}),
    "candide": (19942, {"start": r"CANDIDE", "start_n": 1, "end": r"\+-{10,}\+", "end_n": -2}),
    "a-portrait-of-the-artist": (4217, {}),
    "the-turn-of-the-screw": (209, {"heads": r"(?P<rest>THE TURN OF THE SCREW)", "titles": {r"^The Turn of the Screw$": "Prologue"}}),
    "notes-from-underground": (600, {}),
    "the-jungle": (140, {}),
    "hamlet": (1524, {}),
    "a-midsummer-nights-dream": (1514, {}),
    "a-dolls-house": (2542, {}),
    "pygmalion": (3825, {}),
    "narrative-of-frederick-douglass": (23, {"keep": r"APPENDIX", "heads": r"(?P<rest>APPENDIX|LETTER FROM WENDELL PHILLIPS, ESQ\.)"}),
    "leviathan": (3207, {"start": r"THE INTRODUCTION"}),
    "the-enchanted-april": (16389, {}),
    "the-blue-castle": (67979, {}),
    "the-king-in-yellow": (8492, {"toc": True, "heads": r"(?P<rest>IN THE COURT OF THE DRAGON)"}),
    "twenty-years-after": (1259, {}),
    "a-connecticut-yankee": (86, {"heads": r"(?P<rest>A WORD OF EXPLANATION|THE STRANGER.S HISTORY)", "strip": r"MARK TWAIN|A CONNECTICUT YANKEE IN KING ARTHUR.S COURT|THE TALE OF THE LOST LAND"}),
    "cranford": (394, {"end": r"PRINTED BY"}),
    "jude-the-obscure": (153, {"start": r"PREFACE", "start_n": 1, "heads": r"(?P<kind>Part) (?P<num>First|Second|Third|Fourth|Fifth|Sixth)\s+(?P<rest>.*)"}),
    "twelfth-night": (1526, {}),
    "leaves-of-grass": (1322, {"heads": r"(?P<kind>BOOK) ?(?P<num>[IVXL]+)\.?(?:\s+(?P<rest>.*))?", "heads_only": True}),
    "mrs-dalloway": (71865, {"start": r"Mrs\. Dalloway said she would buy the flowers.*"}),
    "the-sun-also-rises": (67138, {}),
    "a-farewell-to-arms": (75201, {}),
    "the-sound-and-the-fury": (75170, {"heads": r"(?P<rest>(?:APRIL|JUNE) [A-Z]+, 19\d\d)\.?"}),
    "manhattan-transfer": (71853, {"heads": r"(?P<num>First|Second|Third) (?P<kind>Section)"}),
    "lady-chatterleys-lover": (73144, {}),
    "the-maltese-falcon": (77600, {"heads": r"(?P<num>\d{1,2})"}),
    "bambi": (72577, {}),
    "cane": (60093, {"toc": True}),
    "north-of-boston": (3026, {"toc": True}),
    "the-red-house-mystery": (1872, {}),
    "autobiography-of-benjamin-franklin": (148, {"start": r"Twyford, at the Bishop of St\. Asaph.s,.*", "end": r"CHIEF EVENTS IN FRANKLIN.S LIFE\.?"}),
    "far-from-the-madding-crowd": (107, {}),
    "grimms-fairy-tales": (2591, {"toc": True, "end": r"\*{5}"}),
    "the-merchant-of-venice": (1515, {}),
    "the-prince-and-the-pauper": (1837, {"end": r"FOOTNOTES AND TWAIN’S NOTES"}),
    "the-wind-in-the-willows": (289, {}),
    "ulysses": (4300, {"heads": r"\[ (?P<num>\d+) \]", "heads_only": True, "label": "Episode", "strip": r"— [IVX]+ —", "nosub": True}),
    "all-quiet-on-the-western-front": (75011, {"end": r"CHISWICK PRESS.*"}),
    "the-canterbury-tales": (2383, {"start": r"THE PROLOGUE\.", "first": "The General Prologue", "end": r"THE END OF THE CANTERBURY TALES", "gloss": True, "cut": [(r"Notes to .*", r"(?:THE|CHAUCER’S) [A-ZŒ’ ]*TALE.*|\*?PRECES DE CHAUCERES.*")], "heads": r"(?P<fold>THE (?:PROLOGUE|TALE))\.? *|(?P<rest>(?:THE|CHAUCER’S) [A-ZŒ’ ]*TALE(?: OF [A-ZŒ ]+)?|PRECES DE CHAUCERES)\.? *", "heads_only": True}),
    "aesops-fables": (21, {"start": r"The Lion And The Mouse", "start_n": 1, "end": r"FOOTNOTES"}),
    "short-fiction-poe": ((2147, 2148, 2150), {"toc": True, "heads": r"(?P<rest>THE UNPARALLELED ADVENTURES OF ONE HANS PFAAL) ?", "drop": r"Preface|Life of Poe|Death of Poe|Death of Edgar A\. Poe"}),
    "poetry-poe": (10031, {"start": r"POEMS OF LATER LIFE", "end": r"ESSAYS\.", "cut": [(r"NOTES\.", r"POEMS OF MANHOOD\.|SCENES FROM \"POLITIAN\.\"|POEMS OF YOUTH|DOUBTFUL POEMS\.|PROSE POEMS\.")], "heads": r"(?P<fold>(?:PART )?[IVX]+\.?)|(?P<rest>[A-Z][A-Z0-9 ,\x27\"’()—.!?;:-]{2,})", "heads_only": True, "drop": r"Note on Politian", "titles": {r"^An Unpublished Drama.*": "Scenes from Politian", r"^Letter to Mr\. B.*": "Letter to Mr. B——", r"[,.]$": ""}}),
    "hemingway-short-fiction": ((
        (59603, {"start": r"UP IN MICHIGAN", "start_n": 1, "end": r"MITRAIGLIATRICE",  # the stories, not the poems
                 "heads": r"(?P<rest>UP IN MICHIGAN|OUT OF SEASON|MY OLD MAN)", "heads_only": True}),
        (61085, {"heads": r"chapter (?P<num>\d+)", "titles": {r"^Chapter": "In Our Time, Chapter"}}),
        (69683, {"toc": True}),
    ), {}),
    "a-passage-to-india": (61221, {"end": r"Weybridge, 1924\."}),
    "howards-end": (2891, {}),
    "winesburg-ohio": (416, {"start": r"THE BOOK OF THE GROTESQUE", "start_n": 1, "heads": r"(?P<rest>[A-Z“\"][A-Z “”\"’,.-]{2,})", "heads_only": True, "titles": {r"^Part (One|Two|Three|Four)$": r"Godliness, Part \1"}}),
    "my-antonia": (242, {}),
    "the-house-of-mirth": (284, {}),
    "the-secret-agent": (974, {}),
    "lord-jim": (5658, {}),
    "sister-carrie": (233, {}),
    "main-street": (543, {}),
    "babbitt": (1156, {}),
    "madame-bovary": (2413, {}),
    "the-idiot": (2638, {}),
    "germinal": (56528, {}),
    "north-and-south": (4276, {}),
    "villette": (9182, {}),
    "shirley": (30486, {}),
    "the-mayor-of-casterbridge": (143, {}),
    "the-woodlanders": (482, {}),
    "the-return-of-the-native": (122, {}),
    "lorna-doone": (840, {}),
    "the-portrait-of-a-lady": ((2833, 2834), {}),
    "the-ambassadors": (432, {}),
    "washington-square": (2870, {}),
    "the-house-of-the-seven-gables": (77, {}),
    "jacobs-room": (5670, {}),
    "the-voyage-out": (144, {}),
    "night-and-day": (1245, {}),
    "arrowsmith": (70875, {}),
    "martin-eden": (1056, {}),
    "the-old-curiosity-shop": (700, {}),
    "the-mystery-of-edwin-drood": (564, {}),
    "kidnapped": (421, {}),
    "king-solomons-mines": (2166, {}),
    "she": (3155, {}),
    "the-prisoner-of-zenda": (95, {}),
    "scaramouche": (1947, {}),
    "captain-blood": (1965, {}),
    "the-last-of-the-mohicans": (940, {}),
    "the-sea-wolf": (1074, {}),
    "white-fang": (910, {}),
    "a-princess-of-mars": (62, {}),
    "the-thirty-nine-steps": (558, {}),
    "the-mysterious-island": (1268, {}),
    "the-lost-world": (139, {}),
    "the-island-of-doctor-moreau": (159, {}),
    "the-red-badge-of-courage": (73, {}),
    "three-men-in-a-boat": (308, {}),
    "the-sign-of-the-four": (2097, {}),
    "the-valley-of-fear": (3289, {}),
    "the-memoirs-of-sherlock-holmes": (834, {}),
    "the-mystery-of-the-yellow-room": (1685, {}),
    "arsene-lupin-gentleman-burglar": (6133, {}),
    "lady-audleys-secret": (8954, {}),
    "anne-of-avonlea": (47, {}),
    "the-railway-children": (1874, {}),
    "pinocchio": (500, {}),
    "macbeth": (1533, {}),
    "as-you-like-it": (1523, {}),
    "up-from-slavery": (2376, {}),
    "incidents-in-the-life-of-a-slave-girl": (11030, {}),
    "the-problems-of-philosophy": (5827, {}),
    "second-treatise-of-government": (7370, {}),
    "confessions-of-st-augustine": (3296, {}),
    "beyond-good-and-evil": (4363, {}),
    "evelina": (6053, {}),
    "nicholas-nickleby": (967, {}),
    "our-mutual-friend": (883, {}),
    "barnaby-rudge": (917, {}),
    "dombey-and-son": (821, {}),
    "the-trial": (7849, {}),
    "heidi": (1448, {}),
    "notre-dame-de-paris": (2610, {}),
    "demons": (8117, {}),
    "the-rainbow": (28948, {}),
    "women-in-love": (4240, {}),
    "this-side-of-paradise": (805, {}),
    "the-beautiful-and-damned": (9830, {}),
    "the-mysteries-of-udolpho": (3268, {}),
    "the-monk": (601, {}),
    "kim": (2226, {}),
    "from-the-earth-to-the-moon": (83, {}),
}


# ── Download ──

def download(cache: str, gid: int) -> str:
    path = os.path.join(cache, f"pg{gid}.txt")
    if not os.path.exists(path):
        url = f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        data = urllib.request.urlopen(req, timeout=120).read()
        with open(path, "wb") as f:
            f.write(data)
        time.sleep(1)
    with open(path, encoding="utf-8-sig") as f:
        return f.read()


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
    return text


def is_verse(lines: list[str]) -> bool:
    """A block is verse (keep its line breaks) when its lines start with capitals, as verse lines
    do and wrapped prose lines don't, or when they mostly stop short of the wrap width and only
    rarely start in lowercase."""
    if len(lines) < 2:
        return False
    lower = sum(1 for l in lines[1:] if l.strip()[:1].islower()) / (len(lines) - 1)
    if lower == 0 and len(lines) >= 3:
        return True
    short = sum(1 for l in lines[:-1] if len(l.strip()) < 55) / (len(lines) - 1)
    return short > 0.5 and lower < 0.2


def unwrap(block: str) -> str:
    lines = [l.rstrip() for l in block.split("\n") if l.strip()]
    indent = min(len(l) - len(l.lstrip()) for l in lines)
    joined = []
    for l in lines:  # a long verse line's wrapped tail is indented further and starts in lowercase
        if joined and len(l) - len(l.lstrip()) >= indent + 3 and l.strip()[:1].islower():
            joined[-1] += " " + l.strip()
        else:
            joined.append(l)
    lines = joined
    if is_verse(lines):
        return "\n".join(re.sub(r"\s+", " ", l.strip()) for l in lines)
    return re.sub(r"\s+", " ", " ".join(l.strip() for l in lines)).strip()


def blocks_to_content(blocks: list[str]) -> str:
    paras = [unwrap(b) for b in blocks]
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


def split_book(body: str, opts: dict) -> list[dict]:
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
        return split_long([{"title": "", "content": blocks_to_content(pre)}]) if pre else []
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
    out = [{"title": c["title"], "content": blocks_to_content(c["blocks"])} for c in chapters]
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

def read_time(words: int) -> str:
    minutes = words / WORDS_PER_MIN
    if minutes < 60:
        return f"{max(15, round(minutes / 15) * 15)}min"
    h, m = divmod(round(minutes / 15) * 15, 60)
    return f"{h}h {m}min" if m else f"{h}h"


def update_catalog_ts():
    src = open(CATALOG_TS, encoding="utf-8").read()

    def fix(m):  # one entry, from its id to its contentPath (entries are multi- or single-line)
        chapters = json.load(open(os.path.join(OUT_DIR, f"{m[1]}.json"), encoding="utf-8"))["chapters"]
        words = sum(len(c["content"].split()) for c in chapters)
        entry = re.sub(r"chapters: \d+,", f"chapters: {len(chapters)},", m[0])
        return re.sub(r"readTime: '[^']*',", f"readTime: '{read_time(words)}',", entry)

    src, n = re.subn(r"id: '([^']+)',[\s\S]*?contentPath", fix, src)
    assert n == len(BOOKS) + len(UNSOURCED), n
    open(CATALOG_TS, "w", encoding="utf-8").write(src)


def volumes(slug: str) -> list[tuple[int, dict]]:
    """(Gutenberg id, options) per volume; a volume may add its own options to the book's."""
    ids, opts = BOOKS[slug]
    return [(v, opts) if isinstance(v, int) else (v[0], {**opts, **v[1]})
            for v in (ids if isinstance(ids, tuple) else (ids,))]


def build(cache: str, slug: str) -> list[dict]:
    chapters = []
    for gid, opts in volumes(slug):
        chapters += split_book(gutenberg_body(download(cache, gid)), opts)
    return chapters


def main():
    cache, *slugs = sys.argv[1:]
    os.makedirs(cache, exist_ok=True)
    for slug in slugs or BOOKS:
        chapters = build(cache, slug)
        with open(os.path.join(OUT_DIR, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump({"chapters": chapters}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{slug}: {len(chapters)} chapters, {sum(len(c['content']) for c in chapters):,} chars", flush=True)
    update_catalog_ts()


if __name__ == "__main__":
    main()
