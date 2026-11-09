"""Rebuild manifest.json from the narrated chapters in the dataset (books#4).

usage: manifest.py CATALOG_DIR REPO OUT_FILE
Output: {"<voice>": {"<slug>": [seconds per chapter, null if not narrated]}}. Durations are
estimated from file size (AAC at ~41.7 kbps); the app only needs to know what exists.
"""
import json, os, sys
from huggingface_hub import HfApi

BYTES_PER_SECOND = 41_700 / 8

catalog, repo, out = sys.argv[1:]
sizes = {}
for f in HfApi().list_repo_tree(repo, repo_type="dataset", recursive=True):
    parts = f.path.split("/")
    if len(parts) == 3 and parts[2].endswith(".m4a"):
        sizes[f.path] = f.size

manifest: dict = {}
for voice in sorted({p.split("/")[0] for p in sizes}):
    for name in sorted(os.listdir(catalog)):
        slug = name.removesuffix(".json")
        n = len(json.load(open(os.path.join(catalog, name)))["chapters"])
        chapters = [sizes.get(f"{voice}/{slug}/{i}.m4a") for i in range(n)]
        if any(chapters):
            manifest.setdefault(voice, {})[slug] = [round(s / BYTES_PER_SECOND, 1) if s else None for s in chapters]
json.dump(manifest, open(out, "w"), separators=(",", ":"))
print(f"{sum(len(v) for v in manifest.values())} books across {len(manifest)} voice(s)")
