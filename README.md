# Steam Currency Converter

Browser extension that converts Steam prices into a user-selected currency in real time.

Works across the platform (store, marketplace, wallet, dialogs) and updates dynamically without page reloads.

---

## Features


-  **Marketplace Graph Conversion**  
  Converts prices inside Steam’s price history graphs and tooltips dynamically.

-  **Wallet & Transaction Clarity**  
  Displays converted and original values in wallet balances and sell dialogs to prevent confusion during transactions.

-  **Real-Time Conversion**  
  Updates prices across store, marketplace, and dialogs without page reloads.

- **Dynamic DOM Handling**  
  Uses MutationObserver and TreeWalker to safely update content without breaking UI.


## Implementation

- TreeWalker (text-node traversal).
- MutationObserver (dynamic DOM handling).
- Regex-based currency parsing.
- DOM injection for UI enhancements.


##  Roadmap

- [ ] Multi-currency support.
- [ ] Extension UI (popup + settings).
- [ ] Live exchange rates (API or alternative sources).
- [ ] User options (toggle, display preferences).
- [ ] Chrome & Firefox store release.

---

##  Notes

- Currently supports UAH → USD.
- Exchange rate is static (for now).


##  Goal

Help users understand prices on Steam without relying on external conversion tools.

---

## How to test

#### Firefox Baed Browsers:

1. Clone/ Download Repo.
2. Type `about:debugging` in the search bar.
3. Press `This *browser name*` (Zen, Firefox, etc.).
4. Press `Load Temporary Add-on`.
5. Locate Extension Folder & Select `manifest.json`.

#### Chromium Baed Browsers:

1. Clone/ Download Repo.
2. Type `chrome://extensions` in the search bar.
3. Enable `Developer Mode`.
4. Press `Load Unpacked`.
5. Locate Extension Folder & Select it.



