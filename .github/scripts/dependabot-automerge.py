#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys


ALLOWED_FILES = {
    "dist/index.js",
    "package-lock.json",
    "package.json",
}
ALLOWED_UPDATE_TYPES = {"minor", "patch"}
DEPENDABOT_LOGIN = "dependabot[bot]"


def gh_json(*args: str):
    output = subprocess.check_output(("gh", *args), text=True)
    return json.loads(output)


def gh_text(*args: str) -> str:
    return subprocess.check_output(("gh", *args), text=True).strip()


def allowed_file(path: str) -> bool:
    return path in ALLOWED_FILES or re.fullmatch(r"\.github/workflows/[^/]+\.ya?ml", path) is not None


def find_dependabot_pr(repo: str, run_id: str, head_sha: str):
    pulls = gh_json("api", f"repos/{repo}/actions/runs/{run_id}/pulls")
    for pull in pulls:
        if (
            pull["user"]["login"] == DEPENDABOT_LOGIN
            and pull["base"]["ref"] == "master"
            and pull["head"]["sha"] == head_sha
            and pull["head"]["repo"]["full_name"] == repo
        ):
            return pull
    return None


def dependabot_update_types(body: str) -> list[str]:
    return re.findall(r"update-type:\s*version-update:semver-([a-z]+)", body)


def main() -> int:
    repo = os.environ["REPO"]
    run_id = os.environ["RUN_ID"]
    head_sha = os.environ["HEAD_SHA"]

    pull = find_dependabot_pr(repo, run_id, head_sha)
    if pull is None:
        print(f"No eligible Dependabot PR is associated with workflow run {run_id}.")
        return 0

    pr = gh_json(
        "pr",
        "view",
        str(pull["number"]),
        "--repo",
        repo,
        "--json",
        "body,files,headRefOid,isDraft,title,url",
    )

    if pr["isDraft"]:
        print(f"Skipping draft PR: {pr['url']}")
        return 0

    unexpected_files = [item["path"] for item in pr["files"] if not allowed_file(item["path"])]
    if unexpected_files:
        print(f"Skipping {pr['url']}; unexpected files: {', '.join(unexpected_files)}")
        return 0

    update_types = dependabot_update_types(pr["body"] or "")
    if not update_types:
        print(f"Skipping {pr['url']}; Dependabot update metadata was not found.")
        return 0

    unsupported_types = sorted(set(update_types) - ALLOWED_UPDATE_TYPES)
    if unsupported_types:
        print(f"Skipping {pr['url']}; unsupported update types: {', '.join(unsupported_types)}")
        return 0

    if pr["headRefOid"] != head_sha:
        print(f"Skipping {pr['url']}; PR head changed from {head_sha} to {pr['headRefOid']}.")
        return 0

    print(f"Merging eligible Dependabot PR: {pr['url']}")
    gh_text(
        "pr",
        "merge",
        str(pull["number"]),
        "--repo",
        repo,
        "--squash",
        "--match-head-commit",
        head_sha,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
