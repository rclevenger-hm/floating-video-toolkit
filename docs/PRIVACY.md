# Privacy and permissions

Floating Video Toolkit has no analytics, account, backend, or remote code loader.

- `activeTab` and `scripting`: inspect video candidates and control one selected frame after a toolbar or keyboard action.
- `storage`: save preferences with `storage.sync` (which may sync through your browser account), learned ad rates/selectors and per-host session totals with `storage.local`, and the native PiP tab/document identifier with `storage.session` so playback commands can follow it across tabs. Session data is not retained across browser restarts.
- `contextMenus`: expose playback, layout, and per-site controls from the toolbar.
- `<all_urls>`: run content scripts in supported pages and their frames for playback adjustments, exclusions, and optional automatic PiP. Browser-protected pages remain inaccessible.

Experimental caption fetching can request the current YouTube page and its caption endpoint. Smart speed processes audio energy locally; it does not upload audio. Clearing learned data removes ad-rate records, selector records, and session totals without deleting preferences or site exclusions.

A top-page hostname exclusion also disables the extension inside that page's embedded frames. A frame hostname exclusion disables that frame. Entries are exact hostnames, not wildcard patterns; settings accept a full URL and store only its normalized hostname.

Multi-view uses the existing host access and scripting permissions to discover playable tabs when you open or refresh the mixer, then poll only its displayed players. The mixer shows tab titles/hostnames and media controls locally. It does not transmit them or retain browsing history. Pop-out tab/window IDs and original tab positions are stored only in `storage.session` for restoration. No new permissions are required.

Audio balancing changes each source video's `volume`/`muted` properties; it does not capture or analyse audio. Delay uses that player's seekable range or a timed pause, without recording, caching media, or bypassing DRM. An explicit hold can resume after the mixer closes; use Cancel hold to leave the video paused. Disabling a site cancels its holds. Closing a pop-out closes its source tab; Return to tab preserves it.
