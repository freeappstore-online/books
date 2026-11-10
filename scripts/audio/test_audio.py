"""Tests of the pure parts of the narration scripts, against the real catalogue (books#27).

usage: python scripts/audio/test_audio.py   (needs requirements.txt installed; no network)
"""
import json, os, sys, unittest
from manifest import build, check_slugs, merge
from segments import sentences, utf16

CATALOG = os.path.join(os.path.dirname(__file__), "../../web/public/catalog")
ALICE = "alice-in-wonderland"


class Manifest(unittest.TestCase):
    def test_slugs_are_required_and_must_exist(self):
        with self.assertRaises(SystemExit):
            check_slugs(CATALOG, [])
        with self.assertRaises(SystemExit):
            check_slugs(CATALOG, [ALICE, "no-such-book"])
        check_slugs(CATALOG, [ALICE])

    def test_build_only_the_named_books_in_the_voice(self):
        seconds = {f"af_heart/{ALICE}/0.m4a": 655.159, f"af_heart/{ALICE}/2.m4a": 557.8,
                   "af_heart/dracula/0.m4a": 900.0, f"bf_emma/{ALICE}/0.m4a": 700.0}
        books = build(CATALOG, "af_heart", seconds, [ALICE])
        self.assertEqual(list(books), [ALICE])
        self.assertEqual(len(books[ALICE]), 12)
        self.assertEqual(books[ALICE][:3], [655.2, None, 557.8])

    def test_merge_keeps_other_entries_and_never_adds_other_books(self):
        manifest = {"af_heart": {ALICE: [1.0] * 12, "dracula": [2.0]}, "bf_emma": {ALICE: [3.0]}}
        out = merge(manifest, "af_heart", {ALICE: [5.0] * 12}, [ALICE])
        self.assertEqual(out, {"af_heart": {ALICE: [5.0] * 12, "dracula": [2.0]}, "bf_emma": {ALICE: [3.0]}})
        self.assertEqual(manifest["af_heart"][ALICE], [1.0] * 12)  # input untouched
        # A named book with no audio drops out; an empty voice disappears
        self.assertEqual(merge({"af_heart": {ALICE: [1.0]}}, "af_heart", {}, [ALICE]), {})


class Segments(unittest.TestCase):
    def test_every_catalogue_chapter_splits_into_ordered_sentences(self):
        for name in sorted(os.listdir(CATALOG)):
            for i, ch in enumerate(json.load(open(os.path.join(CATALOG, name)))["chapters"]):
                content = ch["content"]
                if not content.strip():
                    continue
                spans = sentences(content)
                with self.subTest(book=name, chapter=i):
                    self.assertTrue(spans)
                    self.assertTrue(all(s < e for s, e, _ in spans))
                    self.assertTrue(all(a[1] <= b[0] for a, b in zip(spans, spans[1:])))
                    self.assertTrue(spans[-1][2])
                    self.assertEqual(len(utf16(content)), len(content) + 1)

    def test_dialogue_stays_one_sentence(self):
        text = "“Oh dear!” said the Rabbit. Mr. Smith left.\n\nNext."
        self.assertEqual([text[s:e] for s, e, _ in sentences(text)],
                         ["“Oh dear!” said the Rabbit.", "Mr. Smith left.", "Next."])


if __name__ == "__main__":
    sys.exit(unittest.main())
