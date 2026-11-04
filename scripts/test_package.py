#!/usr/bin/env python3
"""Isolated packaging regression tests; no GitHub access or npm install required."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name('package.py')
SPEC = importlib.util.spec_from_file_location('extension_package', SCRIPT)
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)
SHA = '0123456789abcdef0123456789abcdef01234567'


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'extension'
        self.root.mkdir()
        self.manifest = {
            'manifest_version': 3, 'name': 'Packaging fixture', 'version': '1.22.2',
            'background': {'service_worker': 'background.js'},
            'options_ui': {'page': 'options.html'},
            'content_scripts': [{'js': ['content.js'], 'css': ['content.css']}],
            'icons': {'16': 'icon16.png'},
            'action': {'default_icon': {'16': 'icon16.png'}},
        }
        self.write_json('manifest.json', self.manifest)
        self.write_json('package.json', {'version': '1.22.2'})
        self.assets = {
            'README.md', 'INSTALL.md', 'docs/PRIVACY.md', 'docs/releases/v1.22.2.md',
            'options.css', 'options.js', 'multi-view.js', 'mixer.html', 'mixer.css',
            'mixer.js', 'background.js', 'options.html', 'content.js', 'content.css',
            'icon16.png',
        }
        for name in self.assets:
            self.write(name, f'fixture: {name}\n'.encode())
        for name in ('scripts/dev.py', 'tests/fixture.txt', 'node_modules/secret.txt',
                     '.git/config', '.github/workflows/ci.yml', 'package-lock.json',
                     '.env', 'test-results/debug.txt', 'playwright-report/index.html'):
            self.write(name, b'not for distribution')

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def write_json(self, name, value):
        self.write(name, (json.dumps(value, indent=2) + '\n').encode())

    def build(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return packager.build(root=self.root, **kwargs)

    def release(self, **kwargs):
        return self.build(release_run=kwargs.pop('release_run', '42'),
                          sha=kwargs.pop('sha', SHA), **kwargs)

    def test_release_metadata_checksum_and_manifest_agree(self):
        before = {name: (self.root / name).read_bytes() for name in ('manifest.json', 'package.json')}
        archive = self.release()
        self.assertEqual(archive.name, 'floating-video-toolkit-1.22.2.42.zip')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        metadata = json.loads((archive.parent / 'release.json').read_text())
        self.assertEqual(metadata, {
            'version': '1.22.2.42', 'tag': 'v1.22.2.42', 'sha': SHA,
            'archive': archive.name, 'sha256': digest,
        })
        self.assertEqual(archive.with_suffix('.zip.sha256').read_text(), f'{digest}  {archive.name}\n')
        with zipfile.ZipFile(archive) as output:
            self.assertIsNone(output.testzip())
            self.assertEqual(set(output.namelist()), self.assets | {'manifest.json'})
            self.assertEqual(output.namelist(), sorted(output.namelist()))
            embedded = json.loads(output.read('manifest.json'))
            self.assertEqual(embedded['version'], metadata['version'])
            self.assertEqual(embedded['version_name'], '1.22.2+build.42')
            self.assertEqual(output.read('INSTALL.md'), (archive.parent / 'INSTALL.md').read_bytes())
            for info in output.infolist():
                self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(info.create_system, 3)
                self.assertEqual(info.external_attr >> 16, 0o100644)
                self.assertNotIn('..', Path(info.filename).parts)
        for name, original in before.items():
            self.assertEqual((self.root / name).read_bytes(), original)

    def test_local_build_keeps_source_manifest_and_omits_release_metadata(self):
        original = (self.root / 'manifest.json').read_bytes()
        archive = self.build()
        self.assertEqual(archive.name, 'floating-video-toolkit-1.22.2.zip')
        with zipfile.ZipFile(archive) as output:
            self.assertEqual(output.read('manifest.json'), original)
        self.assertFalse((archive.parent / 'release.json').exists())
        self.assertTrue((archive.parent / 'INSTALL.md').is_file())

    def test_local_build_removes_stale_release_metadata(self):
        self.release()
        archive = self.build()
        self.assertFalse((archive.parent / 'release.json').exists())

    def test_identical_inputs_produce_identical_zip_and_metadata_bytes(self):
        archive = self.release()
        first = {name: (archive.parent / name).read_bytes() for name in
                 (archive.name, archive.name + '.sha256', 'release.json', 'INSTALL.md')}
        for name in self.assets | {'manifest.json'}:
            os.utime(self.root / name, (1700000000, 1700000000))
            (self.root / name).chmod(0o600)
        self.release()
        for name, data in first.items():
            self.assertEqual((archive.parent / name).read_bytes(), data, name)

    def test_custom_output_directory_does_not_touch_dist(self):
        output = self.root.parent / 'artifacts' / 'nested'
        archive = self.release(output_dir=output)
        self.assertEqual(archive.parent, output)
        self.assertFalse((self.root / 'dist').exists())
        self.assertTrue((output / 'release.json').is_file())

    def test_release_run_changes_version_and_bytes(self):
        one = self.release(release_run=1)
        first = one.read_bytes()
        two = self.release(release_run=2)
        self.assertNotEqual(one.name, two.name)
        self.assertNotEqual(first, two.read_bytes())

    def test_matching_package_version_is_required(self):
        self.write_json('package.json', {'version': '1.22.3'})
        with self.assertRaisesRegex(ValueError, 'must agree'):
            self.release()
        self.assertFalse((self.root / 'dist').exists())

    def test_invalid_base_versions_are_rejected_before_writing(self):
        for value in ('1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta',
                      '-1.2.3', '+1.2.3', '1.2.65536', '65536.2.3', '0.0.0',
                      '1.2.3\n', '１.2.3', '1.2. 3', '', None, 123,
                      '9' * 5000 + '.2.3'):
            with self.subTest(value=str(value)[:40]):
                self.manifest['version'] = value
                self.write_json('manifest.json', self.manifest)
                self.write_json('package.json', {'version': value})
                with self.assertRaises(ValueError):
                    self.release()
                self.assertFalse((self.root / 'dist').exists())

    def test_valid_version_boundaries(self):
        self.assertEqual(packager.release_version('0.0.1', 1), '0.0.1.1')
        self.assertEqual(packager.release_version('65535.65535.65535', '65535'),
                         '65535.65535.65535.65535')

    def test_invalid_release_runs_do_not_wrap(self):
        for run in ('0', '-1', '+1', '01', '1.0', '1\n', ' 1', '65536', 65536,
                    1000000, True, False, 1.0, '', '9' * 5000):
            with self.subTest(run=str(run)[:40]):
                with self.assertRaises(ValueError):
                    self.release(release_run=run)
                self.assertFalse((self.root / 'dist').exists())

    def test_release_metadata_arguments_are_required_together(self):
        for kwargs in ({'release_run': 42}, {'sha': SHA}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaisesRegex(ValueError, 'supplied together'):
                    self.build(**kwargs)
        self.assertFalse((self.root / 'dist').exists())

    def test_invalid_commit_shas_are_rejected(self):
        for sha in ('', 'abc1234', 'g' * 40, 'a' * 39, 'a' * 41, 'a' * 40 + '\n', 42):
            with self.subTest(sha=sha):
                with self.assertRaisesRegex(ValueError, '40-character'):
                    self.release(sha=sha)
        self.assertFalse((self.root / 'dist').exists())

    def test_uppercase_commit_sha_is_canonicalized(self):
        archive = self.release(sha=SHA.upper())
        metadata = json.loads((archive.parent / 'release.json').read_text())
        self.assertEqual(metadata['sha'], SHA)

    def test_missing_required_asset_is_rejected(self):
        (self.root / 'INSTALL.md').unlink()
        with self.assertRaisesRegex(ValueError, 'INSTALL.md'):
            self.release()
        self.assertFalse((self.root / 'dist').exists())

    def test_unsafe_or_development_manifest_references_are_rejected(self):
        for name in ('../escape.js', '/tmp/escape.js', './content.js', 'docs//PRIVACY.md',
                     'docs/../content.js', 'docs\\PRIVACY.md', '', '.env',
                     'node_modules/secret.txt', 'scripts/dev.py', 'package.json',
                     '.github/workflows/ci.yml', 'tests/fixture.txt', 'not-present.js'):
            with self.subTest(name=name):
                self.manifest['background']['service_worker'] = name
                self.write_json('manifest.json', self.manifest)
                with self.assertRaises(ValueError):
                    self.release()
                self.assertFalse((self.root / 'dist').exists())

    def test_symlink_assets_are_rejected(self):
        (self.root / 'content.js').unlink()
        (self.root / 'content.js').symlink_to(self.root / 'background.js')
        with self.assertRaisesRegex(ValueError, 'content.js'):
            self.release()

    def test_symlink_directories_are_rejected(self):
        (self.root / 'assets').symlink_to(self.root / 'docs', target_is_directory=True)
        self.manifest['background']['service_worker'] = 'assets/PRIVACY.md'
        self.write_json('manifest.json', self.manifest)
        with self.assertRaisesRegex(ValueError, 'assets/PRIVACY.md'):
            self.release()

    def test_cli_rejects_invalid_release_metadata(self):
        output = self.root.parent / 'cli-dist'
        result = subprocess.run([sys.executable, str(SCRIPT), '--release-run', '65536',
                                 '--sha', SHA, '--output-dir', str(output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('cannot wrap', result.stderr)
        self.assertFalse(output.exists())

    def test_cli_packages_actual_extension_with_output_override(self):
        output = self.root.parent / 'real-release'
        result = subprocess.run([sys.executable, str(SCRIPT), '--release-run', '42',
                                 '--sha', SHA, '--output-dir', str(output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        metadata = json.loads((output / 'release.json').read_text())
        with zipfile.ZipFile(output / metadata['archive']) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['version'], metadata['version'])
            self.assertIn('INSTALL.md', archive.namelist())
            self.assertIn('docs/PRIVACY.md', archive.namelist())
            for path in manifest['content_scripts'][0]['js']:
                self.assertIn(path, archive.namelist())
            self.assertIn(manifest['background']['service_worker'], archive.namelist())
            self.assertNotIn('package.json', archive.namelist())
            self.assertFalse(any(part in packager.EXCLUDED_PARTS
                                 for name in archive.namelist() for part in Path(name).parts))


if __name__ == '__main__':
    unittest.main()
