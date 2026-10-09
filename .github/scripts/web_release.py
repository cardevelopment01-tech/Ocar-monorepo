#!/usr/bin/env python3
"""Helpers for the web release workflow (.github/workflows/deploy-web.yml).

Stdlib only. Commands:

  gate <repo> <run_id>
      Decide whether the API "Deploy" run that just finished allows a web release.
      Prints ok=true|false and the reason. Requires the run's "Detect relevant changes" job
      to have succeeded (it only runs when CI passed) and no job to have failed or been
      cancelled (a bake failure / rollback in the API deploy marks the run failed).
      Uses GITHUB_TOKEN.

  current <project_id> <team_id>
      Print the id of the deployment currently serving production (empty if none).

  deployment-id <deployment_url> <team_id>
      Print the Vercel deployment id for a deployment URL.

  live <project_id> <team_id> <expected_id> [timeout_seconds]
      Wait until `expected_id` is the production deployment (or fail on timeout).

  smoke <site_url> <api_url>
      Live check of a deployed site: pages load, no "[SENSITIVE]" placeholder in any script,
      the production API address is baked in, and the API itself is healthy.

Uses VERCEL_TOKEN for the Vercel API.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VERCEL = "https://api.vercel.com"
PLACEHOLDER = "[SENSITIVE]"


def http(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "ignore")


def vercel_get(path, team_id):
    sep = "&" if "?" in path else "?"
    url = f"{VERCEL}{path}{sep}teamId={urllib.parse.quote(team_id)}"
    _, body = http(url, {"Authorization": f"Bearer {os.environ['VERCEL_TOKEN']}"})
    return json.loads(body)


# ---------------------------------------------------------------- gate


def gate(repo, run_id):
    token = os.environ["GITHUB_TOKEN"]
    _, body = http(
        f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/jobs?per_page=100",
        {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
    )
    jobs = json.loads(body).get("jobs", [])
    by_name = {j["name"]: j.get("conclusion") for j in jobs}
    if by_name.get("Detect relevant changes") != "success":
        return False, "CI did not pass for this commit (the API deploy's change-detection job did not run)"
    bad = {n: c for n, c in by_name.items() if c in ("failure", "cancelled", "timed_out")}
    if bad:
        return False, f"the API deploy failed or rolled back: {bad}"
    return True, "CI passed and the API deploy succeeded (or had nothing to deploy)"


# ---------------------------------------------------------------- vercel


def current_prod_id(project_id, team_id):
    p = vercel_get(f"/v9/projects/{project_id}", team_id)
    return ((p.get("targets") or {}).get("production") or {}).get("id") or ""


def deployment_id(deployment_url, team_id):
    host = re.sub(r"^https?://", "", deployment_url.strip()).rstrip("/")
    return vercel_get(f"/v13/deployments/{host}", team_id).get("id", "")


def wait_live(project_id, team_id, expected_id, timeout):
    deadline = time.time() + timeout
    seen = ""
    while time.time() < deadline:
        seen = current_prod_id(project_id, team_id)
        if seen == expected_id:
            return True, seen
        time.sleep(8)
    return False, seen


# ---------------------------------------------------------------- smoke


def script_paths(html):
    paths = set(re.findall(r'"(/(?:_next/static|assets)/[^"]+?\.js)"', html))
    paths |= set(re.findall(r'src="(/[^"]+?\.js)"', html))
    return paths


def smoke_once(site, api):
    problems = []
    scripts = set()
    for page in ("/", "/login"):
        try:
            status, html = http(site + page)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{page}: {e}")
            continue
        if status != 200:
            problems.append(f"{page}: HTTP {status}")
        scripts |= script_paths(html)
    if not scripts:
        problems.append("no script bundles found on / and /login")
    api_host = re.sub(r"^https?://", "", api).rstrip("/")
    api_refs = 0
    for s in sorted(scripts):
        try:
            _, js = http(site + s)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{s}: {e}")
            continue
        if PLACEHOLDER in js:
            problems.append(f"placeholder {PLACEHOLDER} found in {s}")
        api_refs += js.count(api_host)
    if scripts and api_refs == 0:
        problems.append(f"production API address {api_host} is not baked into any bundle")
    try:
        status, body = http(api.rstrip("/") + "/health")
        if status != 200 or '"status":"ok"' not in body.replace(" ", ""):
            problems.append(f"API /health not ok (HTTP {status})")
    except Exception as e:  # noqa: BLE001
        problems.append(f"API /health: {e}")
    return problems


def smoke(site, api, attempts=4, wait=10):
    problems = []
    for i in range(1, attempts + 1):
        problems = smoke_once(site.rstrip("/"), api)
        if not problems:
            return True, [f"{site}: ok ({i} attempt{'s' if i > 1 else ''})"]
        if i < attempts:
            time.sleep(wait)
    return False, problems


# ---------------------------------------------------------------- cli


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "gate":
        ok, reason = gate(argv[2], argv[3])
        print(f"{'ok=true' if ok else 'ok=false'}\nreason={reason}")
        return 0
    if cmd == "current":
        print(current_prod_id(argv[2], argv[3]))
        return 0
    if cmd == "deployment-id":
        print(deployment_id(argv[2], argv[3]))
        return 0
    if cmd == "live":
        ok, seen = wait_live(argv[2], argv[3], argv[4], int(argv[5]) if len(argv) > 5 else 180)
        print("live" if ok else f"NOT live: production is still {seen or 'unknown'}")
        return 0 if ok else 1
    if cmd == "smoke":
        ok, lines = smoke(argv[2], argv[3])
        for line in lines:
            print(("" if ok else "FAIL: ") + line)
        return 0 if ok else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
