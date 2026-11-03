# OfflineQRScanner v1.2.2

> Recognition-only edition (Windows). Fully offline — no data ever leaves your machine.

## Added

- Region-selection overlay now supports **right-click to cancel** (left-drag selection is unaffected); an operation hint bar is shown at the bottom of the overlay (left-drag to select · right-click to cancel · Esc to cancel)
- Result text blocks: a blinking caret appears where you click, partial text can be drag-selected, Ctrl+A selects within the block — copying is smoother

## Fixed

- **Mixed-DPI multi-monitor** overlay sizing: with a 2K primary at 150%, the secondary screen's overlay was stretched 1.5× and covered the neighboring display — overlay geometry now uses physical pixels, so scale factors no longer affect window placement
- When the main window was **minimized**, triggering region capture did not bring it back after recognition — now the window is restored and focused on completion or failure, regardless of outcome (Alt+W show/hide fixed accordingly)
- Card height did not return after collapsing expanded long text (thumbnail size was not re-synced) — thumbnails are now a fixed 64×64, decoupled from card height
- Long text was fully expanded by default (the editing host forced pre formatting) — default is back to a single ellipsized line; expanding is capped at 220px with scrolling

## Improved

- Latency from triggering region capture to overlay popup: **measured ~1.7s → ~0.4s at 1080p×2** — PNG encoding switched to fast compression, screen capture and overlay window creation run in parallel, raw RGBA pixels are delivered over binary IPC (no base64/JSON/PNG decoding)
- Failed capture startup now rolls back automatically (closes created overlays and restores the main window)

## Upgrade

- Install over the previous version, or replace the old exe with the portable build
- App data directory is isolated (`com.offlineqr.scanner`) and does not interfere with the full edition OfflineQR
