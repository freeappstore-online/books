"""Queue the chapters the dataset has no narration for as community narration jobs (books#66).

usage: community.py CATALOG_DIR REPO VOICE [--dry-run] [SLUG...]
Without slugs, every book in the catalogue. Signed-in listeners' devices narrate the jobs with Kokoro
(the Books web app, the FreeAppStore Android app) and the platform verifies each upload before the
app plays it (freeappstore-online/platform docs/community-generation.md).

A job is one chapter: key `<slug>/<chapter>` (`<slug>/<revision>/<chapter>` for a text with a
narrationRevision, as its folder in the dataset), input the chapter's `content` exactly as
generate.py narrates it, so the timings a device sends are offsets into the catalogue text. A chapter
counts as narrated once REPO has VOICE/<slug>/<chapter>.m4a, as in plan.py.

The edition's job set is `audio.communitySet` in edition/config.json: Kokoro v1.0, the edition's
voice, audio/mp4. Without one, a set is created and its id written there (the workflow commits it).
The platform is called with the GitHub Actions OIDC token of this run, which it accepts only from
main of the app's own repository. --dry-run lists the jobs and calls nothing.
"""
import json, os, sys, urllib.error, urllib.request
from engine import check, edition_config
from manifest import audio_prefix, check_slugs

API = "https://api.freeappstore.online"
AUDIENCE = API
MODEL = {"model": "kokoro", "modelVersion": "v1.0"}  # Kokoro v1.0, as the Android app declares it
MAX_TEXT = 100_000  # characters the platform takes per job
MAX_BYTES = 25_000_000  # the platform's cap; ~80 min at the web app's 40 kbps
BATCH_JOBS, BATCH_CHARS = 500, 4_000_000  # per request: the platform takes 500 jobs and 8 MB


def community_jobs(catalog: str, voice: str, files: set[str], slugs: list[str]) -> tuple[list[dict], list[str]]:
    """The jobs for the named books' chapters without audio in `files`, and the keys too long for one job."""
    jobs, too_long = [], []
    for slug in slugs:
        prefix = audio_prefix(catalog, voice, slug)
        for i, ch in enumerate(json.load(open(os.path.join(catalog, f"{slug}.json")))["chapters"]):
            text = ch["content"]
            if not text.strip() or f"{prefix}/{i}.m4a" in files:
                continue
            key = f"{prefix.split('/', 1)[1]}/{i}"
            if len(text.encode("utf-16-le")) // 2 > MAX_TEXT:  # the platform counts JavaScript string length
                too_long.append(key)
            else:
                jobs.append({"key": key, "input": {"text": text}})
    return jobs, too_long


def oidc_token() -> str:
    """This workflow run's GitHub Actions OIDC token for the platform (needs `id-token: write`)."""
    url = f"{os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']}&audience={AUDIENCE}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}"})
    with urllib.request.urlopen(req) as res:
        return json.load(res)["value"]


def call(token: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(f"{API}/v1{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          # Cloudflare refuses urllib's default agent (error 1010)
                                          "User-Agent": "books-community-narration (+https://github.com/freeappstore-online/books)"})
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        sys.exit(f"POST {path}: {err.code} {err.read().decode(errors='replace')}")


def batches(jobs: list[dict]):
    batch, size = [], 0
    for job in jobs:
        n = len(json.dumps(job))
        if batch and (len(batch) == BATCH_JOBS or size + n > BATCH_CHARS):
            yield batch
            batch, size = [], 0
        batch.append(job)
        size += n
    if batch:
        yield batch


if __name__ == "__main__":
    catalog, repo, voice, *slugs = sys.argv[1:]
    dry_run = "--dry-run" in slugs
    slugs = [s for s in slugs if s != "--dry-run"]
    check(catalog, voice)  # only Kokoro narrates; the set says so
    if slugs:
        check_slugs(catalog, slugs)
    else:
        slugs = sorted(f[:-5] for f in os.listdir(catalog) if f.endswith(".json"))
    from huggingface_hub import HfApi
    jobs, too_long = community_jobs(catalog, voice, set(HfApi().list_repo_files(repo, repo_type="dataset")), slugs)
    for key in too_long:
        print(f"::warning::{key}: over {MAX_TEXT} characters, too long for one job; narrate it in generate-audio.yml")
    print(f"{len(jobs)} chapter(s) without narration in {len({j['key'].split('/')[0] for j in jobs})} book(s), "
          f"{sum(len(j['input']['text']) for j in jobs)} characters")
    if dry_run:
        for job in jobs:
            text = job["input"]["text"]
            print(f"  {job['key']}: {len(text)} chars, {text[:60]!r}")
        sys.exit(0)
    if not jobs:
        sys.exit(0)

    config = edition_config(catalog)
    app = config["id"]
    token = oidc_token()
    set_id = config["audio"].get("communitySet")
    if not set_id:
        new = call(token, f"/apps/{app}/generation/sets", {
            "kind": "tts", **MODEL, "params": {"voice": voice}, "formats": ["audio/mp4"],
            "maxBytes": MAX_BYTES, "replicas": 1})
        set_id = new["set"]["id"]
        config["audio"]["communitySet"] = set_id
        with open(os.path.join(os.path.dirname(os.path.abspath(catalog)), "config.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
        print(f"created job set {set_id} (audio.communitySet)")
    status: dict[str, int] = {}
    for batch in batches(jobs):
        for job in call(token, f"/apps/{app}/generation/sets/{set_id}/jobs", {"jobs": batch})["jobs"]:
            status[job["status"]] = status.get(job["status"], 0) + 1
    print(f"set {set_id}: " + ", ".join(f"{n} {s}" for s, n in sorted(status.items())))
