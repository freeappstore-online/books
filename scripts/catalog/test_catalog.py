"""Tests of the catalogue pipeline: the text helpers, and that the catalogue's parts agree (books#38).

usage: python3 scripts/catalog/test_catalog.py   (needs Pillow for covers.py; no network)
The full regression check, every book rebuilt and compared with its committed file, is
`fetch.py CACHE_DIR --check`; it needs the Gutenberg sources and runs in CI (pipeline.yml).
"""
import io, json, os, re, sys, tarfile, unittest
from unittest.mock import mock_open, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402
import books  # noqa: E402
import qa  # noqa: E402
import standardebooks  # noqa: E402
from covers import COVERS_TS, OUT_DIR as COVERS_DIR  # noqa: E402
from fetch import BOOKS, differences, is_verse, number, read_time, split_book, titlecase  # noqa: E402


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


class TitlePages(unittest.TestCase):
    def test_title_page_left_between_chapters_goes(self):
        """books#37: a volume's title page at a chapter's end, and the byline after it, are not text."""
        chapters = [["Text.", "HENRY JAMES", "THE PORTRAIT OF A LADY"], ["By Henry James", "On the morrow."],
                    ["More.", "WAVERLEY", "OR", "’TIS SIXTY YEARS SINCE"]]
        self.assertEqual(fetch.strip_title_pages(chapters, "The Portrait of a Lady"),
                         [["Text.", "HENRY JAMES"], ["On the morrow."], chapters[2]])
        self.assertEqual(fetch.strip_title_pages([chapters[2]], "Waverley"), [["More."]])
        self.assertEqual(fetch.strip_title_pages([["Words.", "The Wonderful Wizard of Oz"]], "The Wonderful Wizard of Oz"),
                         [["Words."]])

    def test_signatures_speech_and_poem_titles_stay(self):
        for blocks, title in [(["All art is quite useless.", "OSCAR WILDE"], "The Picture of Dorian Gray"),
                              (["came as an answer:", "‘Little Dorrit.’"], "Little Dorrit"),
                              (["And his name is", "DAVID COPPERFIELD."], "David Copperfield")]:
            self.assertEqual(fetch.strip_title_pages([blocks], title), [blocks])
        later = [["A poem."], ["By Blue Ontario’s Shore", "A chant."]]
        self.assertEqual(fetch.strip_title_pages(later, "Leaves of Grass"), later)

    def test_gutenberg_title(self):
        self.assertEqual(fetch.gutenberg_title("Title: Rob Roy — Complete\n"), "Rob Roy")
        self.assertEqual(fetch.gutenberg_title("Title: Tess of the d'Urbervilles: A Pure Woman\n"), "Tess of the d'Urbervilles")
        self.assertEqual(fetch.gutenberg_title("no header"), "")


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


class CatalogueQA(unittest.TestCase):
    def test_short_chapters_and_repeated_narrators_are_not_truncation(self):
        chapters = [{"title": "Darl", "content": "We went home."},
                    {"title": "Darl", "content": "My mother is a fish."}]
        self.assertEqual(qa.check_chapters(chapters), [])

    def test_reviewed_chapter_count_and_ending_detect_truncation(self):
        chapters = [{"title": "One", "content": "The end."}]
        self.assertEqual(qa.check_chapters(chapters, {"expected_chapters": 1, "ending": "The end."}), [])
        self.assertIn("expected 2 chapters, found 1", qa.check_chapters(chapters, {"expected_chapters": 2}))
        self.assertIn("reviewed source ending", qa.check_chapters(chapters, {"ending": "Their last words."})[0])

    def test_empty_books_chapters_and_titles_fail(self):
        self.assertEqual(qa.check_chapters([]), ["no chapters"])
        self.assertEqual(qa.check_chapters([{"title": " ", "content": " "}]),
                         ["empty title", "empty chapter content"])

    def test_unsourced_books_are_never_exempted(self):
        with patch.object(qa, "report", return_value=["no reproducible source"]), \
                patch.object(qa, "UNSOURCED", {"excerpt"}):
            self.assertEqual(qa.check_books("unused", ["excerpt"]), ["excerpt"])

    def test_a_plausible_excerpt_without_a_source_fails_completeness(self):
        text = {"chapters": [{"title": "One", "content": "This looks like a complete paragraph."}]}
        with patch.object(qa, "CATALOG", {"excerpt": {"source": {"none": "kept"}}}), \
                patch.object(qa, "BOOKS", {}), patch.object(qa, "UNSOURCED", {"excerpt"}), \
                patch("builtins.open", mock_open(read_data=json.dumps(text))), patch("builtins.print"):
            self.assertTrue(any("no reproducible full-text source" in f for f in qa.report("unused", "excerpt")))

    def test_a_source_failure_is_reported_and_other_books_are_checked(self):
        with patch.object(qa, "report", side_effect=[SystemExit("source hash differs"), []]) as report, \
                patch("builtins.print"):
            self.assertEqual(qa.check_books("unused", ["changed", "good"]), ["changed"])
            self.assertEqual(report.call_count, 2)

    def test_source_comparison_catches_small_cutoffs_below_the_size_threshold(self):
        original = [{"title": "One", "content": "A long chapter. " * 1000 + "The end."}]
        truncated = [{**original[0], "content": original[0]["content"][:-2]}]
        with patch.object(qa, "CATALOG", {"book": {"source": {"standardebooks": "author/book"}}}), \
                patch.object(qa, "BOOKS", {"book": {}}), \
                patch.object(qa, "build", return_value=original), \
                patch("builtins.open", mock_open(read_data=json.dumps({"chapters": truncated}))), \
                patch("builtins.print"):
            self.assertTrue(any("source mismatch" in f for f in qa.report("unused", "book")))

    def test_missing_narration_revision_is_rejected_even_if_chapters_match(self):
        chapters = [{"title": "One", "content": "The end."}]
        book = {"source": {"standardebooks": "author/book"}, "narration_revision": "complete-text-v1"}
        with patch.object(qa, "CATALOG", {"book": book}), \
                patch.object(qa, "BOOKS", {"book": {}}), \
                patch.object(qa, "build", return_value=chapters), \
                patch("builtins.open", mock_open(read_data=json.dumps({"chapters": chapters}))), \
                patch("builtins.print"):
            self.assertTrue(any("narrationRevision" in f for f in qa.report("unused", "book")))


class BookFiles(unittest.TestCase):
    GOOD = {"title": "T", "author": "A", "author_bio": "B", "year": 1900, "genre": "Fiction", "tags": [],
            "language": "en", "description": "D", "excerpt": "E", "look": {"gradient": "g", "accent": "a"},
            "source": {"gutenberg": 1}}

    def test_a_good_book_passes(self):
        books._validate("x", self.GOOD)
        books._validate("x", {**self.GOOD, "source": {"none": "kept"}, "cover": {"commons": "F.jpg", "crop": [0, 0, 1, 1]}})

    def test_mistakes_are_named(self):
        for change, message in [({"year": "1900"}, "year must be a int"),
                                ({"subtitle": "S"}, "unknown key(s) subtitle"),
                                ({"source": {"gutenberg": 1, "strat": "X"}}, "unknown [source] option(s) strat"),
                                ({"source": {"gutenberg": 1, "none": "kept"}}, "exactly one of"),
                                ({"cover": {"commons": "F.jpg", "none": "why"}}, "[cover] holds"),
                                ({"look": {"gradient": "g"}}, "[look] needs")]:
            with self.assertRaises(SystemExit) as e:
                books._validate("x", {**self.GOOD, **change})
            self.assertIn(message, str(e.exception))
        with self.assertRaises(SystemExit) as e:
            books._validate("x", {k: v for k, v in self.GOOD.items() if k != "excerpt"})
        self.assertIn("missing excerpt", str(e.exception))

    def test_source(self):
        self.assertEqual(books.source(self.GOOD), (1, {}))
        self.assertEqual(books.source({"source": {"gutenberg": [1, 2], "toc": True}}), ((1, 2), {"toc": True}))
        self.assertEqual(books.source({"source": {"drop": "X", "volumes": [{"gutenberg": 1, "end": "E"}, {"gutenberg": 2}]}}),
                         (((1, {"end": "E"}), (2, {})), {"drop": "X"}))
        self.assertIsNone(books.source({"source": {"none": "kept"}}))

    def test_standardebooks_requires_pinned_reviewed_source(self):
        src = {"standardebooks": "author/book", "revision": "a" * 40,
               "expected_chapters": 3, "ending": "The end."}
        books._validate("x", {**self.GOOD, "source": src})
        self.assertEqual(books.source({"source": src}), src)
        for key in ["revision", "expected_chapters", "ending"]:
            with self.assertRaises(SystemExit):
                books._validate("x", {**self.GOOD, "source": {k: v for k, v in src.items() if k != key}})


class StandardEbooks(unittest.TestCase):
    @staticmethod
    def archive(files):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as package:
            for name, value in files.items():
                raw = value.encode()
                member = tarfile.TarInfo("repo/src/epub/" + name)
                member.size = len(raw)
                package.addfile(member, io.BytesIO(raw))
        return archive.getvalue()

    def test_spine_bodymatter_and_authorial_text_are_preserved(self):
        """Archive order is not reading order; publisher matter and headings are not narration."""
        def doc(title, content, kind="bodymatter"):
            return (f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                    f'<head><title>{title}</title></head><body epub:type="{kind}">{content}</body></html>')
        files = {
            "content.opf": ('<package xmlns="http://www.idpf.org/2007/opf"><manifest>'
                            '<item id="second" href="text/second.xhtml"/>'
                            '<item id="first" href="text/first.xhtml"/>'
                            '<item id="publisher" href="text/publisher.xhtml"/>'
                            '</manifest><spine><itemref idref="publisher"/><itemref idref="first"/>'
                            '<itemref idref="second"/></spine></package>'),
            "text/second.xhtml": doc("Darl", '<section><h2>Not spoken</h2><p>My mother is a fish.</p></section>'),
            "text/publisher.xhtml": doc("Publisher", '<p>Not the book.</p>', "frontmatter"),
            "text/first.xhtml": doc("Darl", '<section><hgroup><h2>Not spoken</h2></hgroup>'
                                    '<p>One <i>two</i>, three.<br/>Next line.</p>'
                                    '<p><img alt="A drawing" src="image.svg"/></p>'
                                    '<ol start="3"><li><p>Third.</p></li><li>Fourth.</li></ol></section>'),
        }
        self.assertEqual(standardebooks.chapters(self.archive(files)), [
            {"title": "Chapter 1: Darl", "content": "One two, three.\nNext line.\n\n[A drawing]\n\n3. Third.\n\n4. Fourth."},
            {"title": "Chapter 2: Darl", "content": "My mother is a fish."},
        ])

    def test_a_part_containing_text_is_not_silently_discarded(self):
        files = {
            "content.opf": ('<package xmlns="http://www.idpf.org/2007/opf"><manifest>'
                            '<item id="part" href="text/part.xhtml"/></manifest>'
                            '<spine><itemref idref="part"/></spine></package>'),
            "text/part.xhtml": ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                                '<head><title>The Window</title></head><body epub:type="bodymatter">'
                                '<section epub:type="part"><h2>The Window</h2>'
                                '<section epub:type="chapter"><p>Important nested text.</p></section>'
                                '</section></body></html>'),
        }
        with self.assertRaisesRegex(ValueError, "part"):
            standardebooks.chapters(self.archive(files))


class Consistency(unittest.TestCase):
    """The catalogue's parts must agree: the book files, books.json, the built texts, covers and the lock."""

    def test_books_json_is_generated_from_the_book_files(self):
        with open(books.APP_DATA, encoding="utf-8") as f:
            self.assertEqual(f.read(), books.render_app_data(),
                             "web/src/data/books.json is out of date: run python3 scripts/catalog/books.py")

    def test_every_book_has_its_text_and_no_text_is_orphaned(self):
        files = {f[:-5] for f in os.listdir(fetch.OUT_DIR) if f.endswith(".json")}
        self.assertEqual(files, set(books.CATALOG))

    def test_every_text_has_the_book_narration_revision(self):
        for slug, book in books.CATALOG.items():
            with open(os.path.join(fetch.OUT_DIR, slug + ".json"), encoding="utf-8") as f:
                text = json.load(f)
            self.assertEqual(text.get("narrationRevision"), book.get("narration_revision"), slug)

    def test_every_source_is_locked(self):
        with open(fetch.LOCK_PATH) as f:
            lock = json.load(f)
        keys = set()
        for slug in BOOKS:
            src = books.CATALOG[slug]["source"]
            if "standardebooks" in src:
                keys.add(f"standardebooks:{src['standardebooks'].replace('/', '_')}:{src['revision']}")
            else:
                keys.update(str(g) for g, _ in fetch.volumes(slug))
        self.assertEqual(keys - set(lock), set())

    def test_covers_ts_matches_the_cover_files(self):
        files = {f[:-5] for f in os.listdir(COVERS_DIR) if f.endswith(".webp")}
        with open(COVERS_TS, encoding="utf-8") as f:
            listed = set(re.findall(r"'([^']+)'", f.read()))
        self.assertEqual(listed, files)
        self.assertEqual(files - set(books.CATALOG), set())

    def test_a_book_without_a_cover_says_why(self):
        none = {s for s, b in books.CATALOG.items() if "none" in b.get("cover", {})}
        files = {f[:-5] for f in os.listdir(COVERS_DIR) if f.endswith(".webp")}
        self.assertEqual(none & files, set(), "a book with [cover] none has a cover file")


if __name__ == "__main__":
    unittest.main()
