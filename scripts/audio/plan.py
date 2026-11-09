"""Split the catalog books that still lack narration into balanced shards (books#4).

usage: plan.py CATALOG_DIR REPO VOICE SHARDS [SLUG...]
Prints a GitHub Actions matrix: {"include": [{"shard": 0, "slugs": "a b c"}, ...]}.
A book counts as done once REPO has VOICE/<slug>/index.json.
"""
import json, os, sys
from huggingface_hub import HfApi

catalog, repo, voice, shards, *only = sys.argv[1:]
done = {p.split("/")[1] for p in HfApi().list_repo_files(repo, repo_type="dataset")
        if p.startswith(voice + "/") and p.endswith("/index.json")}
books = []
for name in sorted(os.listdir(catalog)):
    slug = name.removesuffix(".json")
    if slug in done or (only and slug not in only):
        continue
    chars = sum(len(c["content"]) for c in json.load(open(os.path.join(catalog, name)))["chapters"])
    books.append((chars, slug))

bins = [[0, []] for _ in range(min(int(shards), len(books)))]
for chars, slug in sorted(books, reverse=True):
    b = min(bins, key=lambda b: b[0])
    b[0] += chars
    b[1].append(slug)
print(json.dumps({"include": [{"shard": i, "slugs": " ".join(b[1])} for i, b in enumerate(bins)]}))
