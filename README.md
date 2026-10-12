# Floating Video Toolkit

[![Validate and package](https://github.com/rclevenger-hm/floating-video-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/rclevenger-hm/floating-video-toolkit/actions/workflows/ci.yml)

A Chromium extension for single-window native Picture-in-Picture, ordinary browser pop-out windows, audio balancing, manual stream delay, ultrawide viewing, and keyboard playback controls. No account, backend, bundler, or runtime dependencies.

> **Chrome limitation: multiple native PiP windows are not supported.** Chrome allows one native PiP video at a time across tabs. Opening PiP for another video replaces the current one. This extension does not remove that limit. **Multi-view** opens ordinary browser windows; they do not stay above other applications.
>
> See [Chrome’s explanation of its one-window PiP behavior](https://developer.chrome.com/blog/watch-video-using-picture-in-picture).

## Choose how you watch

| Mode | What it does | Where it works |
| --- | --- | --- |
| Multi-view pop-outs | Opens each service tab in its own resizable window, with a shared audio mixer | Multiple HTTP(S) tabs; retains original players; not always on top |
| Native Picture-in-Picture | Floats one selected video above other applications | One native PiP window in Chrome across tabs; compatible top-page and embedded videos |
| Mini-player | Places the video in one of four page corners, with playback controls | Inside the current tab, for top-page videos |
| Cinema view | Creates a large in-page player with ultrawide fit and crop controls | Inside the current tab, for top-page videos |

The toolbar probes accessible frames and controls **one selected video in a tab**. The multi-view mixer controls one selected video in each of several tabs. It prefers the existing floating player, then a video you clicked, then a visible playing video. Top-page site exclusions also apply to its embedded frames.

## Install

1. Download the extension ZIP from [Releases](https://github.com/rclevenger-hm/floating-video-toolkit/releases) or the `floating-video-toolkit` artifact from a successful [workflow run](https://github.com/rclevenger-hm/floating-video-toolkit/actions).
2. Extract the ZIP. Do not try to load the ZIP directly.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the extracted directory containing `manifest.json` and pin the extension.
5. Reload video tabs, start playback, and click the toolbar icon.

You can also clone this repository and load its root directory directly. Chrome is the automated test target. Other Chromium browsers need their own compatibility checks; Firefox and Safari ports are not included.

After an update, reload the extension on `chrome://extensions`. The toolbar initializes already-open video tabs when needed; reload the video page if a site still has stale controls.

## Multiple streams in ordinary browser windows

Use **Multi-view & audio mixer** to arrange several service windows and balance their audio. These steps create browser pop-outs; they do not create multiple native PiP windows.

1. Start each stream in its own tab (for example, RedZone and the Chargers broadcast).
2. Right-click the extension icon → **Multi-view & audio mixer → Open multi-view & audio mixer**.
3. Select **Pop out** for each stream. Arrange or resize the windows with your OS. The source tabs move into these windows without being duplicated or reloaded.
4. Balance each video's volume, mute the feeds you do not want to hear, and control play/pause from the mixer. **Mute listed players** mutes all currently listed videos; unmute your preferred commentary.
5. Optionally choose **Video view** for a top-page video to use the existing cinema layout. Click again to restore the site's layout if it needs its original controls. Embedded players keep their service layout.
6. Use **Return to tab** when finished. **The pop-out's X closes the source tab and stops that stream.**

Pop-outs can be covered by other applications. Use native PiP when you need one always-on-top video. You cannot keep separate Netflix, Hulu, or sports streams in multiple native PiP windows with this extension in Chrome. Service account limits and DRM policies still apply. Netflix, Hulu and sports-provider compatibility must be checked with your actual subscriptions; fixture tests do not certify those providers.

The mixer does not unmute automatically when you raise a muted player's volume. Site-level/tab-level mute and OS volume also apply. Refresh players after opening streams or changing channels; stale controls fail safely. Automatic PiP, ad comfort, and smart speed are suspended while a tab is popped out, then restored from your settings when it returns.

### Delay a faster feed to match a slower broadcast

Open **Sync / stream delay** on the **faster feed**. If CBS is 40 seconds behind RedZone, enter **40** on the RedZone player and choose **Rewind**. This moves back from the current position, not from a claimed global live clock. Compare a shared play/scoreboard change and use **−1 s / +1 s** to fine tune. Each rewind adds another relative delay.

- **Available seek** shows the source player's contiguous seek range. Requests beyond it are rejected, not silently reduced. Up to 600 seconds per action is accepted only when that much content is available.
- **Timed hold** pauses a playing video for 1–600 seconds and requests resume. It runs in the source page even if you close the mixer. **Play** resumes immediately; **Cancel hold** leaves the video paused. Source changes, navigation and site disable cancel pending resume. Browser suspension or device sleep can make timers late.
- A hold **does not record the feed or create a DVR buffer**. A service may discard old content, force a return to live, reject seeks, or block automatic resume. Try its own DVR controls if that happens. If the service does not retain paused content, this extension cannot guarantee a delay.
- Different broadcasts do not expose a common event clock. Alignment is manual and may need adjustment after ads or buffering. Disable speed-changing features for streams kept in ordinary tabs while syncing.

Implementation references: [Chrome window API](https://developer.chrome.com/docs/extensions/reference/api/windows), [Chrome native PiP behavior](https://developer.chrome.com/blog/watch-video-using-picture-in-picture), and [source-player seekable ranges](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seekable).

## Playback and shortcuts

Right-click the toolbar icon for **Playback**, **Ultrawide & mini-player**, **Mini-player corner**, site controls, and settings. This makes every action accessible without assigning a shortcut first.

| Action | Suggested shortcut |
| --- | --- |
| Toggle native PiP | `Alt+P` |
| Play / pause | `Alt+Shift+P` |
| Mute / unmute | `Alt+Shift+M` |
| Toggle cinema view | `Alt+Shift+F` |
| Separate play, pause, mute, and unmute | Assign in Chrome |
| Toggle mini-player, cycle fit, crop zoom in/out, reset view | Assign in Chrome |
| Snap mini-player to corners 1–4 | Assign in Chrome, or use the in-player controls |

Customize these at `chrome://extensions/shortcuts` or use **Customize in Chrome** in settings. The settings page shows the actual bindings Chrome assigned, including conflicts that leave a command unassigned. There is no second hardcoded `Alt+P` binding.

While the in-page player is open, plain **1 / 2 / 3 / 4** choose **top left / top right / bottom left / bottom right**. These keys ignore input fields, modifiers, and repeats, and can be disabled in settings. **Escape** returns the video to its original place.

Playback shortcuts follow the native PiP video's tab even when you switch to another tab. Toolbar actions operate on the current tab.

## Ultrawide viewing

Open settings and choose:

- **Fit:** show the entire video with letterboxing where necessary.
- **Fill:** crop edges to cover the player.
- **Stretch:** fill the player by changing proportions.
- **Player shape:** Auto, 16:9, 21:9, 32:9, or 4:3 for the in-page player.
- **Crop zoom:** 1–3×, with horizontal and vertical crop positioning.
- **Mini-player size:** four sizes, constrained to the available tab dimensions.

Fill handles the player's empty space. Bars encoded into the video require manual crop zoom; automatic black-bar detection is not implemented. Crop, pan, brightness, contrast, saturation, and sharpening operate on the page video. They are not guaranteed to appear in Chrome's native PiP surface.

**Native PiP positioning is controlled by Chrome.** Corner snapping applies to the in-page mini-player, not the operating-system PiP window. Cinema and mini-player views are not always on top of other applications. Use native PiP for that behavior. [Chrome documents these placement restrictions](https://developer.chrome.com/docs/web-platform/document-picture-in-picture).

Some players rely on the video's DOM position. In-page modes move the same video element and return it when closed; use native PiP if a site's player does not tolerate this. Embedded frames use native PiP because the in-page layout cannot escape their frame boundary.

## Settings and site exclusions

Right-click the toolbar → **Status & learned data…** to open settings.

- Native PiP, optional automatic tab-switch PiP, page-button visibility, and picture controls are separate from experimental features.
- The optional page button appears beside a visible, loaded video (including inside embedded players). It disappears on pages without video and when the player is hidden or scrolled out of view. Enabling it does not replace the toolbar action.
- Add an exact hostname or paste a URL in **Site controls**. Only the normalized hostname is stored; subdomains are separate entries.
- Disabling a site stops watchers, cancels caption fetching, returns the in-page player, removes overlays, restores original video flags and styles, and releases playback-rate control.
- An already open native PiP window stays open until you close it; disabling stops extension control.
- **Reset learned data** removes learned ad speeds, skip selectors, and session totals. It preserves your settings and exclusions.

Automatic PiP depends on browser eligibility, audible playback, and site permissions. It is not guaranteed on every tab switch. Episode following attempts a swap while PiP is still open; if Chrome closes it first, a user gesture may be needed to reopen it.

## Experimental features

These features are **off by default for new installations**. Existing stored choices remain respected.

| Feature | Behavior and limits |
| --- | --- |
| Ad comfort | Detects configured page elements, mutes the selected video, attempts faster playback, and clicks recognized skip buttons. It does not block network requests or remove streamed ads. |
| Smart speed | Uses local audio energy to speed up quiet sections. Music can count as dialogue. It is gated by host, DRM, and media-source checks; compatibility still varies. |
| Caption bridge | Prepares native tracks or attempts YouTube/on-page caption extraction. Native PiP may not display the prepared captions. |

Ad rules exist for YouTube, Paramount+/CBS, and Hulu. Those source rules are not evidence of current live-service compatibility. Dormant rules for other services remain inactive. **Ad-session totals are detected sessions, not verified skips or time saved.** Disabling an active session does not increment the total.

Smart speed supports built-in host rules for YouTube, Plex, Dropout, and VHX, plus explicit extra hosts through the toolbar menu. If it silences a stream, disable it and reload the tab. On disable, the extension restores playback speed and bypasses its analyser while keeping audio connected; browser APIs do not let it fully undo an existing MediaElementSource connection.

Caption fetches are canceled on exit or disable, and delayed results cannot recreate caption tracks after cleanup. Protected content and browser embedding policies still apply; the extension does not bypass DRM.

## Development

Use Node.js 22 or 24 and Python 3.12+ for packaging:

```sh
npm ci
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run package
```

The package is written to `dist/floating-video-toolkit-VERSION.zip` with a SHA-256 checksum. It contains only extension assets, this README, and privacy documentation. Tests, fixtures, dependency folders, and development scripts are excluded.

CI tests Node.js 22 and 24, runs the extension in Chromium against local video fixtures, and packages only after those checks pass. Matching `vVERSION` tags publish the tested ZIP and checksum after validation. See [validation](docs/VALIDATION.md), [architecture](docs/ARCHITECTURE.md), and [release notes](docs/releases/v1.22.2.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Opening a second PiP replaces the first | This is Chrome’s single native PiP window limit across tabs. Use **Multi-view & audio mixer → Pop out** for several ordinary browser windows; they are not always on top. |
| A browser pop-out opens behind another window | Update to 1.22.2 or later. New pop-outs request foreground focus and the companion mixer opens without taking it. Use the mixer's **Focus** button to bring a player back, including from a minimized window. Other apps can still cover these ordinary windows afterward. |
| Native PiP from the toolbar or page button appears behind another app | Native PiP's window order is managed by Chrome and the OS; the video PiP API does not expose a focus or always-on-top setter. Close and reopen PiP. If it persists, record the OS, Chrome version, site, and whether the covering app is fullscreen. The browser pop-out focus fix does not address this separate case. |
| Nothing happens | Start playback, reload the page after installing, confirm site access, and inspect the toolbar tooltip for the last action result. |
| Wrong video is controlled | Click the intended video before using the toolbar or shortcut. Hidden and unloaded videos are excluded from selection. |
| A shortcut does not work | Open Chrome's shortcut settings; a browser/OS/extension conflict may prevent assignment. |
| Cannot snap native PiP | Use the in-page mini-player for corner snapping. Move native PiP with the browser/OS controls. |
| Embedded player will not enter cinema/mini mode | Use native PiP. In-page layouts currently require a top-page video. |
| Audio or speed changes unexpectedly | Disable smart speed and ad comfort; reload the tab if audio remains affected. |
| Captions do not appear | Enable site captions and verify browser support. The experimental bridge cannot guarantee native PiP caption rendering. |

Privacy details: [permissions and stored data](docs/PRIVACY.md). Planned work: [roadmap](docs/ROADMAP.md). No open-source license has been selected yet.
