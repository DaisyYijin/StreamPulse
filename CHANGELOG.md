# Changelog

All notable changes to StreamPulse are documented here.

## [1.9.0] - 2026-11-19

### Added

- Local media organizer: scan `/import`, identify with TMDb, classify and place
  into `/media`.
- User-defined secondary categories based on TMDb genre, country, language and
  filename keywords.
- Upgrade/洗版 strategies: off, better quality only, always replace.
- Move / copy / hardlink modes; old upgraded files are moved to `/media/.trash`.
- Basic Kodi/Emby NFO (`movie.nfo`, `tvshow.nfo`) with TMDb id.
- Preview before execute; batch expires after 30 minutes.

### Docker

- Added `./import:/import` and `./media:/media` volumes.

## [1.8.1] - 2026-11-19

### Fixed

- 115 QR login now reads the `data.cookie` credential returned by the 115
  QR login endpoint (previously the response field was read incorrectly).
- 115 QR status uses the long-poll endpoint with a 35 second window instead of
  aborting every 4 seconds.
- The `acw_tc` cookie from the QR token request is preserved for status and
  login requests.

## [1.8.0] - 2026-11-19

### Added

- **115 扫码登录** with selectable login device: Web / Android / iOS / TV.
- **123 云盘扫码登录** via 123 App or WeChat, with automatic token login.
- QR session endpoints:
  - `POST /api/sources/qr/start`
  - `GET /api/sources/qr/:id`
- QR code rendering is server-side; credentials never leave the server until the
  scanned session is confirmed and written to the per-account file.

### Changed

- Source account form has credential login and QR login modes for 115/123.
- 123 token-only accounts are supported after QR login.

## [1.7.0] - 2026-11-19

### Added

- Native **115** storage driver (browser Cookie, directory listing, pickcode
  direct URL), no OpenList required.
- Native **123 云盘** storage driver (account/password login, directory listing,
  download URL), no OpenList required.
- Source account picker: 115 / 123 / OpenList, one account per
  `/config/sources/<source-id>.json`.
- Provider-specific account forms and connection tests.

### Security

- 115 Cookie, 123 password and 123 access token are stored in the per-source
  file with mode `0600`; they are never returned to the browser.

## [1.6.0] - 2026-11-19

### Added

- Explicit **incremental** and **full rebuild** runs per media library.
- Per-library **real-time polling** at 1/5/15/30/60 minute intervals, in
  addition to Cron scheduling.
- Run records now include the sync mode (`incremental` / `full`).
- Media library cards expose a one-click full rebuild.

### Changed

- Scheduled, real-time and manual runs share the existing per-library job queue,
  so a library never runs twice concurrently.

## [1.5.0] - 2026-11-19

### Changed

- Split configuration by concern:
  - `/config/settings.json` for global settings
  - `/config/accounts/<username>.json` per administrator
  - `/config/sources/<source-id>.json` per source/account (complete record)
  - `/config/libraries/<library-id>.json` per media library
- Added `/data` state volume:
  - `/data/runs/<run-id>.json` per run, including its logs
  - `/data/manifests/<library-id>.json` per incremental manifest
- `settings.json` is the commit marker for a complete save.
- Legacy `streampulse.json` is migrated automatically and removed after a successful split save.

## [1.4.0] - 2026-11-19

### Changed

- Configuration volume is now `/config` (`CONFIG_DIR`); `DATA_DIR` remains a
  migration alias.
- Administrator credentials moved to `/config/accounts/admin.json`.
- Each source/cloud account now stores its token/password in
  `/config/sources/<source-id>.json`, one file per account.
- `/config/streampulse.json` is sanitized and no longer contains tokens,
  passwords or password hashes.
- Compose maps `./config:/config`, `./strm:/strm`, `./logs:/logs`.

### Migration

- Existing `/data` databases are migrated automatically: source secrets are
  written to per-source files and the old administrator hash to
  `accounts/admin.json`.
- Existing deployments should either rename the `data` directory to `config` or
  set `CONFIG_DIR=/data` and keep mounting `./data:/data`.

## [1.3.0] - 2026-11-19

### Added

- Administrator **username + password** setup on first run, with account/password
  editing in Settings. Account changes rotate sessions.
- `STREAMPULSE_USERNAME` environment variable alongside `STREAMPULSE_PASSWORD`.
- Separate Docker volumes for configuration (`/data`), STRM output (`/strm`) and
  application logs (`/logs`).
- Persistent daily application logs with `LOG_RETENTION_DAYS` cleanup.
- Settings now shows config, STRM, log and credential storage locations.
- Credential storage guidance for 115 and other cloud drives via OpenList.

### Changed

- `OUTPUT_DIR` now defaults to `/strm` in Docker; `LOG_DIR` defaults to `/logs`.
- Existing databases are migrated with the default administrator username `admin`.
- Existing deployments upgrading from 1.2 should update their volume mappings or
  set `OUTPUT_DIR`/`LOG_DIR` explicitly.

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
