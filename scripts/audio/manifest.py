"""Rebuild manifest.json from every VOICE/<slug>/index.json in the dataset (books#4).

usage: manifest.py REPO OUT_FILE
Output: {"<voice>": {"<slug>": [seconds per chapter, null if not narrated]}}.
"""
import json, sys
from huggingface_hub import HfApi, hf_hub_download

repo, out = sys.argv[1:]
manifest: dict = {}
for path in sorted(HfApi().list_repo_files(repo, repo_type="dataset")):
    parts = path.split("/")
    if len(parts) == 3 and parts[2] == "index.json":
        voice, slug, _ = parts
        manifest.setdefault(voice, {})[slug] = json.load(open(hf_hub_download(repo, path, repo_type="dataset")))
json.dump(manifest, open(out, "w"), separators=(",", ":"))
print(f"{sum(len(v) for v in manifest.values())} books across {len(manifest)} voice(s)")
