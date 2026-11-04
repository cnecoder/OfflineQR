# OfflineQRScanner v1.2.3

> Recognition-only edition (Windows). Fully offline — no data ever leaves your machine.

## New

- **Edit global shortcuts in place**: click the "Region Alt+Q" / "Toggle Alt+W" badges on the toolbar and press the new key combo (Ctrl/Alt required). Esc cancels; the config persists. While recording, the current global hotkeys are suspended, so re-recording the same combo no longer accidentally triggers a region capture
- **Help popover**: the "?" button in the header shows the current version and offline note, with one-click links to the GitHub "latest release" download page and the project home (opened in your system browser; the app itself still makes zero network requests)

## Fixed

- **Recorded shortcuts never fired**: the registration and event-matching sides used different string forms (`alt+q` vs `alt+KeyQ`); both now share one canonical form — new combos trigger immediately after recording
- Hotkey badge **kept pulsing forever** after recording finished: the pulse animation now resets on completion, Esc, or window blur

## Improved

- More balanced header: the "?" button is now an accent-colored circle, the theme button shows the active theme as a **color swatch** (black-green / black-yellow), and the redundant "offline · local" caption is removed (it duplicated the help popover)
- Release builds show only the app name + version in the title bar; build markers remain debug-only

## Upgrade notes

- Install over the existing version, or replace the old exe with the portable build
- The app data directory (`com.offlineqr.scanner`) is independent from the full edition OfflineQR
