"""Split a chapter into the sentences that are narrated one at a time (books#18, books#22).

A sentence ends at . ! ? or … (with any closing quotes or brackets) followed by whitespace and
not by a lowercase word, so `“Oh dear!” said the Rabbit` stays one piece. Blank lines end
paragraphs. Offsets are Python string indices; utf16() converts them to JavaScript ones.
"""
import re

PARAGRAPH = re.compile(r"\S.*?(?=\s*\n\s*\n|\s*$)", re.S)
END = re.compile(r"[.!?…]+[”’\"')\]]*(?=\s+(?![a-z]))")
ABBREVIATION = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Rev|Capt|Col|Gen|Lt|Mt)$")


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
