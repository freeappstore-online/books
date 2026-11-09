"""Update manifest.json for the narrated chapters in the dataset (books#4, books#18).

usage: manifest.py CATALOG_DIR REPO [SLUG...]
Output: {"<voice>": {"<slug>": [seconds per chapter, null if not narrated]}}. Durations are
estimated from file size (AAC at ~41.7 kbps); the app only needs to know what exists.
Only the given books' entries are rebuilt (every catalogue book when none are given); the rest
of the manifest is kept, so audio in the dataset reaches the app only for books a run was asked
to narrate. generate.py calls publish() with each batch of chapters, so they appear while a run
goes on.
"""
import json, os, sys, time
from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError

BYTES_PER_SECOND = 41_700 / 8


def build(catalog: str, sizes: dict[str, int], slugs: list[str]) -> dict:
    """Manifest entries of the given books from the sizes of the VOICE/<slug>/<chapter>.m4a files."""
    manifest: dict = {}
    for voice in sorted({p.split("/")[0] for p in sizes}):
        for slug in slugs:
            n = len(json.load(open(os.path.join(catalog, f"{slug}.json")))["chapters"])
            chapters = [sizes.get(f"{voice}/{slug}/{i}.m4a") for i in range(n)]
            if any(chapters):
                manifest.setdefault(voice, {})[slug] = [round(s / BYTES_PER_SECOND, 1) if s else None for s in chapters]
    return manifest


def publish(catalog: str, repo: str, slugs: list[str], folder: str | None = None, message: str = "manifest") -> dict:
    """Commit the files under folder (if any) and the manifest with the given books' entries rebuilt.

    The commit names the revision the manifest was built from, so when another shard commits
    in between it is refused and rebuilt on top of theirs instead of dropping their chapters.
    """
    api = HfApi()
    files = {os.path.relpath(os.path.join(d, f), folder): os.path.join(d, f)
             for d, _, names in (os.walk(folder) if folder else []) for f in names}
    for attempt in range(10):
        head = api.repo_info(repo, repo_type="dataset").sha
        try:
            manifest = json.load(open(hf_hub_download(repo, "manifest.json", repo_type="dataset", revision=head)))
        except EntryNotFoundError:
            manifest = {}
        sizes = {f.path: f.size for f in api.list_repo_tree(repo, repo_type="dataset", recursive=True, revision=head)
                 if f.path.endswith(".m4a") and f.path.count("/") == 2}
        sizes |= {p: os.path.getsize(f) for p, f in files.items() if p.endswith(".m4a")}
        for books in manifest.values():
            for slug in slugs:
                books.pop(slug, None)
        for voice, books in build(catalog, sizes, slugs).items():
            manifest.setdefault(voice, {}).update(books)
        manifest = {voice: dict(sorted(books.items())) for voice, books in sorted(manifest.items()) if books}
        ops = [CommitOperationAdd(p, f) for p, f in files.items()]
        ops.append(CommitOperationAdd("manifest.json", json.dumps(manifest, separators=(",", ":")).encode()))
        try:
            api.create_commit(repo, ops, commit_message=message, repo_type="dataset", parent_commit=head)
            return manifest
        except HfHubHTTPError:
            # A refused parent commit is a 412; anything else that left the head alone is a real error
            if api.repo_info(repo, repo_type="dataset").sha == head:
                raise
            print(f"{repo} moved on while committing, retrying", flush=True)
            time.sleep(5 + 5 * attempt)
    raise RuntimeError(f"could not commit to {repo}")


if __name__ == "__main__":
    catalog, repo, *slugs = sys.argv[1:]
    manifest = publish(catalog, repo, slugs or sorted(n.removesuffix(".json") for n in os.listdir(catalog)))
    print(f"{sum(len(v) for v in manifest.values())} books across {len(manifest)} voice(s)")
