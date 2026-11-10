"""Tests of the pure parts of the narration scripts, against the real catalogue (books#27).

usage: python scripts/audio/test_audio.py   (needs requirements.txt installed and ffmpeg; no network)
"""
import json, os, subprocess, sys, tempfile, unittest
from types import SimpleNamespace
from unittest import mock
import manifest
from manifest import build, check_slugs, duration, merge
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


class Durations(unittest.TestCase):
    def test_duration_is_the_real_audio_length(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "0.m4a")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=2.5", "-ac", "1",
                            "-c:a", "aac", "-b:a", "40k", path], check=True)
            self.assertAlmostEqual(duration(path), 2.5, delta=0.05)

    def test_publish_takes_timings_ends_else_probes_and_nulls_missing_chapters(self):
        """Alice-like chapters with timings use them; audio without timings is probed, never sized (books#31)."""
        tree = [SimpleNamespace(path=p, blob_id=f"b{i}") for i, p in enumerate([
            f"af_heart/{ALICE}/0.m4a", f"af_heart/{ALICE}/0.timings.json",
            f"af_heart/{ALICE}/2.m4a", "af_heart/dracula/0.m4a"])]
        api = mock.Mock()
        api.repo_info.return_value = SimpleNamespace(sha="head")
        api.list_repo_tree.return_value = tree
        with tempfile.TemporaryDirectory() as d:
            timings = os.path.join(d, "t.json")
            json.dump({"v": 1, "segments": [[0, 5, 0.0, 1.0], [6, 9, 1.4, 655.159]]}, open(timings, "w"))
            empty = os.path.join(d, "m.json")
            json.dump({"af_heart": {"dracula": [1.0]}}, open(empty, "w"))
            download = lambda repo, path, **kw: empty if path == "manifest.json" else timings
            with mock.patch.object(manifest, "HfApi", return_value=api), \
                 mock.patch.object(manifest, "hf_hub_download", side_effect=download), \
                 mock.patch.object(manifest, "remote_duration", return_value=557.84) as probe:
                out = manifest.publish(CATALOG, "repo", "af_heart", [ALICE])
        probe.assert_called_once_with("repo", f"af_heart/{ALICE}/2.m4a", "head")
        self.assertEqual(out["af_heart"][ALICE], [655.2, None, 557.8] + [None] * 9)
        self.assertEqual(out["af_heart"]["dracula"], [1.0])  # not named: kept as it was


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
