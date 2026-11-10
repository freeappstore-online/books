"""Split a chapter into the sentences that are narrated one at a time (books#18, books#22).

A sentence ends at . ! ? or … (with any closing quotes or brackets) followed by whitespace and
not by a lowercase word, so `“Oh dear!” said the Rabbit` stays one piece, and not after a title
like Mr. or an initial like the L. of `L. Frank Baum` (narrated alone, the initial got a sentence's
pause after it, books#33). Blank lines end paragraphs. Offsets are Python string indices; utf16()
converts them to JavaScript ones. spoken_title() is what a chapter's title clip says (books#37).
"""
import re

PARAGRAPH = re.compile(r"\S.*?(?=\s*\n\s*\n|\s*$)", re.S)
END = re.compile(r"[.!?…]+[”’\"')\]]*(?=\s+(?![a-z]))")
# A capital letter alone is an initial, except the pronoun I ("It was I.")
ABBREVIATION = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Rev|Capt|Col|Gen|Lt|Mt|[A-HJ-Z])$")


def sentences(content: str) -> list[tuple[int, int, bool]]:
    """(start, end, ends_paragraph) of every sentence, in order, trimmed of surrounding space."""
    out = []
    for para in PARAGRAPH.finditer(content):
        start = para.start()
        for m in END.finditer(content, start, para.end()):
            if m.group() == "." and ABBREVIATION.search(content, start, m.start()):
                continue
            out.append((start, m.end(), False))
            start = m.end() + len(content[m.end():para.end()]) - len(content[m.end():para.end()].lstrip())
        if start < para.end():
            out.append((start, para.end(), False))
        out[-1] = (out[-1][0], out[-1][1], True)
    return out


def utf16(content: str) -> list[int]:
    """UTF-16 offset of every Python index into content, plus its end."""
    offsets = [0]
    for ch in content:
        offsets.append(offsets[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offsets


KIND = r"(?:Chapter|Book|Part|Volume|Stave|Letter|Act|Scene|Canto|Adventure|Episode|Section|Epilogue|Fable)"
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
        "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def words(n: int) -> str:
    """12 -> "Twelve", 365 -> "Three Hundred and Sixty-Five" (below 10,000)."""
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + (f"-{ONES[n % 10]}" if n % 10 else "")
    big, unit = (1000, "Thousand") if n >= 1000 else (100, "Hundred")
    rest = n % big
    return f"{words(n // big)} {unit}" + ("" if not rest else f" and {words(rest)}" if rest < 100 else f" {words(rest)}")


def numeral(tok: str) -> int | None:
    """'12' / 'XII' -> 12; anything else None."""
    if tok.isdigit():
        return int(tok)
    if re.fullmatch(r"M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})", tok) and tok:
        return sum(-ROMAN[a] if ROMAN[a] < ROMAN.get(b, 0) else ROMAN[a] for a, b in zip(tok, tok[1:] + " "))
    return None


def spoken_title(title: str) -> str:
    """What a chapter's title clip says: "Chapter 1: The Cyclone" -> "Chapter One. The Cyclone.",
    "Part 1, Chapter IV" -> "Part One, Chapter Four.", "XII" -> "Chapter Twelve.", "" -> "".

    Numbers after a heading word and numbers standing alone are spelled out, so the roman ones
    aren't read as letters or the pronoun I; ALL-CAPS words are lowered so they aren't spelled.
    """
    t = re.sub(r"[\[\]_*]", "", title).strip()
    t = re.sub(r"\s+", " ", t)
    if not t:
        return ""
    if numeral(t.rstrip(".")) is not None:  # a chapter called "XII" or "12"
        t = f"Chapter {t.rstrip('.')}"
    t = re.sub(r"^(\d+|[IVXLC]+)\.\s+(?=\S)", lambda m: f"{m[1]}: ", t)  # "1. How They Went..." -> "1: How..."
    t = re.sub(rf"\b({KIND})\.?\s+(\d+|[IVXLCDM]+)\b\.?(?![’'\w])",
               lambda m: f"{m[1]} {words(numeral(m[2]))}" if numeral(m[2]) is not None else m[0], t, flags=re.I)
    t = re.sub(r"^(\d+|[IVXLC]+)(?=:)", lambda m: words(numeral(m[1])) if numeral(m[1]) else m[0], t)
    t = re.sub(r"\b[A-Z][A-Z’']+\b", lambda m: m[0] if numeral(m[0]) else m[0].capitalize(), t)
    t = re.sub(r"\s*:\s*", ". ", t)
    t = t[:1].upper() + t[1:]
    return t if re.search(r"[.!?…][”’\"')]*$", t) else t + "."
