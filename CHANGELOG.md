# Changelog

All notable changes to StreamPulse are documented here.

## [1.2.0] - 2026-11-19

### Added

- Mobile-first application shell with a fixed five-tab bottom navigation, mobile
  logout, and safe-area insets for notched phones.
- Mobile run history cards, full-width bottom-sheet modals, touch-friendly
  controls, and 16px form inputs to prevent browser zoom on focus.
- PWA manifest, maskable app icons, Apple touch icon, and add-to-home-screen meta.
- Mobile screenshot and documentation.

### Changed

- The desktop sidebar is hidden below 960px in favor of bottom navigation.
- Activity rows are rendered as cards on phones instead of a horizontally
  scrolling table.

## [1.1.0] - 2026-11-19

### Added

- Dedicated 302 stream service on port `2048`, separate from the web UI on `1024`.
- Per-source random stream keys and `{streamBase}` / `{streamToken}` URL template
  variables. STRM files now point at StreamPulse, which resolves the real direct
  link through OpenList and returns an HTTP 302 to the player.
- Settings field for the public 302 service URL, with automatic derivation from
  the first browser request.
- Health endpoint for the 302 service and dual-port Docker health checks.

### Changed

- Default web port changed from `8080` to `1024`; default STRM template now uses
  the 302 service.
- Docker Compose exposes `1024:1024` and `2048:2048`.

## [1.0.0] - 2026-11-19

### Added

- OpenList / AList source connections with token or username/password auth,
  connection testing, and a remote directory browser.
- Media libraries with recursive scanning, mirrored output paths, extension and
  size filters, glob excludes, and configurable STRM URL templates.
- Incremental generation with per-library manifests and optional cleanup of
  orphaned STRM files.
- Real-time run queue with SSE logs, cancellation, statistics, and history.
- Per-library Cron scheduling with timezone support.
- First-run admin setup, scrypt password hashing, signed HttpOnly sessions, and
  API authentication.
- React 19 control panel with dashboard, libraries, sources, activity, and
  settings pages.
- Multi-arch Docker image, health check, Compose file, and GHCR publishing via
  GitHub Actions.
- Unit tests for URL templates, path safety, and incremental comparison.
