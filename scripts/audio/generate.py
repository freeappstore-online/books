"""Narrate catalogue chapters with Kokoro (books#4).

usage: generate.py MODELS_DIR CATALOG_DIR REPO VOICE [--titles] SLUG:CHAPTER...
Writes VOICE/<slug>/<chapter>.m4a (AAC, mono), VOICE/<slug>/<chapter>.timings.json and the
chapter's title clip VOICE/<slug>/<chapter>.title.m4a, and commits them with an updated manifest
at most every UPLOAD_EVERY seconds, so chapters show up in the app while the run goes on and a job
that dies keeps most of its work. --titles makes only the title clips, for chapters narrated
before they existed (books#37).

Chapters are narrated a sentence at a time and joined with a pause, so the time each sentence
is spoken is known exactly (books#22). timings.json is {"v":1,"segments":[[charStart, charEnd,
startSec, endSec], ...]}, one segment per sentence, char offsets in UTF-16 code units (JavaScript
string indices) into the chapter's content in the catalogue.

Chapters and titles are loudness-normalised to LUFS / MAX_PEAK (books#37) by a gain that keeps
every sample where it was, so the timings stay exact. A title clip ("Chapter One. The Cyclone.",
segments.spoken_title) keeps at most EDGE seconds of silence at either end.
"""
import json, os, re, shutil, subprocess, sys, time
import numpy as np
import soundfile as sf
from manifest import publish
from segments import sentences, spoken_title, utf16

UPLOAD_EVERY = 10 * 60
SENTENCE_PAUSE = 0.4  # seconds; about what Kokoro leaves between sentences it narrates in one go
PARAGRAPH_PAUSE = 0.8
LUFS = -18.0  # integrated loudness: spoken-word apps aim for -16 to -19 (books#33 measured -22)
MAX_PEAK = -1.5  # dBTP of the encoded file
PEAK_TARGETS = (-3.0, -4.0, -5.0, -6.0)  # dBTP asked of loudnorm in turn: AAC adds 1-2 dB (encode())
CUTOFF = 8000  # Hz; the encoder's low-pass
EDGE = 0.1  # seconds of silence kept before and after a title clip's speech
OUT = "out"


def narrate(kokoro, content: str, voice: str, lang: str) -> tuple[np.ndarray, int, list]:
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


def trim(samples: np.ndarray, sr: int) -> np.ndarray:
    """samples with at most EDGE seconds before the first and after the last sound (> -40 dB of the peak)."""
    loud = np.flatnonzero(np.abs(samples) > np.abs(samples).max() * 0.01)
    if not len(loud):
        return samples
    edge = int(EDGE * sr)
    return samples[max(0, loud[0] - edge): loud[-1] + 1 + edge]


def loudness(path: str) -> tuple[float, float]:
    """(integrated LUFS, true peak dBTP) of an audio file, as ffmpeg's EBU R128 meter gives them."""
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         check=True, capture_output=True, text=True).stderr
    summary = log[log.rindex("Summary:"):]
    return (float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary)[1]),
            float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)[1]))


def encode(wav: str, m4a: str) -> None:
    """wav as 40 kbps mono AAC at LUFS with a true peak <= MAX_PEAK: two-pass ffmpeg loudnorm.

    loudnorm applies one gain to the whole file when that keeps the peaks under its target, and
    otherwise a slowly varying one; either way no sample moves in time and the output has as many
    samples as the input, so timings stay exact. AAC at this bitrate overshoots the peaks it is
    given by 1-3 dB, mostly above CUTOFF, so the encoder leaves out that band (sibilance only) and
    the peak target is lowered until the encoded file is under MAX_PEAK.
    """
    for peak in PEAK_TARGETS:
        target = f"loudnorm=I={LUFS}:TP={peak}:LRA=11"
        log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", wav, "-af", f"{target}:print_format=json",
                              "-f", "null", "-"], check=True, capture_output=True, text=True).stderr
        m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", log)[0])
        measured = (f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                    f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        # loudnorm works at 192 kHz; back to the input's rate, with timestamps counted from its samples
        # (else the container says the file is a frame longer than its audio)
        back = f"aresample={sf.info(wav).samplerate},asetpts=N/SR/TB"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-af", f"{target}:{measured},{back}",
                        "-c:a", "aac", "-b:a", "40k", "-cutoff", str(CUTOFF), "-ac", "1", "-movflags", "+faststart",
                        m4a], check=True)
        if loudness(m4a)[1] <= MAX_PEAK:
            return
    raise RuntimeError(f"{m4a}: true peak still above {MAX_PEAK} dBTP")


if __name__ == "__main__":
    from kokoro_onnx import Kokoro
    models, catalog, repo, voice, *units = sys.argv[1:]
    titles_only = "--titles" in units
    units = [u for u in units if u != "--titles"]
    lang = "en-gb" if voice[0] == "b" else "en-us"
    kokoro = Kokoro(f"{models}/kokoro-v1.0.onnx", f"{models}/voices-v1.0.bin")
    books: dict[str, list] = {}
    last_upload = time.time()

    def upload(final: bool):
        global last_upload
        if os.path.isdir(OUT) and (final or time.time() - last_upload > UPLOAD_EVERY):
            names = [f for _, _, files in os.walk(OUT) for f in files]
            chapters = sum(bool(re.fullmatch(r"\d+\.m4a", f)) for f in names)
            titles = sum(f.endswith(".title.m4a") for f in names)
            if chapters or titles:
                what = f"{chapters} chapter(s), {titles} title(s)"
                publish(catalog, repo, voice, os.listdir(f"{OUT}/{voice}"), OUT, f"{voice}: {what}")
                print(f"uploaded {what}", flush=True)
            shutil.rmtree(OUT)
            last_upload = time.time()

    for unit in units:
        slug, i = unit.rsplit(":", 1)
        if slug not in books:
            books[slug] = json.load(open(f"{catalog}/{slug}.json"))["chapters"]
        chapter = books[slug][int(i)]
        dest = f"{OUT}/{voice}/{slug}"
        os.makedirs(dest, exist_ok=True)
        t = time.time()
        if not titles_only:
            samples, sr, segments = narrate(kokoro, chapter["content"], voice, lang)
            sf.write(f"{dest}/{i}.wav", samples, sr)
            encode(f"{dest}/{i}.wav", f"{dest}/{i}.m4a")
            os.remove(f"{dest}/{i}.wav")
            json.dump({"v": 1, "segments": segments}, open(f"{dest}/{i}.timings.json", "w"), separators=(",", ":"))
            print(f"{unit}: {len(samples) / sr / 60:.1f} min audio in {(time.time() - t) / 60:.1f} min", flush=True)
        title = spoken_title(chapter["title"])
        if title:
            samples, sr = kokoro.create(title, voice=voice, speed=1.0, lang=lang)
            samples = trim(samples, sr)
            sf.write(f"{dest}/{i}.title.wav", samples, sr)
            encode(f"{dest}/{i}.title.wav", f"{dest}/{i}.title.m4a")
            os.remove(f"{dest}/{i}.title.wav")
            print(f"{unit}: title {title!r}, {len(samples) / sr:.1f} s", flush=True)
        upload(final=False)
    upload(final=True)
