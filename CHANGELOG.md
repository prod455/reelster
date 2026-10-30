# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-30

### Fixed
- Export failed with `HTTP 404 on /api/v1/direct_v2/inbox/` after Instagram removed the `direct_v2` web endpoints. Reelster now reads the GraphQL responses the Instagram tab already loads and scrolls the chat to its start by itself.

### Added
- "Stop and download now" button to export only the part read so far.
- Reel links pasted as text are exported too.

### Changed
- Video URLs are resolved through Instagram's post query, falling back to the reel page's embedded data.
- New `cookies` permission to read your own user id (`ds_user_id`).

## [1.0.0] - 2026-10-30

### Added
- Export every Reel sent and received in an Instagram DM thread into a `.tar.gz`, split into `enviados/` and `recebidos/`.
- `manifest.json` with links, timestamps, senders and failed downloads.
- Support for `clip`, `media_share` (clips) and `xma_clip` thread items.
- English and Brazilian Portuguese UI.
