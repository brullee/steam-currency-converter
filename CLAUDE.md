# Steam Currency Converter

Browser extension (Manifest V3, Chrome + Firefox) that rewrites Steam store/market prices into another currency. Plain JS/CSS/HTML - no build step, no bundler, no modules. Published by hand to the Chrome Web Store and Firefox Add-ons, so a bug ships to real users until the next manual upload.

## Layout
- `content/` + `shared/` are content scripts. They load in the order listed in the manifest and share one global scope (no imports) - a new file goes into `content_scripts.js` in all three manifests.
- `manifest.chrome.json` (service-worker background), `manifest.json` (identical copy, so Chrome's "Load unpacked" works on the repo folder) and `manifest.firefox.json` (background scripts + gecko id; load this one in Firefox's `about:debugging`) are edited by hand. Change all three together; `tests/unit/manifest.test.js` fails when they drift.
- `background/background.js` fetches rates from exchangerate-api.com and caches them for 24h in `storage.local` under `v3_` keys.
- Settings live in `chrome.storage.sync`. The popup has no Save button: every change is written immediately, and `storage.onChanged` in `init.js` re-applies it to open tabs (`resetPage()` restores Steam's originals, then the page converts again). Anything new that writes to the page needs a matching undo in `resetPage()` / `restoreMarketElements()`, or it survives a settings change.
- Formatting is two sets in one `formatting` key: `converted` (target-currency prices) and `original` (Steam's own prices - hover, wallet "(original)", conversion off). Read it only through `readFormatting()` in `shared/settings.js`, which also upgrades the pre-1.2 flat keys (`customSymbol`, ... + `applyFormatting`). Show Steam's own price text via `formatOriginalText()` so it gets the original set.
- `tests/` is dev-only with its own `package.json`. Leave it out of store zips.

## Commands (run in `tests/`)
- `npm test` - jsdom unit tests. `npm run test:e2e` - packed Chrome build in real Chrome on fixture pages served at Steam URLs, offline.
- `npm run test:live` - real Steam + real rate API (the `check-live` skill).
- After editing extension files, reload the extension in `chrome://extensions` and refresh open Steam tabs - Chrome doesn't pick up changes to an unpacked extension on its own.
- Before calling a code change done, use the `verify` skill (unit + e2e + no weakened tests).

## Rules that bite
- Write to the DOM only when the text actually differs (`setText` in `content/market.js`). Every write fires the MutationObserver, which schedules another pass - an unconditional write loops ~10x/second forever.
- Conversion state is per text node in `textState` (`content/state.js`), never on the parent element: one parent can hold several price nodes (graph tooltip = date / price / count).
- Decide whether text is fresh by comparing with our own output, not by looking for FROM's symbol: USD's `$` is inside `A$`, `R$`, `CDN$`, so converted text still "contains a USD price".
- No usable rate means leave the page untouched. Never fall back to 1:1 - it shows wrong prices with the target symbol.
- ILS/ISL are disabled as source and target on purpose (`init.js`, `popup.js`). Keep it that way.
- Steam's markup changes without notice. When a selector stops matching, look at the live page before editing a fixture to match an assumption.

## Workflow
- Solo project: commits go to `main`; CI runs unit + e2e on every push and PR, and a weekly workflow runs the live check.
- Commit subjects are short, lowercase, imperative, no prefix - e.g. `expand hover range on market sell/buy listing prices`.
- Release: bump `version` in all three manifests, tag `vX.Y.Z` (existing tags: `v1.1`, `v1.1.1`), upload to both stores.
