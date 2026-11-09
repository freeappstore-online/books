"""Narrate catalogue chapters with Kokoro, the model the app runs in the browser (books#4).

usage: generate.py MODELS_DIR CATALOG_DIR REPO VOICE SLUG:CHAPTER...
Writes VOICE/<slug>/<chapter>.m4a (AAC, mono) and uploads to the REPO dataset in batches,
at most every UPLOAD_EVERY seconds, so a job that dies keeps most of its work.
"""
import json, os, shutil, subprocess, sys, time
import soundfile as sf
from huggingface_hub import HfApi
from kokoro_onnx import Kokoro

UPLOAD_EVERY = 30 * 60
OUT = "out"

models, catalog, repo, voice, *units = sys.argv[1:]
lang = "en-gb" if voice[0] == "b" else "en-us"
kokoro = Kokoro(f"{models}/kokoro-v1.0.onnx", f"{models}/voices-v1.0.bin")
api = HfApi()
books: dict[str, list] = {}
last_upload = time.time()


def upload(final: bool):
    global last_upload
    if os.path.isdir(OUT) and (final or time.time() - last_upload > UPLOAD_EVERY):
        files = sum(len(f) for _, _, f in os.walk(OUT))
        if files:
            api.upload_folder(repo_id=repo, repo_type="dataset", folder_path=OUT,
                              commit_message=f"{voice}: {files} chapter(s)")
            print(f"uploaded {files} chapter(s)", flush=True)
        shutil.rmtree(OUT)
        last_upload = time.time()


for unit in units:
    slug, i = unit.rsplit(":", 1)
    if slug not in books:
        books[slug] = json.load(open(f"{catalog}/{slug}.json"))["chapters"]
    text = books[slug][int(i)]["content"].strip()
    dest = f"{OUT}/{voice}/{slug}"
    os.makedirs(dest, exist_ok=True)
    t = time.time()
    samples, sr = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
    sf.write(f"{dest}/{i}.wav", samples, sr)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{dest}/{i}.wav", "-c:a", "aac", "-b:a", "40k",
                    "-ac", "1", "-movflags", "+faststart", f"{dest}/{i}.m4a"], check=True)
    os.remove(f"{dest}/{i}.wav")
    print(f"{unit}: {len(samples) / sr / 60:.1f} min audio in {(time.time() - t) / 60:.1f} min", flush=True)
    upload(final=False)
upload(final=True)
