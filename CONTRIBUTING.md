# Contributing

Thanks for helping! Bug reports, fixes for Instagram API changes and translations are especially welcome.

## Ground rules

- **No runtime dependencies.** The extension ships plain ES modules from `src/`; there is no bundler.
- **Test first.** Logic lives in `src/lib/` as pure functions with an injected `api`, so it can be tested with `node:test` and fakes. Add a failing test that reproduces the bug or describes the feature, then make it pass.
- **Fail loudly.** If Instagram's response format changes, throw a clear error instead of silently exporting nothing.
- **Smallest permission set.** New permissions need a justification in the PR.

## Setup

```bash
git clone https://github.com/prod455/reelster.git
cd reelster
npm test
```

For the end-to-end test:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Load `src/` via `chrome://extensions` → Developer mode → Load unpacked, and reload it after each change.

## Reporting an API change

Include the error message from the export page and, if you can, the shape of the failing item (DevTools → Network → `direct_v2/threads`). **Remove names, ids, text and URLs** before posting.

## Translations

Copy `src/_locales/en/messages.json` to `src/_locales/<locale>/messages.json` and translate the `message` values.

## Releases

Bump `version` in both `package.json` and `src/manifest.json`, update `CHANGELOG.md`, then push a `vX.Y.Z` tag. CI builds the zip and attaches it to a GitHub release.
