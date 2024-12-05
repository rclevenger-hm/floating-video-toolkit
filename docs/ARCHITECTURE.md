# Architecture

The extension uses Manifest V3 and plain scripts with no production dependencies.

- `background.js` handles toolbar commands, menus, and frame coordination. It first probes accessible frames, ranks candidates, and injects one action into the selected document. `documentId` pins the action to the probed navigation. Per-tab pending requests prevent overlapping activation. Playback commands can follow the native PiP owner recorded in session storage.
- `pip-core.js` owns hostname normalization, exclusion policy, candidate ranking, aspect ratios, and bounded display preferences. It is shared by the worker, settings, content scripts, and tests.
- `page-state.js` records the inline properties the extension changes. Restoring preserves unrelated properties and later player writes.
- `player-layout.js` moves the same video into a top-layer popover where supported, with a fixed-overlay fallback. A placeholder and style ledger restore its original location. It implements cinema view and the four-corner mini-player, not an OS window.
- `content.js` owns media actions, per-site state, automatic PiP, caption lifecycle, optional ad handling, and optional audio-energy analysis. It starts disabled, obtains the tab hostname, and reads settings before touching media. It gates every action on current policy.
- `options.html`, `options.css`, and `options.js` manage persistent settings, exact-host exclusions, learned data, and the browser's current shortcut bindings.

## Cleanup

Disabling a site stops periodic observers, removes extension overlays and UI, resets the automatic-PiP action handler, restores video flags and owned styles, and returns in-page layouts. Caption requests have an abort signal and generation guard, preventing late results from mutating a disabled or replaced session. Native track modes are restored and extension-created tracks are emptied and disabled.

Smart speed restores the user's playback rate unless another actor changed it after the extension's last write. It bypasses the analyser instead of disconnecting the audio destination. A created MediaElementSource remains associated with its video for that page's lifetime; reload is the complete reset.

## Boundaries

Native video PiP is browser-owned: the extension does not control its screen coordinates or guarantee captions/CSS inside it. Top-page exclusions use the sender tab's hostname in addition to frame/ancestor hostnames. The extension does not use `postMessage` as a privileged control channel. Site scripts cannot directly access its isolated-world controller.

Browser fixtures validate extension behavior without streaming accounts or external services. They do not certify live streaming providers, DRM playback, native OS placement, or all browser automatic-PiP policies.
