"""Split the catalogue chapters that still lack narration into shards that fit a CI job (books#4).

usage: plan.py CATALOG_DIR REPO VOICE [--force] [SLUG...]
Prints a GitHub Actions matrix: {"include": [{"shard": 0, "units": "slug:0 slug:1 ..."}, ...]}.
A chapter counts as done once REPO has VOICE/<slug>/<chapter>.m4a; --force narrates it again
(e.g. audio made before it came with timings, books#22). Shards keep a book's
chapters together and hold at most SHARD_CHARS characters: Kokoro narrates ~40 chars per
second of CPU on a GitHub runner, so 600k chars is ~4 h, inside the 6 h job limit.
"""
import json, os, sys
from huggingface_hub import HfApi

SHARD_CHARS = 600_000

catalog, repo, voice, *only = sys.argv[1:]
force = "--force" in only
only = [slug for slug in only if slug != "--force"]
done = set() if force else set(HfApi().list_repo_files(repo, repo_type="dataset"))
shards: list[list] = []
size = SHARD_CHARS
for name in sorted(os.listdir(catalog)):
    slug = name.removesuffix(".json")
    if only and slug not in only:
        continue
    for i, ch in enumerate(json.load(open(os.path.join(catalog, name)))["chapters"]):
        chars = len(ch["content"].strip())
        if not chars or f"{voice}/{slug}/{i}.m4a" in done:
            continue
        if size + chars > SHARD_CHARS:
            shards.append([])
            size = 0
        shards[-1].append(f"{slug}:{i}")
        size += chars
print(json.dumps({"include": [{"shard": n, "units": " ".join(s)} for n, s in enumerate(shards)]}))
