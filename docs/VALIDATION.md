# Validation and release

## Local checks

Run `npm ci`, `npm run check`, and `npm test`. The Node/DOM tests cover exclusion policy, frame selection, playback commands, shortcut routing, mini-player placement, site cleanup, original styles, caption cancellation, smart-speed bypass, settings validation, and storage errors. Multi-view tests cover independent window state, worker restart restoration, missing return windows, restricted senders, video/source tokens, seek gaps and evicted buffers, timed hold cancellation, and blocked resume.

Browser tests use `@playwright/test` and a disposable Chromium profile loaded with the extension. Run `npx playwright install --with-deps chromium`, then `npm run test:browser` from a desktop session. The focus test uses headed Chromium: on a Linux CI host, run under Xvfb with Openbox as shown in the workflow. The fixture server is started automatically; manual inspection is available with `node scripts/fixture-server.cjs` at `http://127.0.0.1:43123/player.html`. The included short WebM is generated test footage with no external media dependency.

The browser checks exercise the real extension worker, settings storage, cross-origin frame policy, command selection, four corner positions, ultrawide player geometry, cleanup, and small-screen settings layout. Multi-view browser cases cover two simultaneous source-tab pop-outs, independent audio/playback controls, restoration without replacing the video, seek requests, hold resume after closing the mixer, and stale navigation rejection. Native PiP tests trigger the actual extension toolbar action through browser-level DevTools, after page activation expires, with the page button on and off. Additional cases cover hidden/offscreen/removed video, cross-origin page buttons, and recovery after reinstall without reloading the source tab.

The multi-view tests verify ordinary browser pop-outs, not multiple native PiP windows. The native PiP tests verify opening and closing a single window; passing CI does not demonstrate multi-PiP support in Chrome. Screenshots are included in the `browser-results` CI artifact. They do not claim streaming-provider compatibility.

Window-focus tests verify that pop-outs request foreground focus and the companion mixer does not take it, including reuse of an existing player/mixer. The desktop case runs in headed Chromium under Xvfb/Openbox in CI because headless Chrome can report several windows as focused simultaneously. Unit tests cover restoring minimized windows and preserving maximized state. These checks do not establish stacking behavior against other applications or native PiP behavior on Windows/macOS.

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
- Open a player from both the mixer and the pop-out command: it should appear in front of the browser/mixer. Minimize it and use **Focus** in the mixer to restore it. Repeat with the mixer already open. Check native PiP separately against other desktop applications and fullscreen windows.
- On streaming services you use, separately test each experimental feature and record browser/site versions. Turn off any incompatible feature.

## Package and release

`npm run package` uses Python's standard library to create a deterministic ZIP and SHA-256 checksum. The manifest and package versions must match. The packager validates every included asset and excludes development content.

The validation workflow runs on main/dev pushes, PRs, and manual dispatch. It uploads a package only after unit and browser jobs succeed. Every successful main push (including merges) automatically publishes that exact commit; other events never publish. The actual default branch is `main`, not `master`.

CI calls `python3 scripts/package.py --release-run "$GITHUB_RUN_NUMBER" --sha "$GITHUB_SHA"`. A base such as `1.22.2` becomes `1.22.2.27` inside the ZIP for run 27, tagged `v1.22.2.27`. No source-version commit is needed. Keep manifest/package/lockfile base versions aligned when intentionally bumping the base. Chrome limits each component to 65535; invalid/overflow versions fail rather than wrap. Keep run numbering stable and base versions increasing.

Run `python3 -m unittest discover -s scripts -p 'test_*.py' -v` locally. These tests cover deterministic packaging, version stamping, checksum and metadata validation, release retry/conflict handling using mocked GitHub calls, and workflow publication boundaries. They never create real releases.

The release job downloads the exact tested artifact and verifies its manifest, checksum, metadata and source SHA. It prepares a draft, verifies/upload assets and publishes only after validation. Re-running the same main workflow safely resumes matching drafts or accepts an identical already-published release. Conflicts fail closed; it never overwrites published assets or moves existing tags. Do not use a new manual workflow run to retry publication: re-run the original failed main run so its version and SHA are preserved.

Release assets contain an unpacked extension ZIP, checksum, `release.json` and installation instructions. Users must extract it and choose Chrome's Developer mode → Load unpacked; it is not a signed CRX, store submission or automatic updater. A testable release candidate remains an artifact on PR runs. Workflow permissions must already permit the release job's scoped `contents: write`; no persistent tokens, repository-setting changes or manual tag pushes are needed.

GitHub may reject tagging historical commits whose workflow files differ from the current default branch without additional workflow permissions. The publisher fails closed on permission errors and does not request a broader token or change repository settings; maintainers must resolve such a policy blocker. See [GitHub release permissions](https://docs.github.com/en/rest/releases/releases#create-a-release).
