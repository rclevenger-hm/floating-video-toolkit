# Validation and release

## Local checks

Run `npm ci`, `npm run check`, and `npm test`. The Node/DOM tests cover exclusion policy, frame selection, playback commands, shortcut routing, mini-player placement, site cleanup, original styles, caption cancellation, smart-speed bypass, settings validation, and storage errors. Multi-view tests cover independent window state, worker restart restoration, missing return windows, restricted senders, video/source tokens, seek gaps and evicted buffers, timed hold cancellation, and blocked resume.

Browser tests use `@playwright/test` and a disposable Chromium profile loaded with the extension. Run `npx playwright install --with-deps chromium`, then `npm run test:browser`. The fixture server is started automatically; manual inspection is available with `node scripts/fixture-server.cjs` at `http://127.0.0.1:43123/player.html`. The included short WebM is generated test footage with no external media dependency.

The browser checks exercise the real extension worker, settings storage, cross-origin frame policy, command selection, four corner positions, ultrawide player geometry, cleanup, and small-screen settings layout. Multi-view browser cases cover two simultaneous source-tab pop-outs, independent audio/playback controls, restoration without replacing the video, seek requests, hold resume after closing the mixer, and stale navigation rejection. Native PiP tests trigger the actual extension toolbar action through browser-level DevTools, after page activation expires, with the page button on and off. Additional cases cover hidden/offscreen/removed video, cross-origin page buttons, and recovery after reinstall without reloading the source tab.

The multi-view tests verify ordinary browser pop-outs, not multiple native PiP windows. The native PiP tests verify opening and closing a single window; passing CI does not demonstrate multi-PiP support in Chrome. Screenshots are included in the `browser-results` CI artifact. They do not claim streaming-provider compatibility.

## Manual checks before wider distribution

- Install the extracted package in Chrome and reload open video pages.
- Enable the page button, visit a text-only page, then hide/scroll away from a video and confirm no stray button remains.
- Start a video, toggle native PiP using both toolbar and the assigned shortcut, and close it again.
- Reassign the native PiP shortcut and verify the previous binding no longer triggers the extension.
- Float a video, change tabs, and use play/pause and explicit mute/unmute shortcuts.
- Use cinema fit/fill at 16:9, 21:9, and 32:9; verify edge cropping and reset.
- Open the mini-player, check corners 1–4, resize the browser, type digits into a form, and press Escape.
- Disable the top-page hostname with an embedded video present, then re-enable it.
- Pop out two streams into ordinary browser windows, confirm they can be covered by other applications, balance their audio, use a DVR rewind and timed hold on the faster stream, then return both tabs. Test ad breaks, source changes, a missing original browser window, and browser sleep.
- On streaming services you use, separately test each experimental feature and record browser/site versions. Turn off any incompatible feature.

## Package and release

`npm run package` uses Python's standard library to create a deterministic ZIP and SHA-256 checksum. The manifest and package versions must match. The packager validates every included asset and excludes development content.

The validation workflow runs on main/dev pushes, PRs, and manual dispatch. It uploads a package only after unit and browser jobs succeed. To publish a release, update the manifest, package and lockfile versions together, add `docs/releases/vVERSION.md`, then push a matching `vVERSION` tag. The release job verifies the tag matches the packaged version and attaches the tested ZIP and checksum.
