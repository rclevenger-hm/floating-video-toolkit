# Validation and release

## Local checks

Run `npm ci`, `npm run check`, and `npm test`. The Node/DOM tests cover exclusion policy, frame selection, playback commands, shortcut routing, mini-player placement, site cleanup, original styles, caption cancellation, smart-speed bypass, settings validation, and storage errors.

Browser tests use `@playwright/test` and a disposable Chromium profile loaded with the extension. Run `npx playwright install --with-deps chromium`, then `npm run test:browser`. The fixture server is started automatically; manual inspection is available with `node scripts/fixture-server.cjs` at `http://127.0.0.1:43123/player.html`. The included short WebM is generated test footage with no external media dependency.

The browser checks exercise the real extension worker, settings storage, cross-origin frame policy, command selection, four corner positions, ultrawide player geometry, cleanup, and small-screen settings layout. Screenshots are included in the `browser-results` CI artifact. They do not claim streaming-provider compatibility.

## Manual checks before wider distribution

- Install the extracted package in Chrome and reload open video pages.
- Start a video, toggle native PiP using both toolbar and the assigned shortcut, and close it again.
- Reassign the native PiP shortcut and verify the previous binding no longer triggers the extension.
- Float a video, change tabs, and use play/pause and explicit mute/unmute shortcuts.
- Use cinema fit/fill at 16:9, 21:9, and 32:9; verify edge cropping and reset.
- Open the mini-player, check corners 1–4, resize the browser, type digits into a form, and press Escape.
- Disable the top-page hostname with an embedded video present, then re-enable it.
- On streaming services you use, separately test each experimental feature and record browser/site versions. Turn off any incompatible feature.

## Package and release

`npm run package` uses Python's standard library to create a deterministic ZIP and SHA-256 checksum. The manifest and package versions must match. The packager validates every included asset and excludes development content.

The validation workflow runs on main/dev pushes, PRs, and manual dispatch. It uploads a package only after unit and browser jobs succeed. To publish a release, update the manifest, package and lockfile versions together, add `docs/releases/vVERSION.md`, then push a matching `vVERSION` tag. The release job verifies the tag matches the packaged version and attaches the tested ZIP and checksum.
