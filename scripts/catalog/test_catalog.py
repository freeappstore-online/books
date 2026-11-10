"""Tests of the catalogue pipeline: the text helpers, and that the catalogue's parts agree (books#38).

usage: python3 scripts/catalog/test_catalog.py   (needs Pillow for covers.py; no network)
The full regression check, every book rebuilt and compared with its committed file, is
`fetch.py CACHE_DIR --check`; it needs the Gutenberg sources and runs in CI (pipeline.yml).
"""
import json, os, re, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402
from covers import COVERS_TS, OUT_DIR as COVERS_DIR, SKIP, SOURCES  # noqa: E402
from fetch import BOOKS, UNSOURCED, differences, is_verse, number, read_time, split_book, titlecase  # noqa: E402


class Helpers(unittest.TestCase):
    def test_number(self):
        for tok, n in [("XIV", 14), ("14", 14), ("fourteen", 14), ("Fourteenth", 14), ("twenty-one", 21),
                       ("Thirtieth", 30), ("IV.", 4)]:
            self.assertEqual(number(tok), n, tok)
        self.assertIsNone(number("Cat"))

    def test_titlecase(self):
        self.assertEqual(titlecase("THE BOY WHO LIVED"), "The Boy Who Lived")
        self.assertEqual(titlecase("A TALE OF TWO CITIES"), "A Tale of Two Cities")
        self.assertEqual(titlecase("CHAPTER XIV"), "Chapter XIV")
        self.assertEqual(titlecase("Already Mixed case"), "Already Mixed case")

    def test_read_time(self):
        self.assertEqual(read_time(100), "15min")
        self.assertEqual(read_time(250 * 50), "45min")
        self.assertEqual(read_time(250 * 90), "1h 30min")
        self.assertEqual(read_time(250 * 120), "2h")


class Verse(unittest.TestCase):
    SPEECH = ["“But it is not a foolish errand, nor an idle one,” replied the",
              "Scarecrow; “it is important. And we have been told that Oz is a good",
              "Wizard.”"]
    RAVEN = ["But the Raven, sitting lonely on that placid bust, spoke only",
             "That one word, as if his soul in that one word he did outpour.",
             "Nothing further then he uttered--not a feather then he fluttered--"]
    WHITMAN = ["I look I see each result and glory retracing itself and nestling close, always obligated,",
               "Thither hours, months, years--thither trades, compacts, establishments, even the most minute,",
               "Thither every-day life, speech, utensils, politics, persons, estates;"]
    SHORT = ["How doth the little crocodile", "Improve his shining tail,", "And pour the waters of the Nile"]

    def test_prose_wrapped_at_capitals_is_prose(self):
        self.assertFalse(is_verse(self.SPEECH))

    def test_long_rhymed_lines_are_verse_in_a_verse_book(self):
        self.assertFalse(is_verse(self.RAVEN))
        self.assertTrue(is_verse(self.RAVEN, verse=True))

    def test_lines_past_the_wrap_width_are_verse(self):
        self.assertTrue(is_verse(self.WHITMAN))

    def test_short_capitalised_lines_are_verse(self):
        self.assertTrue(is_verse(self.SHORT))


class Split(unittest.TestCase):
    PROSE = ("It was a dark and stormy night; the rain fell in torrents, except at occasional intervals,\n"
             "when it was checked by a violent gust of wind which swept up the streets, rattling along\n"
             "the housetops, and fiercely agitating the scanty flame of the lamps that struggled.\n")
    BOOK = ("Title page\n\nCONTENTS\n\nCHAPTER I. THE STORM\nCHAPTER II. THE CALM\n\n\n"
            f"CHAPTER I. THE STORM\n\n{PROSE}\n{PROSE}\nCHAPTER II. THE CALM\n\n{PROSE}\n{PROSE}")

    def test_chapters_from_headings_without_front_matter(self):
        chapters = split_book(self.BOOK, {})
        self.assertEqual([c["title"] for c in chapters], ["Chapter 1: The Storm", "Chapter 2: The Calm"])
        self.assertTrue(chapters[0]["content"].startswith("It was a dark and stormy night;"))
        self.assertNotIn("\n", chapters[0]["content"].split("\n\n")[0])  # prose is unwrapped

    def test_differences(self):
        a = [{"title": "One", "content": "abc"}]
        self.assertEqual(differences(a, a), [])
        self.assertIn("1 chapters committed, 2 built", differences(a + a, a)[0])
        self.assertIn("title", differences([{"title": "Two", "content": "abc"}], a)[0])


class Lock(unittest.TestCase):
    def test_a_changed_source_stops_the_build(self):
        lock = fetch.Lock("verify")
        lock.hashes = {"1": "0" * 64}
        with self.assertRaises(SystemExit):
            lock.check(1, b"changed")
        with self.assertRaises(SystemExit):
            lock.check(2, b"not locked")
        lock.mode = "record"
        lock.check(2, b"new")
        self.assertIn("2", lock.hashes)
        with self.assertRaises(SystemExit):  # record adds new files, it never accepts a change
            lock.check(1, b"changed")


class Consistency(unittest.TestCase):
    """The catalogue's parts must agree: BOOKS, catalog.ts, the built files, covers and the lock."""

    @classmethod
    def setUpClass(cls):
        src = open(fetch.CATALOG_TS, encoding="utf-8").read()
        cls.ids = re.findall(r"id: '([^']+)',[\s\S]*?contentPath", src)
        cls.lock = json.load(open(fetch.LOCK_PATH))

    def test_catalog_ts_lists_every_book_once(self):
        self.assertEqual(len(self.ids), len(set(self.ids)))
        self.assertEqual(set(self.ids), set(BOOKS) | UNSOURCED)

    def test_every_book_has_its_file(self):
        files = {f[:-5] for f in os.listdir(fetch.OUT_DIR) if f.endswith(".json")}
        self.assertEqual(files, set(self.ids))

    def test_every_source_is_locked(self):
        gids = {str(g) for slug in BOOKS for g, _ in fetch.volumes(slug)}
        self.assertEqual(gids - set(self.lock), set())

    def test_covers_ts_matches_the_cover_files(self):
        files = {f[:-5] for f in os.listdir(COVERS_DIR) if f.endswith(".webp")}
        listed = set(re.findall(r"'([^']+)'", open(COVERS_TS, encoding="utf-8").read()))
        self.assertEqual(listed, files)
        self.assertEqual(files - set(self.ids), set())

    def test_cover_overrides_name_catalogue_books(self):
        self.assertEqual(set(SKIP) - set(self.ids), set())
        self.assertEqual(set(SOURCES) - set(self.ids), set())
        self.assertEqual(set(SKIP) & set(SOURCES), set())


if __name__ == "__main__":
    unittest.main()
