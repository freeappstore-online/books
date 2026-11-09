"""Narrate one catalog book with Kokoro, the model the app runs in the browser (books#4).

usage: generate.py MODELS_DIR CATALOG_DIR OUT_DIR VOICE SLUG
Writes OUT_DIR/VOICE/SLUG/<chapter>.m4a (AAC, mono) and OUT_DIR/VOICE/SLUG/index.json,
a list of chapter durations in seconds (null for chapters with no text).
"""
import json, os, subprocess, sys, time
import soundfile as sf
from kokoro_onnx import Kokoro

models, catalog, out, voice, slug = sys.argv[1:]
lang = "en-gb" if voice[0] == "b" else "en-us"
kokoro = Kokoro(f"{models}/kokoro-v1.0.onnx", f"{models}/voices-v1.0.bin")
chapters = json.load(open(f"{catalog}/{slug}.json"))["chapters"]
dest = f"{out}/{voice}/{slug}"
os.makedirs(dest, exist_ok=True)

durations = []
for i, ch in enumerate(chapters):
    text = ch["content"].strip()
    if not text:
        durations.append(None)
        continue
    t = time.time()
    samples, sr = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
    wav = f"{dest}/{i}.wav"
    sf.write(wav, samples, sr)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "40k", "-ac", "1",
                    "-movflags", "+faststart", f"{dest}/{i}.m4a"], check=True)
    os.remove(wav)
    durations.append(round(len(samples) / sr, 1))
    print(f"{slug} {i + 1}/{len(chapters)}: {durations[-1] / 60:.1f} min audio in {(time.time() - t) / 60:.1f} min", flush=True)

json.dump(durations, open(f"{dest}/index.json", "w"))
