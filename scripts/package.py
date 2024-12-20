#!/usr/bin/env python3
"""Build a deterministic unpacked-extension ZIP without development files."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def build():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    package = json.loads((ROOT / 'package.json').read_text())
    version = manifest['version']
    if package['version'] != version:
        raise ValueError('package.json and manifest.json versions must agree')
    files = {'manifest.json', 'options.css', 'README.md'}
    files.update(str(file.relative_to(ROOT)) for file in (ROOT / 'docs').rglob('*.md'))
    files.add(manifest['background']['service_worker'])
    files.add(manifest['options_ui']['page'])
    files.add('options.js')
    for script in manifest['content_scripts']:
        files.update(script.get('js', []))
        files.update(script.get('css', []))
    files.update(manifest['icons'].values())
    files.update(manifest['action']['default_icon'].values())
    for name in files:
        file = ROOT / name
        if Path(name).is_absolute() or '..' in Path(name).parts or not file.is_file():
            raise ValueError(f'Missing or unsafe packaged asset: {name}')
    destination = ROOT / 'dist'
    destination.mkdir(exist_ok=True)
    archive = destination / f'floating-video-toolkit-{version}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, (ROOT / name).read_bytes())
    with zipfile.ZipFile(archive) as check:
        if check.testzip() is not None:
            raise ValueError('ZIP verification failed')
        assert set(check.namelist()) == files
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
    print(f'{archive.name}: {len(files)} files, {archive.stat().st_size} bytes\nSHA256 {digest}')
    return archive

if __name__ == '__main__':
    build()
