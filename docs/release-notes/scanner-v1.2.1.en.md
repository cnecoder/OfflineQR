# OfflineQRScanner v1.2.1

> Recognition-only edition (Windows). Fully offline — no data ever leaves your machine.

## Added

- Brand-new app icon: a monochrome "finder corners" design in black / white / gray / silver, applied across installer, taskbar and favicon
- Region-selection overlay now supports **right-click to cancel** (left-drag selection is unaffected); an operation hint bar is shown at the bottom of the overlay (left-drag to select · right-click to cancel · Esc to cancel)

## Fixed

- **Mixed-DPI multi-monitor** overlay sizing: with a 2K primary at 150%, the secondary screen's overlay was stretched 1.5× and covered the neighboring display — overlay geometry now uses physical pixels, so scale factors no longer affect window placement

## Improved

- Latency from triggering region capture to overlay popup: PNG encoding switched to fast compression (default compression took ~1.1s at 1080p); screen capture and overlay window creation now run in parallel; the overlay fetches its image as soon as it is ready
- Failed capture startup now rolls back automatically (closes created overlays and restores the main window)

## Upgrade

- Install over the previous version, or replace the old exe with the portable build
- App data directory is isolated (`com.offlineqr.scanner`) and does not interfere with the full edition OfflineQR
