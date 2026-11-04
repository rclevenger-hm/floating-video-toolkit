#!/usr/bin/env python3
"""Build a deterministic unpacked-extension ZIP without development files.

Local builds keep the checked-in version. CI release builds append the workflow
run number, without changing the source manifest or npm package version.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MAX_COMPONENT = 65535
BASE_VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")
EXCLUDED_PARTS = {'.git', '.github', 'node_modules', 'scripts', 'tests', 'dist',
                  'test-results', 'playwright-report', '__pycache__'}


def release_version(base, run):
    """Validate Chrome's numeric version limits before creating any artifacts."""
    if not isinstance(base, str) or not BASE_VERSION.fullmatch(base):
        raise ValueError('Base version must have exactly three canonical numeric components')
    components = base.split('.')
    if any(len(part) > 5 or int(part) > MAX_COMPONENT for part in components):
        raise ValueError('Base version components must be between 0 and 65535')
    if not any(int(part) for part in components):
        raise ValueError('Base version must not be 0.0.0')
    if run is None:
        return base
    if isinstance(run, bool) or not isinstance(run, (str, int)):
        raise ValueError('Release run must be a canonical integer between 1 and 65535')
    value = str(run)
    if not re.fullmatch(r'[1-9][0-9]{0,4}', value) or int(value) > MAX_COMPONENT:
        raise ValueError('Release run must be between 1 and 65535; it cannot wrap')
    return f'{base}.{value}'


def read_asset(root, name):
    """Only package ordinary repository files under canonical relative paths."""
    if not isinstance(name, str) or not name or '\\' in name or '\x00' in name:
        raise ValueError(f'Missing or unsafe packaged asset: {name!r}')
    path = PurePosixPath(name)
    if (path.is_absolute() or path.as_posix() != name or '..' in path.parts
            or any(part in EXCLUDED_PARTS or part.startswith('.') for part in path.parts)
            or name in {'package.json', 'package-lock.json', 'playwright.config.cjs'}):
        raise ValueError(f'Missing or unsafe packaged asset: {name}')
    file = root / path
    if not file.is_file() or any((root / Path(*path.parts[:i])).is_symlink()
                                 for i in range(1, len(path.parts) + 1)):
        raise ValueError(f'Missing or unsafe packaged asset: {name}')
    return file.read_bytes()


def build(root=ROOT, release_run=None, sha=None, output_dir=None):
    """Return the ZIP path; release metadata is emitted only for release builds."""
    root = Path(root).resolve()
    manifest_bytes = read_asset(root, 'manifest.json')
    manifest = json.loads(manifest_bytes)
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    base = manifest['version']
    if package.get('version') != base:
        raise ValueError('package.json and manifest.json versions must agree')
    version = release_version(base, release_run)
    if (release_run is None) != (sha is None):
        raise ValueError('--release-run and --sha must be supplied together')
    if sha is not None:
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-fA-F]{40}', sha):
            raise ValueError('Release SHA must be the full 40-character hexadecimal commit SHA')
        sha = sha.lower()
        manifest['version'] = version
        manifest['version_name'] = f'{base}+build.{release_run}'
        manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf-8')

    files = {'manifest.json', 'options.css', 'README.md', 'INSTALL.md',
             'multi-view.js', 'mixer.html', 'mixer.css', 'mixer.js', 'options.js'}
    files.update(file.relative_to(root).as_posix() for file in (root / 'docs').rglob('*.md'))
    files.add(manifest['background']['service_worker'])
    files.add(manifest['options_ui']['page'])
    for script in manifest['content_scripts']:
        files.update(script.get('js', []))
        files.update(script.get('css', []))
    files.update(manifest['icons'].values())
    files.update(manifest['action']['default_icon'].values())
    # Read and validate all inputs before writing any output.
    contents = {name: read_asset(root, name) for name in files}
    contents['manifest.json'] = manifest_bytes
    destination = Path(output_dir).resolve() if output_dir is not None else root / 'dist'
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f'floating-video-toolkit-{version}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            output.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(archive) as check:
        if check.testzip() is not None or set(check.namelist()) != files:
            raise ValueError('ZIP verification failed')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    (destination / 'INSTALL.md').write_bytes(contents['INSTALL.md'])
    metadata_path = destination / 'release.json'
    if sha is not None:
        metadata = {'version': version, 'tag': f'v{version}', 'sha': sha,
                    'archive': archive.name, 'sha256': digest}
        metadata_path.write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    else:
        # A later local build must never inherit publishable release metadata.
        metadata_path.unlink(missing_ok=True)
    print(f'{archive.name}: {len(files)} files, {archive.stat().st_size} bytes\nSHA256 {digest}')
    return archive


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-run', help='GitHub workflow run number (1..65535)')
    parser.add_argument('--sha', help='Full 40-character commit SHA for the release')
    parser.add_argument('--output-dir', type=Path, help='Artifact destination (default: repository dist/)')
    args = parser.parse_args(argv)
    try:
        build(release_run=args.release_run, sha=args.sha, output_dir=args.output_dir)
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(2, f'Packaging failed: {error}\n')


if __name__ == '__main__':
    main()
