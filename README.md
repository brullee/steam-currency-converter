<div align="center">

<img src="icons/steam-cc_128x128.png" alt="Steam Currency Converter">

# Steam Currency Converter

A browser extension that converts Steam prices to your preferred currency as you browse. Works across the store, community market, and checkout.

<a href="https://chromewebstore.google.com/detail/steam-currency-converter/kkpmhkmhbcdkagimlpcofbffhmdppmmb">
  <img src="docs/images/chrome.png" alt="Get it on Chrome">
</a><a href="https://addons.mozilla.org/en-US/firefox/addon/steam_currency_converter">
  <img src="docs/images/firefox.png" alt="Get it on Firefox">
</a>

</div>

## Overview

Real-time currency conversion built right into Steam, with no tab switching and no interruptions. It supports **164 currencies** and works across the store, community market, and checkout. On top of conversion, it adds a few quality-of-life features: hover to compare, full market dialog support, and formatting controls that make the numbers look the way you're used to.

## What it does

You pick a source currency (what your Steam wallet uses) and a target currency (what you want to see). The extension then rewrites every price on the page in your target currency, live, without a refresh. Content that loads in later, like search results, bundle items, and market listings, gets converted too.

On the Community Market it goes further: wallet balance, the buy/sell dialogs, and the price history graph tooltips all update to your chosen currency.

Exchange rates come from [exchangerate-api.com](https://exchangerate-api.com). They're fetched once a day and cached locally. If the API is unreachable, the extension uses the last cached rate, and if it has never fetched one, it leaves prices as they are rather than showing a wrong number.


## Getting Started

1. Install the extension
2. Open the popup by clicking the extension icon
3. Set **Store currency** (the currency your Steam store charges you in)
4. Set **Convert to** (the currency you want to see)

That's it. Changes save as you make them, and Steam tabs that are already open switch over right away, without a reload.

## Installation

### Browser

**Chrome:** Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/steam-currency-converter/kkpmhkmhbcdkagimlpcofbffhmdppmmb).

**Firefox:** Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/steam_currency_converter/), then allow access to the Steam sites from the extension's **Permissions** tab in `about:addons`.

To install without the stores, see [Install manually](#install-manually).

### Install manually

Each [release](https://github.com/brullee/steam-currency-converter/releases/latest) has a ready-made zip for each browser: `SCC-Chrome-…zip` and `SCC-Firefox-…zip`. Use this to install without the stores, or to try a version before it reaches them.

#### Chrome, Edge, Brave and other Chromium browsers

1. Download the Chrome zip from the [latest release](https://github.com/brullee/steam-currency-converter/releases/latest) and extract it.
2. Go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.

To update, download the new release, replace the folder's contents, click the reload button on the extension's card, and refresh any open Steam tabs.

#### Firefox

1. Download the Firefox zip from the [latest release](https://github.com/brullee/steam-currency-converter/releases/latest). No need to extract it.
2. Go to `about:debugging` and click **This Firefox**.
3. Click **Load Temporary Add-on** and select the zip.
4. In `about:addons`, open the extension's **Permissions** tab and allow access to the Steam sites.

Firefox removes temporary add-ons when it closes, so you'll need to load it again after a restart. Regular Firefox only installs signed add-ons permanently. Firefox Developer Edition and Nightly can install unsigned ones: set `xpinstall.signatures.required` to `false` in `about:config`, then use **Install Add-on From File** in `about:addons` and pick the same zip.

### Steam Client

You can run this extension directly inside the Steam desktop client using two community tools:

1. Install **[Millennium](https://github.com/SteamClientHomebrew/Millennium)**, a plugin loader for the Steam client
2. Install the **[Extendium](https://github.com/BossSloth/Extendium)** plugin via Millennium, which adds Chrome extension support to Steam
3. Download the Chrome zip from the [latest release](https://github.com/brullee/steam-currency-converter/releases/latest), extract it, and load the folder through Extendium the same way you would in Chrome

> **Note:** This isn't officially supported by Valve and may violate their terms of service. While Millennium is mentioned on Steam's own forums, it doesn't mean it's endorsed by Valve. Use it at your own risk.


## What's included

### Hover to Compare

Every converted price is interactive. Hover over it, or over the card, row or tab it belongs to, and every price in it switches back to Steam's original, so you can compare without toggling anything. It works the same everywhere: store rows, market listings, the beta market's tabs and cards, and dialogs.

![Hovering converted prices shows Steam's original](docs/images/hover-showcase.webp)

If you'd rather not have this, you can turn it off with a checkbox in the popup. Prices stay converted, just without the hover.

![Turning hover off in the popup](docs/images/hover-toggle.webp)

### Community Market Support

The Community Market, both the new beta and the classic version, is converted too: listings, wallet balance, and the buy and sell dialogs.

On the **beta market**:
- Listing cards, the item popup and the exterior tabs are converted, including prices Steam shows in a local display currency (e.g. `UAH 1,205.00` for a USD wallet), each with its own exchange rate.
- The **Buy an item** dialog converts the subtotal, fees and total, with the amount Steam actually charges shown next to each one. Hover any of them to see Steam's price in place.
- **Place buy order** shows the converted price per item under the price field, and it follows every change to the price or quantity as you type.
- The **price filters** (listing page and Advanced Search) show the range you typed in your currency.

![Buy an item: converted charges, Steam's amount beside each, hover for the original](docs/images/market-buy.webp)

![Place buy order: the converted price per item follows quantity and price](docs/images/market-buy-order.webp)

On the **classic market**, the sell dialog shows live previews of what you receive and what the buyer pays, the buy order dialog shows the converted order total, and the price history graph tooltips are converted.

### Custom Number Formatting & Symbols

Each currency comes with sensible local defaults, like German-style `2,64 €` or Brazilian `R$ 12,90`. You can override any of it: set your own thousands and decimal separators, drop `.00` from round numbers, or replace the symbol with any text you like. You can also choose the symbol's position (left or right) and whether it has a space.

There are two separate sets of these settings, picked with the switch at the top of **More settings**: one for converted prices and one for Steam's own prices wherever they appear (on hover, in wallet balances, and when conversion is off). The switch names them after your currencies, e.g. **JOD prices | USD prices**. So you can, for example, show converted prices as `JD 12.50` while the hover shows `US$ 9.99`.

If your Steam store shows prices with a trailing `USD` (e.g. `$9.99 USD`), the **Hide "USD" after prices** checkbox removes it. It's useful even when you're not converting, just to make prices tidier.

A live preview at the top of **More settings** shows example prices in the format you're editing, so you can see each change before opening Steam.

![Changing the format updates the live preview](docs/images/format-preview.webp)


## Configuration

The popup has two layers of settings.

**Basic:**
- Source and target currency
- Toggle conversion on/off
- Hover to reveal the original price
- Hide "USD" after prices (for stores that show `$9.99 USD`)

Below them, the popup shows the exchange rate in use and when it was last updated (e.g. `1 USD = 0.86 EUR · updated 2h ago`).

**Formatting (under "More settings"):** two separate sets, one for converted prices and one for Steam's own prices (on hover, in wallet balances, and when conversion is off). Each has:
- Custom symbol text, position (left/right), and spacing
- Thousands and decimal separators
- Hiding `.00` on round numbers

A live preview shows example prices in the set you're editing.


## Technical notes

- Manifest V3, Chrome and Firefox
- Prices are detected with a regex built per currency that handles symbol position, regional separators, non-breaking spaces, and alternate symbols (e.g. PHP shows `₱` in search but `P` on game pages)
- Each converted text node is tracked in a WeakMap (original text, converted text, rate), so the MutationObserver skips it on later passes and never converts the same text twice
- Hover targets and their text nodes are cached in a WeakMap, so the DOM isn't walked again on every mouse event
- Settings apply live: the popup saves every change, and each open tab listens for `storage.onChanged`, puts Steam's original text back, and converts again with the new settings
- If the background service worker has been shut down, the content script retries the rate request once to wake it


## Tests

The `tests/` folder is self-contained and isn't part of the shipped extension.

```bash
cd tests
npm install
npm test            # unit tests: content scripts in jsdom
npm run test:e2e    # end-to-end: the Chrome build in Google Chrome, on fixture pages served at Steam URLs
npm run test:live   # the same build against the real Steam store and rate API (needs network)
npm run test:perf   # timings per phase, whole-page cost in real Chrome, slowest functions
```

The e2e and live suites use Google Chrome from its default install location. Set `BROWSER=helium` to use Helium, `BROWSER_PATH` to use any other Chromium-based browser, or `HEADED=1` to watch the tests run. The e2e suite uses fixed exchange rates, so it runs offline, like the unit tests.

`test:perf` builds a large synthetic page and prints how long each phase takes (first pass, lazy-loaded content, settings changes, hover), how much main-thread time the extension adds in real Chrome, and which of its functions that time goes to. Each phase has a generous budget, so a big regression fails the run. Results are also saved to `tests/perf/results/` to compare runs.

GitHub Actions runs the unit and e2e suites on every push and pull request, and the live suite once a week. That way, a change to Steam's pages or an outage of the rate API gets caught even when nobody is working on the code.


## AI-assisted development

This repo is set up for [Claude Code](https://claude.com/claude-code):

- `CLAUDE.md` holds the project rules.
- `.claude/skills/` has a `verify` skill (runs the tests and checks none were weakened) and a `check-live` skill (runs the live suite).
- `.claude/hooks/` stops Claude from pushing and keeps its commit messages short.


## Disclaimer

This extension is meant to give you a general idea of prices. Rates are updated daily, but accuracy isn't guaranteed. Some currencies are spot on while others can be a bit off, and the prices shown may not always be current or error-free. Double-check before making any purchase where it matters. By using this extension you hereby accept that I'm not responsible for any loss or inconvenience resulting from it.


## Issues

Something broken or a currency behaving oddly? [Open an issue](https://github.com/brullee/steam-currency-converter/issues/new).

## License

Open source under the [MIT License](LICENSE).
