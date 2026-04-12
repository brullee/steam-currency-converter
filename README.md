# Steam Currency Converter

Browser extension that converts Steam prices into a user-selected currency in real time.

Works across the platform (store, marketplace, wallet, and dialogs) and updates dynamically without page reloads.


## About this extension

### Project Goal

Help users understand prices on Steam without relying on external conversion tools.


### Features

- **Any-to-any currency conversion**  
  Convert from any supported Steam store currency to any ISO 4217 currency — not just USD.

- **Popup settings**  
  Set your target currency, override store currency detection, and choose whether to remove the " USD" label Steam appends to prices in some regions (e.g. "$9.99 USD" → "$9.99").

- **Live exchange rates**  
  Fetches rates from the exchangerate-api and caches them for 24 hours. Falls back to stale cache on network failure.

- **Lazy auto-detection**  
  Detects the store currency from page prices automatically. Waits for prices to render before converting, so SPA pages (cart, etc.) work correctly on first load.

- **Hover to reveal original**  
  Hover over any converted price to temporarily see the original. Covers individual prices, cards, and purchase blocks.

- **Marketplace & wallet support**  
  Converts wallet balances, sell dialog inputs, buy order totals, and price history graph tooltips.

- **Dynamic DOM handling**  
  MutationObserver + TreeWalker keep prices converted as content loads or changes without breaking the UI.

### Implementation

- Manifest V3 with a background service worker for rate fetching and caching.
- TreeWalker for text-node traversal.
- MutationObserver for dynamic DOM updates.
- Regex-based currency parsing with per-currency symbol, position, and decimal rules.
- `Intl.NumberFormat` for formatting output in any locale.

### Store currencies

These are the Steam store currencies the extension can detect and convert *from*. The target currency — what you convert *to* — can be any ISO 4217 currency code, even ones not listed here.

**Europe**: EUR, GBP, UAH, RUB, KZT, PLN, NOK, CHF.  
**Middle East**: AED, QAR, KWD, SAR  
**Asia Pacific**: JPY, KRW, SGD, HKD, TWD, MYR, THB, IDR, INR, VND, PHP  
**Oceania**  AUD, NZD  
**Americas**: USD, CAD, MXN, BRL, COP, CLP, PEN, UYU, CRC  
**Africa**: ZAR

**Not supported**

- **CNY** — Steam China runs on a separate platform (Steamworks China).
- **ILS** — not supported on principle.

### Roadmap

- [x] Multi-currency support.
- [x] Extension UI (popup + settings).
- [x] Live exchange rates.
- [ ] User options (toggles, preferences, etc.).
- [ ] Chrome & Firefox store release.



## How to test

#### Firefox-based browsers

1. Clone / download the repo.
2. Go to `about:debugging` in the address bar.
3. Click **This Firefox** (or your browser name).
4. Click **Load Temporary Add-on**.
5. Navigate to the extension folder and select `manifest.json`.

#### Chromium-based browsers

1. Clone / download the repo.
2. Go to `chrome://extensions` in the address bar.
3. Enable **Developer Mode**.
4. Click **Load Unpacked**.
5. Select the extension folder.
