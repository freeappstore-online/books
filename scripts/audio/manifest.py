"""Update manifest.json for the narrated chapters of the given books (books#4, books#18, books#27).

usage: manifest.py CATALOG_DIR REPO VOICE SLUG...
Output: {"<voice>": {"<slug>": [seconds per chapter, null if not narrated]}}. A chapter's length is
where its timings.json ends (the audio ends with its last sentence); chapters without timings fall
back to an estimate from the file size (AAC at ~41.7 kbps, which runs a few % short).
Only the given books' entries in VOICE are rebuilt; everything else in the manifest is kept as it
is, so audio in the dataset reaches the app only for books a run was asked to narrate. There is no
"every book" mode on purpose. generate.py calls publish() with each batch of chapters, so they
appear while a run goes on.
"""
import json, os, sys, time
from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError

BYTES_PER_SECOND = 41_700 / 8


def check_slugs(catalog: str, slugs: list[str]) -> None:
    """Exit unless slugs names at least one book, all of them in the catalogue."""
    if not slugs:
        sys.exit("name the books (catalogue slugs); there is no 'every book' mode (books#27)")
    unknown = [s for s in slugs if not os.path.exists(os.path.join(catalog, f"{s}.json"))]
    if unknown:
        sys.exit(f"not in {catalog}: {' '.join(unknown)}")


def timings_end(path: str) -> float:
    """Where the narration described by a timings.json file ends, in seconds."""
    return json.load(open(path))["segments"][-1][3]


def build(catalog: str, voice: str, seconds: dict[str, float], slugs: list[str]) -> dict:
    """Manifest entries of the given books from the length of each VOICE/<slug>/<chapter>.m4a."""
    books: dict = {}
    for slug in slugs:
        n = len(json.load(open(os.path.join(catalog, f"{slug}.json")))["chapters"])
        chapters = [seconds.get(f"{voice}/{slug}/{i}.m4a") for i in range(n)]
        if any(chapters):
            books[slug] = [round(s, 1) if s else None for s in chapters]
    return books


def merge(manifest: dict, voice: str, books: dict, slugs: list[str]) -> dict:
    """manifest with the given books' entries in voice replaced by books; nothing else changes."""
    out = {v: dict(b) for v, b in manifest.items()}
    entries = out.setdefault(voice, {})
    for slug in slugs:
        entries.pop(slug, None)
    entries.update(books)
    return {v: dict(sorted(b.items())) for v, b in sorted(out.items()) if b}


def publish(catalog: str, repo: str, voice: str, slugs: list[str], folder: str | None = None,
            message: str = "manifest") -> dict:
    """Commit the files under folder (if any) and the manifest with the given books' entries rebuilt.

    The commit names the revision the manifest was built from, so when another shard commits
    in between it is refused and rebuilt on top of theirs instead of dropping their chapters.
    """
    check_slugs(catalog, slugs)
    api = HfApi()
    files = {os.path.relpath(os.path.join(d, f), folder): os.path.join(d, f)
             for d, _, names in (os.walk(folder) if folder else []) for f in names}
    for attempt in range(10):
        head = api.repo_info(repo, repo_type="dataset").sha
        try:
            manifest = json.load(open(hf_hub_download(repo, "manifest.json", repo_type="dataset", revision=head)))
        except EntryNotFoundError:
            manifest = {}
        ours = {f"{voice}/{slug}" for slug in slugs}
        remote = {f.path: f.size for f in api.list_repo_tree(repo, repo_type="dataset", recursive=True, revision=head)
                  if f.path.rsplit("/", 1)[0] in ours}
        seconds = {}
        for p in {p for p in [*remote, *files] if p.endswith(".m4a")}:
            timings = p.removesuffix(".m4a") + ".timings.json"
            if timings in files:  # this commit's audio comes with this commit's timings
                seconds[p] = timings_end(files[timings])
            elif p in files:
                seconds[p] = os.path.getsize(files[p]) / BYTES_PER_SECOND
            elif timings in remote:
                seconds[p] = timings_end(hf_hub_download(repo, timings, repo_type="dataset", revision=head))
            else:
                seconds[p] = remote[p] / BYTES_PER_SECOND
        manifest = merge(manifest, voice, build(catalog, voice, seconds, slugs), slugs)
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
    catalog, repo, voice, *slugs = sys.argv[1:]
    manifest = publish(catalog, repo, voice, slugs)
    print(f"{voice}: {', '.join(manifest.get(voice, {}))}")
