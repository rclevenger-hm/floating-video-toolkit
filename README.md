# Always-On-Top Floating Video (PiP)

A Chrome Manifest V3 extension for keeping web video in a floating window while you work. It combines native Picture-in-Picture (PiP) with optional playback adjustments, smart speed, and experimental ad-comfort and caption features.

**Source version:** `1.20.0`  
**Suggested repository:** `floating-video-toolkit`  
**Status:** Development snapshot. Features below are documented from the supplied source; streaming-service compatibility has not been independently tested for this documentation update.

## Features

- **One-click floating video:** toolbar action and `Alt+P` shortcut request native PiP for a detected video.
- **PiP flag handling:** clears `disablePictureInPicture` and watches for sites that reapply it.
- **Optional on-page button:** a small PiP control appears near the upper-right corner when you move the pointer near the top of the page.
- **Automatic PiP integration:** registers a Media Session action handler for eligible tab-switch transitions.
- **Episode-following logic:** attempts to switch to a new playing video while a PiP session remains open.
- **Experimental ad comfort:** detects selected sites' ad UI, mutes the selected video, attempts faster playback, and clicks recognized YouTube skip controls.
- **Smart speed:** uses local audio-energy analysis to distinguish louder sections from sustained quiet, with separate playback rates.
- **Picture adjustments:** brightness, contrast, saturation, sharpening, and zoom for the page's selected video.
- **Experimental caption bridge:** attempts native text tracks, YouTube caption loading, or mirroring of visible caption text.
- **Settings and learned data:** inspect learned ad rates, clear learned selectors, and manage site exclusions.

Native PiP is a browser-managed, always-on-top video window. Removing a site's disable flag does not override browser permissions, embedding policies, protected-content restrictions, or an unavailable PiP API. [Browser API reference](https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API).

## Install locally

No package installation, bundler, API key, or backend is required.

1. Download or clone this repository and extract it if needed.
2. Open `chrome://extensions` in desktop Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the folder containing `manifest.json`.
5. Pin the extension from Chrome's Extensions menu.
6. Reload an already-open video page, start playback, and click the toolbar icon.

After changing the extension's files, reload it on `chrome://extensions`, then reload the affected video tabs. Existing content scripts may otherwise keep running from the previous version.

Other Chromium browsers are potential targets, but this snapshot has no recorded browser/version compatibility matrix. Firefox and Safari ports are not included.

## Basic usage

| Action | How |
| --- | --- |
| Open or close floating video | Click the extension's toolbar icon or press `Alt+P`. |
| Configure the browser shortcut | Open `chrome://extensions/shortcuts`. See the shortcut limitation below. |
| Open settings | Right-click the toolbar icon → **Status & learned data…**, or open Extension options from Chrome's extension details. |
| Enable the page button | Turn on **Show floating PiP button on page**. |
| Exclude a hostname | Right-click the toolbar icon → **Disable floating video on this site**. See the current exclusion limitation below. |
| Clear learned behavior | Use **Re-probe speed**, **Forget**, **Forget skip selectors**, or **Reset all learned data** on the settings page. |

Start video playback before requesting PiP. The picker prefers a playing video with a large intrinsic resolution; it does not always choose the video you last clicked.

Most controls are global. Site exclusion and the additional smart-speed allowlist are hostname-based. Learned ad rates are stored per frame hostname; statistics are recorded against the tab's hostname.

## Settings and defaults

| Setting | Default | Scope / behavior |
| --- | --- | --- |
| Site exclusions | Empty | Exact hostname match; not a wildcard exclusion. |
| Automatic PiP | On | Requests browser-driven auto-PiP integration; subject to browser eligibility and site settings. |
| On-page PiP button | Off | Top frame only. |
| Captions in PiP | On | Experimental text-track bridge; visible output is not guaranteed. |
| Ad comfort | On | Runs only for ad rules marked `verified` in the source. |
| Ad speed | Auto | Fixed alternatives: 2×, 3×, 5×, or 16×; player support varies. |
| Smart speed | Off | Built-in host allowlist plus user-added hosts. |
| Dialogue / quiet rate | 1.25× / 1.5× | Global smart-speed targets; manual player speed can become the baseline. |
| Brightness / contrast / saturation | 1 / 1 / 1 | CSS filters on the selected page video. |
| Sharpness / zoom | 0 / 1 | SVG sharpening filter and CSS scaling. |
| Hide YouTube paid-promotion overlay | On | Hides matching page overlays with CSS. |

## Site handling in this snapshot

This table describes **configured code paths**, not a certification that a current streaming service works.

| Site or player | Ad-comfort rule | Smart-speed eligibility |
| --- | --- | --- |
| YouTube / YouTube No-Cookie | Enabled; includes skip-button selectors and discovery | Built in, subject to media checks |
| Paramount+ / CBS | Enabled in source | Not built in |
| Hulu | Enabled in source | Not built in |
| Disney+ | Rule exists, but detection is dormant because it is not marked `verified` | Not built in |
| ESPN / ESPN+ | Rule exists, but detection is dormant because it is not marked `verified` | Not built in |
| Plex, Dropout, VHX | No active ad-comfort rule | Built in, subject to media checks |
| Other hosts | Generic selectors exist but are dormant | Explicit smart-speed allowlisting required |

The PiP path itself is not limited to these domains. Discovery is per frame and uses ordinary document video queries; closed shadow roots and some special frames are outside its current coverage.

### Automatic PiP and episode changes

The extension registers `enterpictureinpicture` on Media Session and sets `autoPictureInPicture` on the selected video. Browser support, audible playback, frame placement, and site permissions affect whether automatic entry occurs. It is not a guarantee that every tab switch opens or closes PiP. See [Chrome's automatic PiP documentation](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback).

After extension-initiated entry, episode-following logic attempts a swap when another sufficiently large video starts while PiP remains active. If PiP closes first, the code invites a manual resume by pulsing the page button **when that button exists**. There is no timed re-entry retry loop in this version. The button is off by default.

### Ad comfort

Ad comfort reacts to page elements; it does not block network requests or remove advertisements from a media stream. On an enabled rule it attempts to mute and accelerate the selected video. Its black mask is an in-page overlay and does not cover the native PiP window.

Auto speed uses a descending rate ladder and stores learned values per host. YouTube can enter a learning mode that leaves an ad at its original playback rate while searching for a skip control. Discovery is English-oriented and depends on the site's current DOM.

The badge and **Ads skipped** label currently count completed detected ad sessions, including sessions that were only muted or were ended by disabling the feature. They do not prove that an ad was skipped or measure time saved. Detection errors or player rate restrictions can affect normal playback; turn ad comfort off if that happens.

### Smart speed

Smart speed samples audio energy in roughly the 300–3400 Hz range and waits about 700 ms of quiet before choosing the faster target. Music and effects can resemble dialogue; this is not speech recognition.

The code checks the host allowlist, `mediaKeys`, and source/CORS indicators before creating a Web Audio connection. These checks reduce risk but do not guarantee compatibility with every stream. If enabling smart speed makes audio disappear, turn it off and reload the tab. Turning it off stops rate control but does not dismantle the existing audio graph.

For Plex on a local hostname or IP, use **Smart speed: allow this site**. The built-in domains remain allowed even if the extra-host checkbox is cleared; use the global smart-speed switch to disable the feature.

### Captions and picture adjustments

The caption bridge prepares text tracks using existing cues, YouTube timed-text data, or visible page text. **Preparing cues is not proof that Chrome's native video PiP displays them.** Google documents native PiP subtitle limitations and describes Document PiP as the route to a fuller caption-capable player. Treat this feature as experimental until tested on specific browser versions. [Chrome's Spotify PiP case study](https://developer.chrome.com/blog/spotify-picture-in-picture).

Enable captions in the site's player before testing. The current YouTube loader prefers the browser's language and does not necessarily match the player's selected caption language. Embedded URLs without a `v` query parameter are not handled by that loader.

Picture adjustments operate on the page video's CSS. Do not assume those effects transfer into the browser's separate native PiP surface. Sharpness is a convolution filter, not AI upscaling.

## Known limitations

- **Site exclusion is incomplete:** the toolbar/background injection path does not check `disabledHosts`; exclusions also do not automatically cover a different iframe hostname.
- **Multiple frames can compete:** toolbar activation runs independently in all accessible frames, with no single video owner across the tab.
- **Shortcut remapping is incomplete:** a separate content-script listener still recognizes hardcoded `Alt+P` after the browser command is reassigned.
- **Disabling a site is not a complete restore:** some caption state, auto-PiP hooks, and CSS changes can remain until a tab reload.
- **PiP controls and captions are constrained:** this version uses video PiP, not Document PiP, and does not implement a custom floating player.
- **Live service support is unverified:** selectors and player behavior can change. Comments marked `verified` are inherited source annotations, not fresh test results.

See [the prioritized roadmap](docs/ROADMAP.md) for fixes and proposed features.

## Privacy and permissions

The source contains no analytics client, telemetry service, remote executable code loader, or project backend. It does make YouTube page/caption requests, and preferences use Chrome's `storage.sync`, which may sync through the browser account. Learned data uses `storage.local`.

The manifest requests `activeTab`, `scripting`, `storage`, `contextMenus`, and `<all_urls>` host access, with content scripts in matching frames. See [privacy and permissions](docs/PRIVACY.md) for what each permission enables and what data is retained.

## Troubleshooting

| Symptom | Try |
| --- | --- |
| Nothing happens | Start playback, reload the tab after extension installation/update, then use the toolbar action. Check site access and the browser's PiP support. |
| Auto-PiP does not start | Check automatic PiP in Chrome's site settings. Test a playing, audible top-frame video. Manual PiP may still work. |
| Wrong video floats or PiP flashes | A page may have multiple videos or frames. Close other players and retry; cross-frame arbitration is a roadmap item. |
| Audio is missing or speed changes unexpectedly | Disable smart speed and ad comfort, then reload the tab. |
| Captions are missing | Turn on site captions and re-enter PiP; native PiP rendering may still be unsupported. |
| Site exclusion appears ineffective | Known limitation: toolbar injection and cross-origin frames can bypass the current exclusion path. Disable the extension for that session and reload if necessary. |
| A site no longer behaves as expected | Record extension/browser version, hostname, enabled features, and reproduction steps. Avoid including account data or signed playback URLs. |

Developer-console messages use `[Floating PiP]`. Some failures are swallowed, so an empty console does not prove success.

## Development

The shipped extension uses plain JavaScript, HTML, CSS, and browser APIs. There are no declared third-party runtime dependencies or build steps in the supplied files.

Basic JavaScript parsing checks, with Node.js installed:

```sh
node --check background.js
node --check content.js
node --check options.js
```

These checks do not test browser behavior. See [architecture](docs/ARCHITECTURE.md), [validation and release guidance](docs/VALIDATION.md), and [roadmap](docs/ROADMAP.md).

No license file was supplied. Choose and add a license before describing the repository as licensed open source. No GitHub repository, release, or store listing is created by this documentation package.
