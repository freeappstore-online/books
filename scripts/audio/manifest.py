"""Update manifest.json for the narrated chapters of the given books (books#4, books#18, books#27).

usage: manifest.py CATALOG_DIR REPO VOICE SLUG...|all-existing
Output: {"<voice>": {"<slug>": [seconds per chapter, null if not narrated]}}. A chapter's length is
where its timings.json ends (the audio ends with its last sentence); chapters without timings are
measured with ffprobe (over HTTP, reading only the header; downloaded when that fails), never
estimated from the file size, which ran a few % short (books#31).
Only the given books' entries in VOICE are rebuilt; everything else in the manifest is kept as it
is, so audio in the dataset reaches the app only for books a run names. `all-existing` (the
workflow's manifest mode only) names every book with audio in VOICE, to publish what is there
without narrating anything (books#31). generate.py calls publish() with each batch of chapters,
so they appear while a run goes on.
"""
import json, os, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download, hf_hub_url
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError

ALL_EXISTING = "all-existing"


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


def duration(source: str) -> float:
    """Seconds of audio in source, a file or a URL (ffprobe reads only what it needs of a URL)."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source],
                         capture_output=True, text=True, check=True, timeout=120).stdout
    return float(out)


def remote_duration(repo: str, path: str, revision: str) -> float:
    """Seconds of audio in the dataset file path: probed over HTTP, else downloaded and probed."""
    try:
        return duration(hf_hub_url(repo, path, repo_type="dataset", revision=revision))
    except (subprocess.SubprocessError, ValueError):
        with tempfile.TemporaryDirectory() as d:
            return duration(hf_hub_download(repo, path, repo_type="dataset", revision=revision, local_dir=d))


def existing(repo: str, voice: str) -> list[str]:
    """Slugs of every book with audio in voice in the dataset."""
    files = HfApi().list_repo_tree(repo, path_in_repo=voice, repo_type="dataset", recursive=True)
    return sorted({f.path.split("/")[1] for f in files if f.path.endswith(".m4a")})


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
    probed: dict[tuple[str, str], float] = {}  # (path, blob id) → seconds, kept across retries
    for attempt in range(10):
        head = api.repo_info(repo, repo_type="dataset").sha
        try:
            manifest = json.load(open(hf_hub_download(repo, "manifest.json", repo_type="dataset", revision=head)))
        except EntryNotFoundError:
            manifest = {}
        ours = {f"{voice}/{slug}" for slug in slugs}
        remote = {f.path: f.blob_id for f in api.list_repo_tree(repo, repo_type="dataset", recursive=True, revision=head)
                  if f.path.rsplit("/", 1)[0] in ours}

        def seconds_of(p: str) -> float:
            timings = p.removesuffix(".m4a") + ".timings.json"
            if timings in files:  # this commit's audio comes with this commit's timings
                return timings_end(files[timings])
            if p in files:
                return duration(files[p])
            if timings in remote:
                return timings_end(hf_hub_download(repo, timings, repo_type="dataset", revision=head))
            if (p, remote[p]) not in probed:
                probed[p, remote[p]] = remote_duration(repo, p, head)
            return probed[p, remote[p]]

        paths = sorted({p for p in [*remote, *files] if p.endswith(".m4a")})
        with ThreadPoolExecutor(8) as pool:
            seconds = dict(zip(paths, pool.map(seconds_of, paths)))
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
    if slugs == [ALL_EXISTING]:
        slugs = existing(repo, voice)
    manifest = publish(catalog, repo, voice, slugs)
    print(f"{voice}: {', '.join(manifest.get(voice, {}))}")
