# Steam Currency Converter

MV3 browser extension (Chrome + Firefox) that rewrites Steam prices into another currency. Plain JS, no build step. Published by hand to both stores.

## Layout
- `content/` + `shared/` share one global scope, loaded in manifest order. A new file goes into `content_scripts.js` in all three manifests.
- `manifest.json` = copy of `manifest.chrome.json`; Firefox loads `manifest.firefox.json`.
- `tests/` is dev-only (own `package.json`); leave it and `.claude/` out of store zips.

## Commands (in `tests/`)
- `npm test` (jsdom), `npm run test:e2e` (real Chrome, offline fixtures), `npm run test:live` (real Steam).
- `npm run test:perf`: per-phase timings (jsdom) and whole-page cost in real Chrome, with the extension's slowest functions. Run it after touching the walker, hover or formatting.
- Before calling a change done, run the `verify` skill.
- After editing extension files: reload it in `chrome://extensions`, then refresh Steam tabs.

## Rules
- Write to the DOM only through `setText` (`content/market.js`) - an unconditional write re-triggers the observer forever.
- Store conversion state per text node in `textState`, not on the parent element.
- Detect fresh text by comparing with our own output, not by searching for FROM's symbol (`$` is inside `A$`, `R$`).
- No usable rate: leave the page untouched. Never convert at 1:1.
- Anything that writes to the page needs a matching undo in `resetPage()` / `restoreMarketElements()`.
- Read formatting only via `readFormatting()` (`shared/settings.js`); show Steam's own price text via `formatOriginalText()`.
- ILS/ISL stay disabled as source and target.
- Steam class names and ids live only in `content/steam.js`. Nothing there may be required to convert a price; hover groups fall back to link / role / `cursor: pointer`.
- One hover rule everywhere (`findHoverTarget`): hovering a price or the clickable thing it's in shows every original in it.
- Server-rendered React pages (beta market): don't write before hydration (`whenHydrated()`), or React re-renders the page.
- When a Steam selector stops matching, check the live page before editing a fixture.

## Release
Bump `version` in all three manifests, commit as `X.Y.Z`, tag `vX.Y.Z`. Commit subjects: short, lowercase, imperative.
