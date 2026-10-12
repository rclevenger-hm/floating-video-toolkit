# Roadmap

## Implemented in 1.21.0

- Consistent top-page and embedded-frame exclusions.
- Single-owner frame selection and clicked-video preference.
- Browser-managed shortcuts without duplicate hardcoded bindings.
- Restore owned page styles, flags, caption state, and playback rates on disable.
- Ultrawide fit/fill/stretch, aspect-ratio presets, and crop positioning.
- Cinema view and a mini-player with four corner positions.
- Play/pause, explicit play/pause/mute/unmute, fit, zoom, and corner commands.
- Clear settings, exact-host exclusions, and experimental feature labels.
- Local regression coverage, Chromium fixtures, tested packaging, and tag releases.

## Implemented in 1.22.0

- Concurrent existing-tab browser pop-out windows with safe return destinations. These are ordinary windows without always-on-top behavior, not multiple native PiP windows.
- Shared per-player volume, mute and playback mixer.
- Manual DVR rewind and one-second nudges within available source ranges.
- Source-page timed holds with cancellation, stale-source protection and resume feedback.
- Per-pop-out suspension of automatic PiP, smart speed and ad comfort.

## Unsupported in Chrome

Multiple independent, always-on-top native PiP windows are not implemented. Chrome currently allows one native PiP video across tabs; requesting another replaces the current one. The multi-view pop-out feature does not fulfill multi-PiP support.

A future Document PiP experiment would target richer content inside a PiP window. It is not a commitment to multiple simultaneous PiP windows or a workaround for Chrome’s window limit. Firefox and Safari ports are not included.

## Next

1. Record a live compatibility matrix for commonly used streaming players and supported browser versions.
2. Explore Document PiP for richer captions and controls while retaining native PiP fallback. Programmatic OS-window positioning is not supported by that API either.
3. Add explicit per-site crop/picture profiles; current picture and view settings are global.
4. Improve discovery for shadow-root videos and unusual players.
5. Investigate safe black-bar detection on media that permits pixel access; retain manual crop for protected or cross-origin media.
6. Review permission scope and store submission requirements, choose a license, and prepare a store listing.
