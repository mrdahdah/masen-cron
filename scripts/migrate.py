"""Move the Masen apps' scheduled ticks from their private repos to this public repo (free Actions minutes).

  python scripts/migrate.py            # dry run: prints the plan, changes nothing
  python scripts/migrate.py --apply    # does it, app by app; stops at the first failure
  python scripts/migrate.py --apply --only=nexus

Why a rotation: every app keeps CRON_SECRET as a Vercel *sensitive* (write-only) variable and the private repos keep it as a GitHub
secret, so the current value cannot be copied. Per app, with --apply:
  1. generate a new CRON_SECRET (never printed);
  2. set it in Vercel (each target that had it), in the private repo's secret used by its old workflow (manual runs keep working)
     and in this repo's secret read by tick.yml;
  3. redeploy the app's current production deployment so the new value is live, wait until READY;
  4. call one of its tick endpoints with the new token and require the expected status;
  5. disable the old scheduled workflow(s) in the private repo (`gh workflow disable`; reversible with `gh workflow enable`).
Requires: gh (repo + workflow scopes) and vercel CLI logged in to team cmpos.
"""
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time

import requests

TEAM = "cmpos"
OWNER = "mrdahdah"
CRON_REPO = f"{OWNER}/masen-cron"
APPS = [
    # name, vercel project, private repo, secret name in the private repo, Vercel targets, check url, expected, old workflows
    {"name": "nexus", "project": "nexus", "repo": "nexus", "repo_secret": "NEXUS_CRON_SECRET", "cron_secret": "NEXUS_CRON_SECRET",
     "targets": ["production"], "check": "https://nexus-cmpos.vercel.app/api/cron/routines", "expect": 200, "workflows": ["agents-scheduler.yml"]},
    {"name": "lynk", "project": "lynk-masen", "repo": "lynk", "repo_secret": "CRON_SECRET", "cron_secret": "LYNK_CRON_SECRET",
     "targets": ["production"], "check": "https://lynk-masen.vercel.app/api/cron", "expect": "2xx", "workflows": ["research.yml"]},
    {"name": "contyq", "project": "contyq", "repo": "contyq", "repo_secret": "CRON_SECRET", "cron_secret": "CONTYQ_CRON_SECRET",
     "targets": ["production", "preview", "development"], "check": "https://contyq.vercel.app/api/cron/ingest", "expect": "2xx", "workflows": ["ingest-scheduler.yml"]},
    {"name": "vyson", "project": "vyson", "repo": "vyson", "repo_secret": "CRON_SECRET", "cron_secret": "VYSON_CRON_SECRET",
     "targets": ["production", "preview"], "check": "https://vyson.vercel.app/api/cron/projections", "expect": 200, "workflows": ["scheduler.yml"]},
    {"name": "reach", "project": "masen-reach", "repo": "masen-reach", "repo_secret": "REACH_CRON_SECRET", "cron_secret": "REACH_CRON_SECRET",
     "targets": ["production", "preview"], "check": "https://masen-reach.vercel.app/api/cron/ai-check", "expect": 200, "workflows": ["autopilot.yml", "ai-check.yml", "uptime.yml"]},
]

APPLY = "--apply" in sys.argv
ONLY = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--only=")), None)


TRANSIENT = ("timeout", "tls handshake", "connection reset", "eof", "temporarily", "502", "503", "504")


def sh(args, stdin=None, cwd=None, timeout=600, tries=5):
    """Run a CLI; transient network failures (flaky TLS from this machine) are retried with backoff."""
    for attempt in range(1, tries + 1):
        try:
            r = subprocess.run(args, input=stdin, cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=timeout, shell=os.name == "nt")
            rc, out = r.returncode, (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired:
            rc, out = 124, "timeout"
        if rc == 0 or attempt == tries or not any(t in out.lower() for t in TRANSIENT):
            return rc, out
        time.sleep(10 * attempt)
    return rc, out


def vercel_project_dir(project: str) -> str:
    d = tempfile.mkdtemp(prefix=f"cron-{project}-")
    rc, out = sh(["vercel", "link", "--yes", "--project", project, "--scope", TEAM], cwd=d)
    if rc:
        raise RuntimeError(f"vercel link {project}: {out[-200:]}")
    return d


def latest_production_url(cwd: str, project: str) -> str:
    rc, out = sh(["vercel", "ls", project, "--prod", "--scope", TEAM], cwd=cwd)
    for tok in out.split():
        if tok.startswith("https://") and tok.endswith(".vercel.app"):
            return tok
    raise RuntimeError(f"no production deployment found for {project}")


def ok(status: int, expect) -> bool:
    return status == expect if isinstance(expect, int) else 200 <= status < 300


def migrate(app: dict) -> None:
    print(f"\n== {app['name']} (Vercel {app['project']}, repo {OWNER}/{app['repo']})")
    plan = [
        f"new CRON_SECRET -> Vercel {app['project']} {app['targets']}",
        f"-> GitHub secret {app['repo_secret']} in {OWNER}/{app['repo']} and {app['cron_secret']} in {CRON_REPO}",
        f"redeploy current production of {app['project']}, then GET {app['check']} expects {app['expect']}",
        f"disable {', '.join(app['workflows'])} in {OWNER}/{app['repo']}",
    ]
    for p in plan:
        print("   ", p)
    if not APPLY:
        return
    new = secrets.token_urlsafe(32)
    d = vercel_project_dir(app["project"])
    for target in app["targets"]:
        sh(["vercel", "env", "rm", "CRON_SECRET", target, "--yes", "--scope", TEAM], cwd=d)
        # --yes: a project with branch-scoped Preview vars otherwise prompts for a Git branch (default = all branches)
        rc, out = sh(["vercel", "env", "add", "CRON_SECRET", target, "--yes", "--scope", TEAM] + (["--sensitive"] if target != "development" else []),
                     stdin=new, cwd=d)
        if rc:
            raise RuntimeError(f"vercel env add {target}: {out[-200:]}")
        print(f"    Vercel CRON_SECRET [{target}] set")
    for repo, name in ((f"{OWNER}/{app['repo']}", app["repo_secret"]), (CRON_REPO, app["cron_secret"])):
        rc, out = sh(["gh", "secret", "set", name, "-R", repo], stdin=new)
        if rc:
            raise RuntimeError(f"gh secret set {name} {repo}: {out[-200:]}")
        print(f"    GitHub secret {name} set in {repo}")
    url = latest_production_url(d, app["project"])
    rc, out = sh(["vercel", "redeploy", url, "--target", "production", "--scope", TEAM], cwd=d, timeout=1200)
    if rc:
        raise RuntimeError(f"vercel redeploy: {out[-300:]}")
    print("    production redeployed")
    status = None
    for attempt in range(12):
        try:
            status = requests.get(app["check"], headers={"authorization": f"Bearer {new}", "user-agent": "masen-cron-migrate"}, timeout=120).status_code
        except requests.RequestException:
            status = None
        if status is not None and ok(status, app["expect"]):
            print(f"    check {status} with the new secret")
            break
        time.sleep(20)
    else:
        raise RuntimeError(f"check still {status} after redeploy — old schedules left enabled")
    for wf in app["workflows"]:
        rc, out = sh(["gh", "workflow", "disable", wf, "-R", f"{OWNER}/{app['repo']}"])
        print(f"    {wf}: {'disabled' if rc == 0 else 'NOT disabled: ' + out[-120:]}")


def main() -> None:
    print("DRY RUN (nothing changes; add --apply)" if not APPLY else "APPLY")
    for app in APPS:
        if ONLY and app["name"] != ONLY:
            continue
        try:
            migrate(app)
        except Exception as e:  # noqa: BLE001
            print(f"    FAILED: {e}\n    stopped; the remaining apps are untouched")
            sys.exit(1)


if __name__ == "__main__":
    main()
