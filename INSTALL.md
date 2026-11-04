# Install Floating Video Toolkit

This download is an **unpacked Chromium extension**, not a Chrome Web Store
installer. Chrome and Edge can load unpacked extensions in developer mode.
Chrome is the tested browser; other Chromium browsers need their own
compatibility checks. A ZIP cannot be installed by double-clicking it or
dragging it into Chrome.

1. Download `floating-video-toolkit-VERSION.zip` from the release's **Assets**.
   Do not choose GitHub's **Source code** downloads.
2. Extract the ZIP into a permanent folder. Use your system's **Extract All** or
   **Extract** command; do not try to load the ZIP itself.
3. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
4. Turn on **Developer mode**, then select **Load unpacked**.
5. Select the extracted folder that directly contains `manifest.json`.
6. Refresh any pages already open, then pin Floating Video Toolkit from the
   browser's extensions menu if you want its toolbar button visible.

Keep the extracted folder in place. The browser reads the extension from it.
Your browser or organization may prevent developer-mode extensions; this ZIP
does not bypass those restrictions. It is not a Firefox extension.

## Update an existing installation

These release ZIPs do not update automatically. Download and extract the new
release, replace the files in the same installed folder, then select **Reload**
on the extension's card at `chrome://extensions` (or `edge://extensions`).
Refresh open video pages afterward. Keeping the same installed folder preserves
the extension's identity and saved settings.

## Optional download verification

The matching `floating-video-toolkit-VERSION.zip.sha256` file contains the ZIP's
SHA-256 checksum. On Linux, run `sha256sum -c` with that checksum filename from
the download folder. On macOS, use `shasum -a 256 -c` instead. A matching checksum
verifies the downloaded bytes against the published checksum.

See `README.md` for controls and `docs/PRIVACY.md` for permissions and privacy.
