"""Narrate catalogue chapters with Kokoro, the model the app runs in the browser (books#4).

usage: generate.py MODELS_DIR CATALOG_DIR REPO VOICE SLUG:CHAPTER...
Writes VOICE/<slug>/<chapter>.m4a (AAC, mono) and VOICE/<slug>/<chapter>.timings.json, and
commits them with an updated manifest at most every UPLOAD_EVERY seconds, so chapters show up
in the app while the run goes on and a job that dies keeps most of its work.

Chapters are narrated a sentence at a time and joined with a pause, so the time each sentence
is spoken is known exactly (books#22). timings.json is {"v":1,"segments":[[charStart, charEnd,
startSec, endSec], ...]}, one segment per sentence, char offsets in UTF-16 code units (JavaScript
string indices) into the chapter's content in the catalogue.
"""
import json, os, shutil, subprocess, sys, time
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from manifest import publish
from segments import sentences, utf16

UPLOAD_EVERY = 10 * 60
SENTENCE_PAUSE = 0.4  # seconds; about what Kokoro leaves between sentences it narrates in one go
PARAGRAPH_PAUSE = 0.8
OUT = "out"


def narrate(kokoro: Kokoro, content: str, voice: str, lang: str) -> tuple[np.ndarray, int, list]:
    """The chapter's audio, its sample rate, and when each sentence is spoken."""
    u16 = utf16(content)
    parts, segments, length, sr = [], [], 0, 24_000
    for start, end, ends_paragraph in sentences(content):
        try:
            samples, sr = kokoro.create(content[start:end], voice=voice, speed=1.0, lang=lang)
        except ValueError as err:  # nothing to say, e.g. "* * *"
            print(f"  skipped {content[start:end]!r}: {err}", flush=True)
            continue
        segments.append([u16[start], u16[end], round(length / sr, 3), round((length + len(samples)) / sr, 3)])
        pause = np.zeros(int((PARAGRAPH_PAUSE if ends_paragraph else SENTENCE_PAUSE) * sr), samples.dtype)
        parts += [samples, pause]
        length += len(samples) + len(pause)
    return np.concatenate(parts[:-1]), sr, segments


if __name__ == "__main__":
    models, catalog, repo, voice, *units = sys.argv[1:]
    lang = "en-gb" if voice[0] == "b" else "en-us"
    kokoro = Kokoro(f"{models}/kokoro-v1.0.onnx", f"{models}/voices-v1.0.bin")
    books: dict[str, list] = {}
    last_upload = time.time()

    def upload(final: bool):
        global last_upload
        if os.path.isdir(OUT) and (final or time.time() - last_upload > UPLOAD_EVERY):
            chapters = sum(f.endswith(".m4a") for _, _, names in os.walk(OUT) for f in names)
            if chapters:
                publish(catalog, repo, os.listdir(f"{OUT}/{voice}"), OUT, f"{voice}: {chapters} chapter(s)")
                print(f"uploaded {chapters} chapter(s)", flush=True)
            shutil.rmtree(OUT)
            last_upload = time.time()

    for unit in units:
        slug, i = unit.rsplit(":", 1)
        if slug not in books:
            books[slug] = json.load(open(f"{catalog}/{slug}.json"))["chapters"]
        dest = f"{OUT}/{voice}/{slug}"
        os.makedirs(dest, exist_ok=True)
        t = time.time()
        samples, sr, segments = narrate(kokoro, books[slug][int(i)]["content"], voice, lang)
        sf.write(f"{dest}/{i}.wav", samples, sr)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{dest}/{i}.wav", "-c:a", "aac", "-b:a", "40k",
                        "-ac", "1", "-movflags", "+faststart", f"{dest}/{i}.m4a"], check=True)
        os.remove(f"{dest}/{i}.wav")
        json.dump({"v": 1, "segments": segments}, open(f"{dest}/{i}.timings.json", "w"), separators=(",", ":"))
        print(f"{unit}: {len(samples) / sr / 60:.1f} min audio in {(time.time() - t) / 60:.1f} min", flush=True)
        upload(final=False)
    upload(final=True)
