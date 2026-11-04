#!/usr/bin/env python3
"""Publish a verified CI artifact, never replace an existing release asset.

Uses gh's normal GITHUB_TOKEN/GH_TOKEN authentication. Importing this module has
no side effects. All remote writes are confined to Publisher.publish().
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote
import zipfile


class ReleaseError(RuntimeError):
    """An artifact, remote conflict, or GitHub request prevented publication."""


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


class Artifact:
    def __init__(self, directory, sha, version=None, tag=None, run_number=None):
        self.directory = Path(directory).resolve()
        if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
            raise ReleaseError("Release SHA must be a full lowercase commit SHA")
        metadata_path = self.directory / "release.json"
        try:
            metadata = json.loads(metadata_path.read_text())
        except (OSError, ValueError) as error:
            raise ReleaseError("Cannot read release.json") from error
        if not isinstance(metadata, dict):
            raise ReleaseError("release.json must contain an object")
        self.version = metadata.get("version", "")
        if not isinstance(self.version, str) or not re.fullmatch(
            r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.[1-9][0-9]*",
            self.version,
        ):
            raise ReleaseError("Release version must have four numeric components")
        if any(int(part) > 65535 for part in self.version.split(".")):
            raise ReleaseError("Release version components must not exceed 65535")
        if run_number is not None and str(run_number) != self.version.split(".")[-1]:
            raise ReleaseError("Release version does not match this workflow run number")
        self.tag = "v" + self.version
        self.sha = sha
        if metadata.get("sha") != sha or metadata.get("tag") != self.tag:
            raise ReleaseError("Release metadata SHA or tag does not match this build")
        if (version is not None and version != self.version) or (
            tag is not None and tag != self.tag
        ):
            raise ReleaseError("Requested version or tag does not match release.json")
        archive_name = f"floating-video-toolkit-{self.version}.zip"
        if metadata.get("archive") != archive_name:
            raise ReleaseError("Unexpected release archive filename")
        archive = self.directory / archive_name
        checksum = self.directory / (archive_name + ".sha256")
        install = self.directory / "INSTALL.md"
        self.files = [archive, checksum, metadata_path, install]
        for path in self.files:
            if path.is_symlink() or not path.is_file():
                raise ReleaseError(f"Missing or unsafe release asset: {path.name}")
        self.hashes = {path.name: sha256(path) for path in self.files}
        digest = self.hashes[archive_name]
        if metadata.get("sha256") != digest:
            raise ReleaseError("Archive does not match the release.json checksum")
        if checksum.read_text() != f"{digest}  {archive_name}\n":
            raise ReleaseError("Archive checksum file does not match the archive")
        try:
            with zipfile.ZipFile(archive) as package:
                names = package.namelist()
                if names.count("manifest.json") != 1:
                    raise ReleaseError("Archive must contain exactly one root manifest.json")
                manifest = json.loads(package.read("manifest.json"))
                if not isinstance(manifest, dict) or manifest.get("version") != self.version:
                    raise ReleaseError("Embedded manifest version does not match the release")
                if names.count("INSTALL.md") != 1 or package.read("INSTALL.md") != install.read_bytes():
                    raise ReleaseError("Archive installation instructions do not match INSTALL.md")
                if package.testzip() is not None:
                    raise ReleaseError("Release archive failed its integrity check")
        except (OSError, ValueError, zipfile.BadZipFile) as error:
            raise ReleaseError("Invalid release archive") from error
        identity = {"sha": self.sha, "tag": self.tag, "assets": self.hashes}
        self.marker = "<!-- fvt-ci-release " + json.dumps(identity, sort_keys=True) + " -->"

    def notes(self):
        return (
            f"Floating Video Toolkit {self.version}\n\n"
            f"Built and tested from commit `{self.sha}`.\n\n"
            "Download the versioned ZIP below and extract it into a folder you will keep. "
            "In Chrome open `chrome://extensions`, or in Edge open `edge://extensions`. "
            "Enable **Developer mode**, choose **Load unpacked**, and select the folder "
            "containing `manifest.json`. See the attached INSTALL.md for update steps.\n\n"
            "This is an unpacked Chromium extension, not a Chrome Web Store install or "
            "a signed CRX. GitHub's automatic source-code archives are not the install package.\n\n"
            + self.marker
        )


class GitHub:
    """Small subprocess boundary, mocked by the release safety tests."""

    def run(self, args, *, payload=None, allow_missing=False):
        result = subprocess.run(
            ["gh", *args],
            input=None if payload is None else json.dumps(payload),
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode:
            # Do not mistake authentication, connectivity, or rate-limit failures
            # for a missing release and attempt to create one.
            if allow_missing and re.search(r"\bHTTP 404\b", result.stderr):
                return None
            raise ReleaseError(f"GitHub command failed: {result.stderr.strip()}")
        return result.stdout

    def api(self, endpoint, *, method="GET", payload=None, allow_missing=False, paginate=False):
        args = ["api", endpoint, "--method", method, "-H", "X-GitHub-Api-Version: 2022-11-28"]
        if payload is not None:
            args += ["--input", "-"]
        if paginate:
            args += ["--paginate", "--slurp"]
        output = self.run(args, payload=payload, allow_missing=allow_missing)
        if output is None:
            return None
        if method == "DELETE" and not output.strip():
            return None
        try:
            return json.loads(output)
        except ValueError as error:
            raise ReleaseError("GitHub returned invalid JSON") from error


class Publisher:
    def __init__(self, artifact, repo, github=None):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo or ""):
            raise ReleaseError("Repository must be OWNER/REPO")
        self.artifact = artifact
        self.repo = repo
        self.base = "repos/" + repo
        self.gh = github or GitHub()

    def find_release(self):
        release = self.gh.api(
            f"{self.base}/releases/tags/{self.artifact.tag}", allow_missing=True
        )
        if release is not None:
            return release
        # The by-tag endpoint documents published releases only. List drafts
        # as well, so an interrupted upload is resumed rather than duplicated.
        pages = self.gh.api(f"{self.base}/releases?per_page=100", paginate=True)
        matches = [
            release for page in pages for release in page
            if release.get("tag_name") == self.artifact.tag
        ]
        if len(matches) > 1:
            raise ReleaseError("Multiple releases exist for this tag")
        return matches[0] if matches else None

    def verify_tag(self, *, allow_missing=False):
        reference = self.gh.api(
            f"{self.base}/git/ref/tags/{self.artifact.tag}", allow_missing=allow_missing
        )
        if reference is None:
            return False
        obj = reference.get("object", {})
        # Peel annotated tags, with a bound to fail closed on invalid graphs.
        for _ in range(10):
            if obj.get("type") == "commit":
                if obj.get("sha") != self.artifact.sha:
                    raise ReleaseError("Release tag points to a different commit")
                return True
            if obj.get("type") != "tag" or not re.fullmatch(r"[0-9a-f]{40}", obj.get("sha", "")):
                break
            obj = self.gh.api(f"{self.base}/git/tags/{obj['sha']}").get("object", {})
        raise ReleaseError("Release tag does not resolve to a commit")

    def verify_release(self, release):
        if release.get("tag_name") != self.artifact.tag or release.get("prerelease") is not False:
            raise ReleaseError("Release tag or prerelease status conflicts with this build")
        if type(release.get("id")) is not int or type(release.get("draft")) is not bool:
            raise ReleaseError("Invalid release response")
        if release["draft"]:
            if release.get("target_commitish") != self.artifact.sha:
                raise ReleaseError("Draft release targets a different commit")
            if self.artifact.marker not in (release.get("body") or "").splitlines():
                raise ReleaseError("Draft release was not created for this exact artifact")

    def verify_assets(self, release, *, allow_missing):
        pages = self.gh.api(
            f"{self.base}/releases/{release['id']}/assets?per_page=100", paginate=True
        )
        remote = {}
        starters = []
        for page in pages:
            for asset in page:
                name = asset.get("name")
                if name not in self.artifact.hashes or name in remote:
                    raise ReleaseError(f"Unexpected or duplicate release asset: {name}")
                if asset.get("state") != "uploaded":
                    if (allow_missing and release["draft"] and asset.get("state") == "starter"
                            and asset.get("size") == 0 and type(asset.get("id")) is int):
                        starters.append(asset)
                    else:
                        raise ReleaseError(f"Release asset upload is incomplete: {name}")
                remote[name] = asset
        for path in self.artifact.files:
            asset = remote.get(path.name)
            if asset is None or asset in starters:
                continue
            if asset.get("size") != path.stat().st_size:
                raise ReleaseError(f"Existing release asset differs: {path.name}")
            digest = asset.get("digest")
            expected = "sha256:" + self.artifact.hashes[path.name]
            if digest is None:
                # Older assets can lack a server-side digest. Verify actual bytes
                # instead of trusting a matching filename or size.
                with tempfile.TemporaryDirectory(prefix="fvt-release-") as directory:
                    self.gh.run([
                        "release", "download", self.artifact.tag, "--repo", self.repo,
                        "--pattern", path.name, "--dir", directory,
                    ])
                    downloaded = Path(directory) / path.name
                    if not downloaded.is_file() or sha256(downloaded) != self.artifact.hashes[path.name]:
                        raise ReleaseError(f"Existing release asset differs: {path.name}")
            elif digest != expected:
                raise ReleaseError(f"Existing release asset differs: {path.name}")
        # GitHub can leave a zero-byte `starter` after a failed upload. Only
        # clean these up on our matching draft, after checking every other
        # asset for conflicts. Published/complete assets are never removed.
        for asset in starters:
            fresh = self.gh.api(f"{self.base}/releases/{release['id']}")
            self.verify_release(fresh)
            if not fresh["draft"]:
                raise ReleaseError("Release was published before incomplete asset recovery")
            endpoint = f"{self.base}/releases/assets/{asset['id']}"
            current = self.gh.api(endpoint)
            if any(current.get(key) != asset.get(key) for key in ("id", "name", "state", "size")):
                raise ReleaseError("Incomplete asset changed before recovery")
            self.gh.api(endpoint, method="DELETE")
            del remote[asset["name"]]
        missing = [path for path in self.artifact.files if path.name not in remote]
        if missing and not allow_missing:
            raise ReleaseError("Published release is missing required assets")
        return missing

    def is_default_branch_head(self):
        repository = self.gh.api(self.base)
        branch = repository.get("default_branch")
        if not isinstance(branch, str) or not branch:
            raise ReleaseError("Cannot determine the repository default branch")
        reference = self.gh.api(f"{self.base}/git/ref/heads/{quote(branch, safe='')}")
        obj = reference.get("object", {})
        if obj.get("type") != "commit" or not re.fullmatch(r"[0-9a-f]{40}", obj.get("sha", "")):
            raise ReleaseError("Cannot determine the default branch head")
        return obj["sha"] == self.artifact.sha

    def publish(self):
        release = self.find_release()
        tag_exists = self.verify_tag(allow_missing=True)
        if release is not None:
            self.verify_release(release)
            if not tag_exists:
                raise ReleaseError("Existing release is missing its tag; refusing to repair it")
            if not release["draft"]:
                self.verify_assets(release, allow_missing=False)
                print(f"Verified existing release {self.artifact.tag}; no changes made")
                return release
        else:
            if not tag_exists:
                self.gh.api(
                    f"{self.base}/git/refs", method="POST",
                    payload={"ref": "refs/tags/" + self.artifact.tag, "sha": self.artifact.sha},
                )
                self.verify_tag()
            release = self.gh.api(
                f"{self.base}/releases", method="POST", payload={
                    "tag_name": self.artifact.tag,
                    "target_commitish": self.artifact.sha,
                    "name": "Floating Video Toolkit " + self.artifact.version,
                    "body": self.artifact.notes(), "draft": True,
                    "prerelease": False, "make_latest": "false",
                },
            )
            self.verify_release(release)
            if not release["draft"]:
                raise ReleaseError("New release was unexpectedly published before asset verification")
        missing = self.verify_assets(release, allow_missing=True)
        if missing:
            # Never use --clobber: a racing upload must fail rather than replace
            # bytes, even on a draft. A later rerun verifies any partial uploads.
            self.gh.run([
                "release", "upload", self.artifact.tag,
                *[str(path) for path in missing], "--repo", self.repo,
            ])
        release_path = f"{self.base}/releases/{release['id']}"
        release = self.gh.api(release_path)
        self.verify_release(release)
        self.verify_assets(release, allow_missing=False)
        self.verify_tag()
        if release["draft"]:
            # Checking immediately before publish prevents a delayed old run
            # from intentionally taking Latest from the current default head.
            latest = self.is_default_branch_head()
            self.gh.api(
                release_path, method="PATCH",
                payload={"draft": False, "make_latest": "true" if latest else "false"},
            )
        final = self.gh.api(release_path)
        self.verify_release(final)
        if final["draft"]:
            raise ReleaseError("Release is still a draft after publication")
        self.verify_tag()
        self.verify_assets(final, allow_missing=False)
        print(f"Published and verified {self.artifact.tag} from {self.artifact.sha}")
        return final


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", default=os.environ.get("RELEASE_ARTIFACT_DIR", "dist"))
    parser.add_argument("--repo", default=os.environ.get("RELEASE_REPOSITORY", os.environ.get("GITHUB_REPOSITORY")))
    parser.add_argument("--sha", default=os.environ.get("RELEASE_SHA", os.environ.get("GITHUB_SHA")))
    parser.add_argument("--version", default=os.environ.get("RELEASE_VERSION"))
    parser.add_argument("--tag", default=os.environ.get("RELEASE_TAG"))
    parser.add_argument("--run-number", default=os.environ.get("GITHUB_RUN_NUMBER"))
    args = parser.parse_args(argv)
    try:
        if not args.run_number or not re.fullmatch(r"[1-9][0-9]*", args.run_number):
            raise ReleaseError("A positive workflow --run-number / GITHUB_RUN_NUMBER is required")
        artifact = Artifact(args.artifact_dir, args.sha, args.version, args.tag, args.run_number)
        Publisher(artifact, args.repo).publish()
    except (ReleaseError, OSError) as error:
        print(f"Release publication stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
