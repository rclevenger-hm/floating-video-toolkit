# Privacy and permissions

Floating Video Toolkit has no analytics, account, backend, or remote code loader.

- `activeTab` and `scripting`: inspect video candidates and control one selected frame after a toolbar or keyboard action.
- `storage`: save preferences with `storage.sync` (which may sync through your browser account), learned ad rates/selectors and per-host session totals with `storage.local`, and the native PiP tab/document identifier with `storage.session` so playback commands can follow it across tabs. Session data is not retained across browser restarts.
- `contextMenus`: expose playback, layout, and per-site controls from the toolbar.
- `<all_urls>`: run content scripts in supported pages and their frames for playback adjustments, exclusions, and optional automatic PiP. Browser-protected pages remain inaccessible.

Experimental caption fetching can request the current YouTube page and its caption endpoint. Smart speed processes audio energy locally; it does not upload audio. Clearing learned data removes ad-rate records, selector records, and session totals without deleting preferences or site exclusions.

A top-page hostname exclusion also disables the extension inside that page's embedded frames. A frame hostname exclusion disables that frame. Entries are exact hostnames, not wildcard patterns; settings accept a full URL and store only its normalized hostname.
