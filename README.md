# Steam Currency Converter

If you’ve ever switched regions or moved countries, you’ve probably had to mentally convert prices every time you browse.

This extension removes that friction on the steam platform — helping you build an intuition for a new currency over time by seeing both the converted and original prices directly.

---

## Key Features

- The extension works directly inside Steam, converting prices as you browse. whether you're on the store, the market, or interacting with buy/sell dialogs. Prices update in real time as content loads, without requiring a refresh.

- You can choose exactly how prices are displayed: pick your target currency, customize the symbol, control where it appears, and adjust number formatting to match what you're used to. This makes the experience feel natural rather than forced.

- Exchange rates are fetched automatically and cached for performance, so the extension stays fast and continues working even if the network is unreliable.

- For clarity, you can always hover over a converted price to see the original — making it easy to compare and gradually build intuition for unfamiliar currencies.

---

## Technical Highlights

- Cross-browser extension (Chrome + Firefox, Manifest V3)  
- Regex-based price detection handling multiple currency formats  
- MutationObserver pipeline for dynamic DOM updates  
- WeakMap-based caching to avoid redundant processing  
- Background service worker for rate fetching and caching  

---

## Installation

### Firefox
1. Go to `about:debugging`
2. Click **This Firefox**
3. Load `manifest.json`

### Chrome
1. Go to `chrome://extensions`
2. Enable Developer Mode
3. Load unpacked extension folder

---

## Roadmap

- [x] Multi-currency support  
- [x] Extension UI  
- [x] Live exchange rates
- [x] User preferences
- [ ] Chrome & Firefox store release  
