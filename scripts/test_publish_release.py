"""Publication regression tests. Every gh invocation is mocked; no network writes."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).resolve().with_name("publish-release.py")
SPEC = importlib.util.spec_from_file_location("publish_release", SCRIPT)
publish = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publish)

SHA = "a" * 40
OTHER_SHA = "b" * 40
VERSION = "1.22.2.123"
TAG = "v" + VERSION
REPO = "example/floating-video-toolkit"
BASE = "repos/" + REPO


class FakeGitHub:
    """Stateful subprocess replacement exercising the actual CLI boundary."""

    def __init__(self, artifact):
        self.artifact = artifact
        self.release = None
        self.tag_object = None
        self.annotated = {}
        self.assets = {}
        self.head = SHA
        self.default_branch = "main"
        self.calls = []
        self.mutations = []
        self.upload_failure = False
        self.failure = None
        self.stay_draft = False

    def install_release(self, *, draft=False, owned=True, complete=True):
        self.tag_object = {"type": "commit", "sha": SHA}
        self.release = {
            "id": 42, "tag_name": TAG, "target_commitish": SHA,
            "body": self.artifact.notes() if owned else "Created by someone else",
            "draft": draft, "prerelease": False,
        }
        if complete:
            for path in self.artifact.files:
                self.assets[path.name] = self.asset(path)

    @staticmethod
    def asset(path):
        data = path.read_bytes()
        return {
            "id": sum(path.name.encode()), "name": path.name, "size": len(data), "state": "uploaded",
            "digest": "sha256:" + hashlib.sha256(data).hexdigest(), "data": data,
        }

    @staticmethod
    def result(args, payload=None, *, error=None):
        return subprocess.CompletedProcess(
            args, int(error is not None),
            "" if payload is None else json.dumps(payload), error or "",
        )

    def __call__(self, args, *, input, text, capture_output, check):
        self.calls.append(args)
        assert args[0] == "gh" and text and capture_output and not check
        if self.failure:
            return self.result(args, error=self.failure)
        if args[1:3] == ["release", "download"]:
            name = args[args.index("--pattern") + 1]
            directory = args[args.index("--dir") + 1]
            (Path(directory) / name).write_bytes(self.assets[name]["data"])
            return self.result(args)
        if args[1:3] == ["release", "upload"]:
            assert self.release["draft"], "Published assets must never be changed"
            assert "--clobber" not in args
            self.mutations.append(("upload", args))
            paths = args[4:args.index("--repo")]
            for name in paths:
                path = Path(name)
                assert path.name not in self.assets, "Existing assets must not be replaced"
                self.assets[path.name] = self.asset(path)
                if self.upload_failure:
                    self.upload_failure = False
                    return self.result(args, error="connection lost during upload")
            return self.result(args)
        assert args[1] == "api", args
        endpoint = args[2]
        method = args[args.index("--method") + 1]
        payload = json.loads(input) if input else None
        if method != "GET":
            self.mutations.append((method, endpoint, payload))
        if endpoint == BASE + "/git/refs" and method == "POST":
            assert payload == {"ref": "refs/tags/" + TAG, "sha": SHA}
            assert self.tag_object is None
            self.tag_object = {"type": "commit", "sha": payload["sha"]}
            return self.result(args, {"object": self.tag_object})
        if endpoint == BASE + "/git/ref/tags/" + TAG:
            return self.result(args, {"object": self.tag_object}) if self.tag_object else self.result(args, error="gh: Not Found (HTTP 404)")
        if endpoint.startswith(BASE + "/git/tags/"):
            return self.result(args, {"object": self.annotated[endpoint.rsplit("/", 1)[1]]})
        if endpoint == BASE + "/releases/tags/" + TAG:
            if self.release and not self.release["draft"]:
                return self.result(args, self.release)
            return self.result(args, error="gh: Not Found (HTTP 404)")
        if endpoint == BASE + "/releases?per_page=100":
            assert "--paginate" in args and "--slurp" in args
            # A draft on a later page must still be discovered.
            return self.result(args, [[], [self.release] if self.release else []])
        if endpoint == BASE + "/releases" and method == "POST":
            assert self.release is None
            assert payload["draft"] is True
            assert payload["make_latest"] == "false"
            self.release = {"id": 42, **payload}
            return self.result(args, self.release)
        if endpoint == BASE + "/releases/42":
            if method == "PATCH":
                self.release.update(payload)
                if self.stay_draft:
                    self.release["draft"] = True
            return self.result(args, self.release)
        if endpoint == BASE + "/releases/42/assets?per_page=100":
            assert "--paginate" in args and "--slurp" in args
            assets = [{key: value for key, value in asset.items() if key != "data"} for asset in self.assets.values()]
            return self.result(args, [assets])
        if endpoint.startswith(BASE + "/releases/assets/"):
            asset_id = int(endpoint.rsplit("/", 1)[1])
            asset = next(asset for asset in self.assets.values() if asset["id"] == asset_id)
            if method == "DELETE":
                assert self.release["draft"] and asset["state"] == "starter" and asset["size"] == 0
                del self.assets[asset["name"]]
                return self.result(args)
            return self.result(args, {key: value for key, value in asset.items() if key != "data"})
        if endpoint == BASE:
            return self.result(args, {"default_branch": self.default_branch})
        if endpoint == BASE + "/git/ref/heads/" + self.default_branch.replace("/", "%2F"):
            return self.result(args, {"object": {"type": "commit", "sha": self.head}})
        raise AssertionError(f"Unexpected gh request: {args}")


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.archive = self.directory / f"floating-video-toolkit-{VERSION}.zip"
        self.install = b"Extract ZIP, enable Developer mode, and Load unpacked.\n"
        (self.directory / "INSTALL.md").write_bytes(self.install)
        self.write_archive()
        self.artifact = self.load()
        self.fake = FakeGitHub(self.artifact)
        self.mock_run = patch.object(publish.subprocess, "run", side_effect=self.fake).start()
        self.addCleanup(patch.stopall)

    def write_archive(self, manifest_version=VERSION, duplicate=False):
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"manifest_version": 3, "version": manifest_version}))
            archive.writestr("INSTALL.md", self.install)
            if duplicate:
                archive.writestr("manifest.json", "{}")
        self.write_metadata()

    def write_metadata(self, **overrides):
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.metadata = {"version": VERSION, "tag": TAG, "sha": SHA, "archive": self.archive.name, "sha256": digest, **overrides}
        (self.directory / "release.json").write_text(json.dumps(self.metadata))
        self.archive.with_suffix(".zip.sha256").write_text(f"{digest}  {self.archive.name}\n")

    def load(self, **kwargs):
        return publish.Artifact(self.directory, SHA, **kwargs)

    def run_publish(self):
        return publish.Publisher(self.artifact, REPO).publish()

    def assert_conflict_without_writes(self, pattern):
        with self.assertRaisesRegex(publish.ReleaseError, pattern):
            self.run_publish()
        self.assertEqual(self.fake.mutations, [])

    def test_new_release_uses_exact_commit_and_uploads_before_publish(self):
        result = self.run_publish()
        self.assertFalse(result["draft"])
        self.assertEqual(self.fake.tag_object["sha"], SHA)
        self.assertEqual(set(self.fake.assets), set(self.artifact.hashes))
        self.assertEqual([call[0] for call in self.fake.mutations], ["POST", "POST", "upload", "PATCH"])
        self.assertEqual(self.fake.mutations[-1][2], {"draft": False, "make_latest": "true"})

    def test_old_merge_publishes_without_replacing_latest(self):
        self.fake.head = OTHER_SHA
        self.run_publish()
        self.assertEqual(self.fake.mutations[-1][2]["make_latest"], "false")

    def test_current_default_branch_is_looked_up_instead_of_assumed(self):
        self.fake.default_branch = "release/main"
        self.run_publish()
        self.assertEqual(self.fake.mutations[-1][2]["make_latest"], "true")

    def test_matching_published_release_is_read_only(self):
        self.fake.install_release()
        self.run_publish()
        self.assertEqual(self.fake.mutations, [])

    def test_rerun_after_publication_is_read_only(self):
        self.run_publish()
        self.fake.mutations.clear()
        self.run_publish()
        self.assertEqual(self.fake.mutations, [])

    def test_matching_draft_is_resumed_with_only_missing_assets(self):
        self.fake.install_release(draft=True, complete=False)
        path = self.artifact.files[0]
        self.fake.assets[path.name] = self.fake.asset(path)
        self.run_publish()
        upload = next(call[1] for call in self.fake.mutations if call[0] == "upload")
        self.assertNotIn(str(path), upload)
        self.assertEqual([call[0] for call in self.fake.mutations], ["upload", "PATCH"])

    def test_interrupted_upload_remains_draft_and_rerun_completes(self):
        self.fake.upload_failure = True
        with self.assertRaisesRegex(publish.ReleaseError, "connection lost"):
            self.run_publish()
        self.assertTrue(self.fake.release["draft"])
        self.assertEqual(len(self.fake.assets), 1)
        self.run_publish()
        self.assertFalse(self.fake.release["draft"])
        self.assertEqual(len(self.fake.assets), 4)

    def test_unowned_draft_is_not_modified(self):
        self.fake.install_release(draft=True, owned=False)
        self.assert_conflict_without_writes("not created for this exact artifact")

    def test_draft_target_sha_must_match(self):
        self.fake.install_release(draft=True)
        self.fake.release["target_commitish"] = OTHER_SHA
        self.assert_conflict_without_writes("targets a different commit")

    def test_wrong_tag_commit_is_never_retargeted(self):
        self.fake.tag_object = {"type": "commit", "sha": OTHER_SHA}
        self.assert_conflict_without_writes("different commit")

    def test_published_release_wrong_tag_is_not_reused(self):
        self.fake.install_release()
        self.fake.tag_object = {"type": "commit", "sha": OTHER_SHA}
        self.assert_conflict_without_writes("different commit")

    def test_missing_tag_on_existing_release_is_not_repaired(self):
        self.fake.install_release(draft=True)
        self.fake.tag_object = None
        self.assert_conflict_without_writes("missing its tag")

    def test_annotated_tag_is_peeled_before_reuse(self):
        self.fake.install_release()
        self.fake.tag_object = {"type": "tag", "sha": OTHER_SHA}
        self.fake.annotated[OTHER_SHA] = {"type": "commit", "sha": SHA}
        self.run_publish()
        self.assertEqual(self.fake.mutations, [])

    def test_published_asset_hash_conflict_is_not_overwritten(self):
        self.fake.install_release()
        self.fake.assets[self.archive.name]["digest"] = "sha256:" + "0" * 64
        self.assert_conflict_without_writes("asset differs")

    def test_draft_asset_hash_conflict_is_not_overwritten(self):
        self.fake.install_release(draft=True)
        self.fake.assets[self.archive.name]["digest"] = "sha256:" + "0" * 64
        self.assert_conflict_without_writes("asset differs")

    def test_published_missing_asset_fails_without_repair(self):
        self.fake.install_release()
        del self.fake.assets[self.archive.name]
        self.assert_conflict_without_writes("missing required assets")

    def test_unexpected_asset_fails_closed(self):
        self.fake.install_release(draft=True)
        self.fake.assets["surprise"] = {"name": "surprise", "state": "uploaded"}
        self.assert_conflict_without_writes("Unexpected or duplicate")

    def test_incomplete_asset_is_not_treated_as_success(self):
        self.fake.install_release(draft=True)
        self.fake.assets[self.archive.name]["state"] = "starter"
        self.assert_conflict_without_writes("upload is incomplete")

    def test_empty_starter_on_matching_draft_is_recovered(self):
        self.fake.install_release(draft=True)
        asset = self.fake.assets[self.archive.name]
        asset.update(state="starter", size=0, digest=None, data=b"")
        self.run_publish()
        self.assertEqual([call[0] for call in self.fake.mutations], ["DELETE", "upload", "PATCH"])
        self.assertEqual(self.fake.assets[self.archive.name]["state"], "uploaded")

    def test_published_starter_is_never_deleted(self):
        self.fake.install_release()
        self.fake.assets[self.archive.name].update(state="starter", size=0)
        self.assert_conflict_without_writes("upload is incomplete")

    def test_conflicting_draft_asset_blocks_starter_cleanup(self):
        self.fake.install_release(draft=True)
        self.fake.assets[self.archive.name].update(state="starter", size=0)
        self.fake.assets["INSTALL.md"]["digest"] = "sha256:" + "0" * 64
        self.assert_conflict_without_writes("asset differs")

    def test_unowned_draft_starter_is_never_deleted(self):
        self.fake.install_release(draft=True, owned=False)
        self.fake.assets[self.archive.name].update(state="starter", size=0)
        self.assert_conflict_without_writes("not created for this exact artifact")

    def test_asset_without_server_digest_is_downloaded_and_verified(self):
        self.fake.install_release()
        self.fake.assets[self.archive.name]["digest"] = None
        self.run_publish()
        self.assertTrue(any(call[1:3] == ["release", "download"] for call in self.fake.calls))
        self.assertEqual(self.fake.mutations, [])

    def test_digestless_corrupt_asset_is_rejected(self):
        self.fake.install_release()
        self.fake.assets[self.archive.name]["digest"] = None
        self.fake.assets[self.archive.name]["data"] = b"corrupt"
        self.assert_conflict_without_writes("asset differs")

    def test_api_permission_failure_is_not_interpreted_as_missing_release(self):
        self.fake.failure = "gh: Forbidden (HTTP 403)"
        self.assert_conflict_without_writes("Forbidden")

    def test_final_publication_state_is_verified(self):
        self.fake.stay_draft = True
        with self.assertRaisesRegex(publish.ReleaseError, "still a draft"):
            self.run_publish()

    def test_corrupt_local_archive_checksum_fails_before_remote_calls(self):
        self.archive.write_bytes(self.archive.read_bytes() + b"changed")
        with self.assertRaisesRegex(publish.ReleaseError, "release.json checksum"):
            self.load()
        self.mock_run.assert_not_called()

    def test_local_checksum_file_is_verified(self):
        self.archive.with_suffix(".zip.sha256").write_text("incorrect\n")
        with self.assertRaisesRegex(publish.ReleaseError, "checksum file"):
            self.load()
        self.mock_run.assert_not_called()

    def test_embedded_version_is_verified(self):
        self.write_archive(manifest_version="1.22.2")
        with self.assertRaisesRegex(publish.ReleaseError, "Embedded manifest version"):
            self.load()

    def test_metadata_sha_must_match_expected_build(self):
        self.write_metadata(sha=OTHER_SHA)
        with self.assertRaisesRegex(publish.ReleaseError, "metadata SHA or tag"):
            self.load()

    def test_version_tag_and_run_number_must_match(self):
        for kwargs in [{"version": "1.22.2.124"}, {"tag": "v1.22.2.124"}, {"run_number": "124"}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(publish.ReleaseError):
                self.load(**kwargs)

    def test_invalid_metadata_versions_are_rejected(self):
        for version in ["1.22.2", "1.22.2.0", "1.22.2.65536", "1.22.02.1", "1.22.2.-1", None]:
            with self.subTest(version=version):
                self.write_metadata(version=version)
                with self.assertRaises(publish.ReleaseError):
                    self.load()

    def test_archive_name_cannot_escape_artifact_directory(self):
        self.write_metadata(archive="../../other.zip")
        with self.assertRaisesRegex(publish.ReleaseError, "archive filename"):
            self.load()

    def test_required_install_document_must_match_zip(self):
        (self.directory / "INSTALL.md").write_text("different instructions")
        with self.assertRaisesRegex(publish.ReleaseError, "installation instructions"):
            self.load()

    def test_main_uses_runtime_environment_without_any_credential_io(self):
        with patch.dict(publish.os.environ, {
            "RELEASE_ARTIFACT_DIR": str(self.directory), "RELEASE_REPOSITORY": REPO,
            "RELEASE_SHA": SHA, "GITHUB_RUN_NUMBER": "123",
        }, clear=True):
            self.assertEqual(publish.main([]), 0)

    def test_main_requires_run_number_before_remote_access(self):
        with patch.dict(publish.os.environ, {}, clear=True):
            self.assertEqual(publish.main(["--artifact-dir", str(self.directory), "--repo", REPO, "--sha", SHA]), 1)
        self.mock_run.assert_not_called()

    def test_actual_packager_output_passes_publisher_validation(self):
        package_spec = importlib.util.spec_from_file_location("release_package_integration", SCRIPT.with_name("package.py"))
        package = importlib.util.module_from_spec(package_spec)
        package_spec.loader.exec_module(package)
        destination = self.directory / "packaged"
        package.build(release_run="123", sha=SHA, output_dir=destination)
        artifact = publish.Artifact(destination, SHA, run_number="123")
        self.assertEqual(artifact.sha, SHA)
        self.assertEqual(len(artifact.files), 4)
        self.mock_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
