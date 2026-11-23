# Changelog

All notable changes to StreamPulse are documented here.

## [1.34.1] - 2026-11-23

### Fixed

- `{first_letter}` now uses the pinyin initial for Chinese titles
  (`蜘蛛侠` → `Z`) instead of the first Han character.

## [1.34.0] - 2026-11-23

### Added

- Rename template inputs now show a variable picker on focus, with example
  values on the right and a live rendered example below each field.

## [1.33.0] - 2026-11-23

### Added

- Inline help panels on the rename, secondary-category and wash tabs, including
  variable lists, matching rules and wash-mode explanations.

## [1.32.2] - 2026-11-23

### Fixed

- Removed an empty icon slot from the organizer recognition-test input.

## [1.32.1] - 2026-11-23

### Changed

- Removed the remaining “整理后同步” row from the organizer page. Automatic
  library sync after organizing remains mandatory and runs in the background.

## [1.32.0] - 2026-11-23

### Changed

- Organizer directory fields now start blank and require selecting cloud
  directories before saving/scanning.
- TMDb API key and language moved to Settings → TMDb and shared by organizer,
  HDHive search and subscriptions.
- Removed the organizer “sync library” selector. A matching media library is
  now required and synced automatically after organizing.

## [1.31.0] - 2026-11-23

### Added

- Directory picker buttons for the organizer source, failed, redundant and
  media library paths. The selected source account is used for browsing.

## [1.30.2] - 2026-11-23

### Changed

- Live logs are localized to Chinese: API operations use 读取/提交/更新/删除,
  module names and service prefixes are translated, and common English log
  phrases are replaced.

## [1.30.1] - 2026-11-23

### Fixed

- Light theme coverage for the sidebar pulse, dashboard onboarding/hero cards,
  next/health cards, activity chart and the live log console.

## [1.30.0] - 2026-11-22

### Added

- Live log page using SSE, with level filters and pause/clear.
- MetaTube Server settings, connection test and AV number recognition test.

### Not yet included

- Automatic AV organization into the library; this change only adds recognition.

## [1.29.2] - 2026-11-21

### Added

- Empty-directory cleanup after orphan cleanup when “清理失效条目” is enabled.
  Media library roots are preserved; scoped event runs only prune the affected
  subtree and its now-empty parents.

## [1.29.1] - 2026-11-21

### Added

- Sidecar orphan cleanup: when “清理失效条目” is enabled, subtitles, NFO and
  images recorded by StreamPulse are removed after their source sidecar
  disappears. User-owned files are not touched.

## [1.29.0] - 2026-11-20

### Added

- CloudDrive2 file-change webhook receiver with token auth, scoped to the
  matching media library and affected directory.
- 115 WebSocket trigger for event polling, with the existing interval polling
  retained as fallback.

## [1.28.0] - 2026-11-20

### Added

- SeedHub browser search source, with the same manual challenge flow.
- 癫影 is shown as requiring site adaptation (invite-only/login).

## [1.27.0] - 2026-11-20

### Added

- Douban “想看” subscription sync using a public user ID, RSSHub, or a
  Douban cookie for private lists.
- Subscription list with TMDb matching and auto-sync interval.

### Not yet included

- Resource search / 影巢 unlock / 115 transfer / auto organize for subscriptions.

## [1.26.0] - 2026-11-20

### Added

- Manual verification sessions for browser-based search. When 不太灵 or 观影
  shows a captcha, the server keeps the page alive and returns a screenshot;
  the user enters the code in StreamPulse and the page continues.
- Challenge screenshots and code submission are available in the search page.

## [1.25.0] - 2026-11-20

### Added

- Headless Chromium bundled in the image.
- 不太灵 search through the browser context (returns magnet results).
- 观影 search through the browser; configurable site URL and optional cookie.
- Search page source switch: 影巢 / 不太灵 / 观影.

### Notes

- 观影 parsing is best-effort and may require selector updates when the site changes.
- Captcha prompts still need manual handling.

## [1.24.0] - 2026-11-20

### Added

- HDHive (影巢) search page using TMDb title resolution and the HDHive
  OpenAPI resource endpoint.
- HDHive API key / OpenAPI user token settings with connection test.
- Results show pan type, size, resolution, source, points, unlock state and
  validity; search never unlocks or spends points.

## [1.23.0] - 2026-11-20

### Added

- Simple forms for secondary categories and wash rules; advanced YAML remains
  available via a toggle.
- Dedicated “重命名规则” tab with folder/file templates and a target-path
  preview.
- Rename variables for resolution, source, HDR, codec, audio, team, fps and
  letter, plus conditional `<...>` blocks.
- Organizer explicitly creates the target folder, renames the file and then
  moves it into the media library.

## [1.22.0] - 2026-11-20

### Fixed

- Organizer defaults are now normalized when saved settings are missing or
  contain an empty/partial `washing` object.
- Added “恢复默认” buttons to the category and wash YAML editors.

## [1.21.0] - 2026-11-20

### Added

- Emby library management in settings: test connection, list existing virtual
  folders, add a library to the refresh list, and create a library from a
  directory with a selected collection type.

## [1.20.0] - 2026-11-20

### Added

- Telegram command bot: `/status`, `/libraries`, `/run`, `/full`, `/runs`,
  `/cancel`, `/login`, `/help`.
- `/login` sends a 115/123 QR image to Telegram and writes the credentials back
  to the source after confirmation.
- Telegram command access is restricted to the configured Chat ID and is
  disabled by default.

## [1.19.0] - 2026-11-20

### Added

- 115 event-level incremental sync: events are mapped to library directories
  through a CID index, and only the affected subtree is scanned.
- Scoped runs preserve manifest entries outside the scanned subtree and only
  clean orphans inside that subtree.

### Fixed

- Event polling no longer triggers a full scan of every library sharing the
  same 115 account when the event belongs to another library.

## [1.18.1] - 2026-11-20

### Fixed

- 115 cookie failover now writes the active cookie back to the per-source file.
- Added a source-card “重新登录” entry for 115 accounts whose last check failed.

## [1.18.0] - 2026-11-20

### Added

- Weighted wash rules with weights, minimum score gap, minimum coverage,
  must/exclude conditions and tie handling.
- Wash simulator: compare existing/candidate filenames without moving files.
- Organizer recognition test API/UI.

## [1.17.0] - 2026-11-20

### Added

- Emby integration with multiple servers, API key test and per-server library
  refresh after successful runs.
- Telegram and WeCom bot notifications for success, failure and invalid
  cookies.
- 115 multi-cookie accounts with automatic failover on login failures.

## [1.16.0] - 2026-11-20

### Added

- 115 share import: paste a share link, receive files into a chosen cloud
  directory, then run the organizer.
- Media library cover generation from local posters, output as a
  1200×1800 JPEG under `/data/covers`.
- Split documentation: `docs/faq.md`, `docs/advanced.md`.

## [1.15.0] - 2026-11-20

### Added

- P0 organizer improvements:
  - Optional sidecar downloads (subtitles, NFO, images) beside STRM.
  - 115 life-event change detection to trigger incremental runs when the
    library's watch interval is enabled.
  - Movie/TV folder and file rename templates with variables.
  - `max_size` and `min_size` wash strategies.
  - Default categories remain auto-created; no cloud directory IDs required.

## [1.14.0] - 2026-11-20

### Added

- Per-library **STRM 生成地址** (`streamBaseUrl`), required when creating or
  editing a library; used in generated STRM and previews.
- Organizer directories: failed-recognition and redundant-file paths.
- Failed/redundant files are moved to those cloud directories.
- After organize, optionally trigger a selected media library immediately to
  generate/update STRM.
- Default secondary categories and default `better` upgrade strategy.
- “规则说明” button documenting YAML schema, matching semantics and directory
  roles.

## [1.13.0] - 2026-11-20

### Added

- YAML editors for secondary categories and upgrade strategy.
- Live YAML parsing with visual category cards and upgrade summary.
- YAML errors block saving and keep the last valid preview.

### Fixed

- Additional light-theme overrides for logs, library paths, source URL panels,
  picker lists, QR panels, dialogs and mobile navigation.

## [1.12.0] - 2026-11-20

### Added

- Light theme is now the default; persisted light/dark toggle in the top bar.
- Tabbed settings pages:
  - Organize: 基本设置 / 二级分类 / 洗版策略 / 扫描结果
  - Settings: 运行设置 / 账号与安全
  - Sources: 全部 / 115 / 123 / OpenList
- Light-theme overrides for cards, panels, forms, modals, auth and navigation.

## [1.11.0] - 2026-11-20

### Added

- 115 / 123 source profiles: avatar, nickname, total/used/remaining storage,
  membership label and expiry.
- Profile is fetched automatically after QR login and on connection test.
- Source cards show avatar, capacity bar and membership state.

## [1.10.1] - 2026-11-20

### Added

- 115 QR login device options: **微信小程序** and **支付宝小程序**.
- WeChat mini program is the default 115 QR device.

### Changed

- 115 QR help text now lists all supported device types.

## [1.10.0] - 2026-11-19

### Changed

- Organizer now works **inside 115 / 123 cloud drives**, not on a local
  `/import` directory.
- Fields: source account, cloud inbox path, cloud library path.
- 115/123 clients now support cloud mkdir, move, rename and recycle-bin delete.
- Upgrade replaces the old cloud file by moving it to the provider recycle bin.
- Removed the local `./import` and `./media` Docker volumes.

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
