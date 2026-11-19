# Changelog

All notable changes to StreamPulse are documented here.

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
