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

## Next

1. Record a live compatibility matrix for commonly used streaming players and supported browser versions.
2. Explore Document PiP for richer captions and controls while retaining native PiP fallback. Programmatic OS-window positioning is not supported by that API either.
3. Add explicit per-site crop/picture profiles; current picture and view settings are global.
4. Improve discovery for shadow-root videos and unusual players.
5. Investigate safe black-bar detection on media that permits pixel access; retain manual crop for protected or cross-origin media.
6. Review permission scope and store submission requirements, choose a license, and prepare a store listing.
