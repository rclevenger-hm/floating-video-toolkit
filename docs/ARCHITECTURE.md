# Architecture

The extension uses Manifest V3 and plain scripts with no production dependencies.

- `background.js` handles toolbar commands, menus, and frame coordination. It first probes accessible frames, ranks candidates, and injects one action into the selected document. `documentId` pins the action to the probed navigation. Per-tab pending requests prevent overlapping activation. Toolbar and native-PiP shortcut routing starts independent tab/policy reads together and injects its probe from the first callback hop to retain the triggering gesture; missing controllers are initialized in their exact documents and settings readiness is awaited before selection. Playback commands can follow the native PiP owner recorded in session storage.
- `pip-core.js` owns hostname normalization, exclusion policy, candidate ranking, aspect ratios, and bounded display preferences. It is shared by the worker, settings, content scripts, and tests.
- `page-state.js` records the inline properties the extension changes. Restoring preserves unrelated properties and later player writes.
- `player-layout.js` moves the same video into a top-layer popover where supported, with a fixed-overlay fallback. A placeholder and style ledger restore its original location. It implements cinema view and the four-corner mini-player, not an OS window.
- `content.js` owns media actions, per-site state, automatic PiP, caption lifecycle, optional ad handling, and optional audio-energy analysis. It starts disabled, obtains the tab hostname, and reads settings before touching media. It gates every action on current policy. Each frame anchors its optional PiP button to a loaded video with visible bounds; IntersectionObserver suppresses offscreen/clipped embedded players. Local button clicks invoke PiP directly to retain activation.
- `options.html`, `options.css`, and `options.js` manage persistent settings, exact-host exclusions, learned data, and the browser's current shortcut bindings.

## Cleanup

Disabling a site stops periodic observers, removes extension overlays and UI, resets the automatic-PiP action handler, restores video flags and owned styles, and returns in-page layouts. Caption requests have an abort signal and generation guard, preventing late results from mutating a disabled or replaced session. Native track modes are restored and extension-created tracks are emptied and disabled.

Smart speed restores the user's playback rate unless another actor changed it after the extension's last write. It bypasses the analyser instead of disconnecting the audio destination. A created MediaElementSource remains associated with its video for that page's lifetime; reload is the complete reset.

## Boundaries

Chrome supports one native video PiP window across tabs; a new request replaces the current PiP video. The extension does not implement multiple native PiP windows. Native video PiP is browser-owned: the extension does not control its screen coordinates or guarantee captions/CSS inside it. Top-page exclusions use the sender tab's hostname in addition to frame/ancestor hostnames. The extension does not use `postMessage` as a privileged control channel. Site scripts cannot directly access its isolated-world controller.

Browser fixtures validate extension behavior without streaming accounts or external services. They do not certify live streaming providers, DRM playback, native OS placement, or all browser automatic-PiP policies.

## Multi-view browser pop-outs and stream sync (1.22)

- `multi-view.js` is imported by the service worker. It discovers one selected video per accessible HTTP(S) tab and pins mixer controls to both `documentId` and a content-script video/source token. Navigation, source replacement and site exclusions prevent stale controls from targeting another player. Privileged mixer messages are accepted only from this extension's `mixer.html` page.
- Multi-view creates ordinary browser windows, with no always-on-top behavior. It does not use native video PiP or Document PiP. Pop-outs use `chrome.windows.create({tabId, type:'popup'})`: the existing tab moves without extracting media, creating an iframe, or opening a duplicate playback session. Return destinations live in `storage.session` across service-worker restarts. Window mutations are serialized. Closing the original browser window falls back to a new normal window on return. Managed tabs without a controllable video still expose Return to tab.
- Pop-out mode temporarily suppresses automatic PiP, ad comfort and smart speed in every accessible frame; preferences are unchanged. Returning or manually moving the source tab releases that mode. New documents read session state at startup. Video view is a separate opt-in use of the existing top-page cinema layout.
- `mixer.html`, `mixer.css`, and `mixer.js` expose source-player volume, mute and playback, window controls, and manual sync. Discovery runs on opening/refresh; a bounded list of up to 100 displayed players is polled every 1.5 seconds while the mixer is open. Full URLs and video data are not persisted or sent off-device.
- `stream-sync.js` performs relative seeks only within the continuous seekable range containing current playback. It never crosses a gap or silently clamps an unsupported request. Timed holds run in the source content script, survive closing the mixer, and request resume only for the same connected source. Explicit playback commands, source changes, pagehide and disable cancel pending resume. Cancel leaves the player paused. Timers can run late when the browser freezes a tab or the device sleeps.

This is manual alignment, not cross-provider clock synchronization. No capture, transcoding, recording, decryption, or independent DVR exists. A service can override seeking or return to live after a pause. Popup windows cannot be made always-on-top through the extension's window API; native PiP remains the single-player always-on-top option.
