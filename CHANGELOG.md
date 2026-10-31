# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-31

### Added
- Shared posts are exported too: every photo (and carousel video) of each post goes to `enviados/posts/` or `recebidos/posts/`, numbered `<date>_<time>_<shortcode>_<n>.jpg`.
- The export window shows how many responses were captured and whether the message list was found, and asks you to scroll the Instagram tab yourself when it cannot.

### Fixed
- Reading stopped at the first ~20 messages. Older pages that name the chat only by its internal id are now matched (the chat's ids are learned from the first page), and the message list to scroll is located through the text of messages already read instead of a layout guess, with wheel input as well.

### Changed
- `manifest.json`: `reels` became `items` (with `kind` and `files`); `totals` now splits `reels` and `posts` and adds `post_files`.

## [1.3.0] - 2026-10-31

### Fixed
- Exports stopped after the most recent messages. The export now opens in its own small window so the Instagram tab stays visible (Chrome freezes hidden tabs, and Instagram only loads older messages while it renders), and reading waits 20 s without new messages before deciding it reached the start.
- Message responses delivered as `arraybuffer` or `blob` XHRs are captured too.

### Added
- Optional period (from/to dates, both inclusive, local time). With a start date, reading stops as soon as it reaches that day. The period is recorded in `manifest.json`.

## [1.2.0] - 2026-10-30

### Fixed
- Every Reel failed to download on real accounts. The post query now sends the same variables and headers as Instagram's web app, `/api/v1/media/<id>/info/` is tried as a second lookup, and the reel page as a third.
- When the CDN refuses the extension's request, the video is downloaded through the Instagram tab instead.

### Added
- The export page lists why Reels failed, grouped by reason.

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
