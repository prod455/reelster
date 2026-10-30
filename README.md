<p align="center"><img src="src/icons/128.png" width="96" alt=""></p>

<h1 align="center">Reelster</h1>

<p align="center">
  Export every Reel <b>sent and received</b> in an Instagram DM conversation into a single <code>.tar.gz</code>.<br>
  Plain JavaScript · Manifest V3 · zero runtime dependencies · nothing leaves your browser.
</p>

<p align="center">
  <a href="https://github.com/prod455/reelster/actions/workflows/ci.yml"><img src="https://github.com/prod455/reelster/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="zero dependencies">
  <a href="README.pt-BR.md"><img src="https://img.shields.io/badge/lang-pt--BR-green.svg" alt="Português"></a>
</p>

---

## What you get

```
reelster-340282366841710300949128123456789-2026-10-30.tar.gz
├── enviados/                              # Reels you sent
│   └── 2026-10-28_21-14-03_DAbCdEfGhIj.mp4
├── recebidos/                             # Reels you received
│   └── 2026-10-29_09-02-51_DKlMnOpQrSt.mp4
└── manifest.json                          # links, dates, senders, failures
```

- One `.mp4` per Reel, highest resolution available, named `<UTC date>_<time>_<shortcode>.mp4` so they sort chronologically.
- A Reel shared more than once in the same direction is stored once (the oldest share).
- Reels that can no longer be downloaded (deleted, private account) are listed under `failed` in `manifest.json` instead of aborting the export.

## Install

1. Download the latest `reelster-x.y.z.zip` from [Releases](https://github.com/prod455/reelster/releases) and unzip it — or clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder (or `src/` in the repo).

Works in Chrome, Edge, Brave, Opera and any Chromium ≥ 116.

## Use

1. Open [instagram.com/direct](https://www.instagram.com/direct/inbox/) and click the conversation.
2. Click the Reelster icon → **Export Reels from this conversation**.
3. Keep both tabs open. When it finishes, the `.tar.gz` is saved by your browser.

Extract with `tar -xzf reelster-*.tar.gz` (macOS/Linux) or `tar -xzf` in Windows Terminal / 7-Zip.

## How it works

```
popup ──opens──▶ export page ──chrome.scripting──▶ Instagram tab: fetch /api/v1/direct_v2/…  (your session)
                     │
                     ├─ pages through the whole thread, finds Reels (clip, media_share, xma_clip)
                     ├─ resolves missing video URLs via /api/v1/media/<id>/info/
                     ├─ downloads each video from the CDN, one at a time
                     └─ streams them into a ustar archive ─▶ CompressionStream("gzip") ─▶ download
```

| File | Responsibility |
| --- | --- |
| [`src/lib/thread.js`](src/lib/thread.js) | Thread id resolution and pagination over the Direct API |
| [`src/lib/reels.js`](src/lib/reels.js) | Pure extraction of Reels from thread items, file naming |
| [`src/lib/exporter.js`](src/lib/exporter.js) | Orchestration, deduplication, `manifest.json` |
| [`src/lib/tar.js`](src/lib/tar.js) | Streaming ustar writer + gzip, ~70 lines, no deps |
| [`src/export.js`](src/export.js) | Browser glue: authenticated requests, retries on HTTP 429, saving |

### Privacy and permissions

| Permission | Why |
| --- | --- |
| `scripting` + `www.instagram.com` | Run the Direct API requests inside your logged-in Instagram tab |
| `*.cdninstagram.com`, `*.fbcdn.net` | Download the video files |

No analytics, no remote servers, no storage. Your session cookies are never read by the extension; requests run inside the Instagram tab itself.

## Development

Requires Node ≥ 20. No install needed for unit tests.

```bash
npm test            # unit tests (node:test)
npm install && npx playwright install chromium
npm run test:e2e    # loads the extension in Chromium against a faked Instagram
npm run build       # dist/reelster-<version>.zip
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitations

- Relies on Instagram's private web API, which can change without notice. If an export breaks, [open an issue](https://github.com/prod455/reelster/issues/new/choose) with the error shown.
- Very long conversations take a while: pages are fetched with a small delay to avoid rate limits.
- The archive is assembled in memory (Chrome spills large blobs to disk), so hundreds of Reels need some free disk space.

## Disclaimer

Reelster is an independent project, not affiliated with, endorsed by or sponsored by Instagram or Meta. Use it only on your own conversations and respect the creators' rights over the videos you download and Instagram's Terms of Use. Automated access may be restricted by Instagram; use at your own risk.

## License

[MIT](LICENSE)
