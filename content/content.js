const CONFIG = {
    to: 'USD',       // overridden by stored.targetCurrency in init()
    customSymbol:   '',
    symbolPosition: '', // '' = use TO.position default
    symbolSpace:    false,
    decimalSep:       '', // '' = use TO locale default
    thousandsSep:     '', // '' = use TO locale default; 'none' = no separator
    hideZeroDecimals: false,
};

let FROM, PRICE_REGEX, PRICE_MATCH_REGEX, TO;

// True when FROM === TO and we're only stripping trailing codes — hover is suppressed
// because the "original" and "converted" values are the same currency.
let strippingOnly = false;

// Mirrors the "Strip trailing USD" popup checkbox.
// When true: " USD" is stripped from hover originals (hover shows "$9.99", not "$9.99 USD").
// When false: hover shows the full original including " USD".
let stripUsdTrail = false;

// Builds display metadata for any ISO 4217 currency code.
// Uses the hardcoded CURRENCIES entry when available (Steam-tested symbols),
// otherwise derives symbol and position from the browser's Intl API.
// Always adds: decimals (natural decimal places), localeDec, localeThou.
function buildToMeta(code) {
    let meta;
    if (CURRENCIES[code]) {
        meta = { ...CURRENCIES[code] };
    } else {
        try {
            const parts  = new Intl.NumberFormat('en', { style: 'currency', currency: code }).formatToParts(1);
            const symbol = parts.find(p => p.type === 'currency')?.value ?? code;
            const types  = parts.map(p => p.type);
            meta = { symbol, position: types.indexOf('currency') < types.indexOf('integer') ? 'before' : 'after', numberFormat: undefined };
        } catch {
            meta = { symbol: code, position: 'after', numberFormat: undefined };
        }
    }
    try {
        const parts     = new Intl.NumberFormat(meta.numberFormat ?? 'en-US').formatToParts(1000.1);
        meta.localeDec  = parts.find(p => p.type === 'decimal')?.value ?? '.';
        meta.localeThou = parts.find(p => p.type === 'group')?.value   ?? ',';
    } catch {
        meta.localeDec  = '.';
        meta.localeThou = ',';
    }
    return meta;
}

function buildRegexes(currency, stripTrailing = false) {
    // altSymbol: some currencies display differently on certain Steam pages
    // (e.g. PHP shows ₱ on search/browse but ASCII "P" on game pages).
    const sym = currency.altSymbol
        ? `(?:${escapeRegex(currency.symbol)}|${escapeRegex(currency.altSymbol)})`
        : escapeRegex(currency.symbol);
    const signPart = `([-\\u2212+]?)`;
    // Spaces are only consumed if followed by a digit/separator (thousands),
    // not if followed by a letter (e.g. the "U" in " USD"). This prevents the
    // trailing-code group from being blocked by a greedy space match.
    // requireDecimal: use a lazy quantifier that forces a [.,]NN ending, so
    // bare "R18" (age ratings) can't match ZAR's single-char symbol.
    const numPart = currency.requireDecimal
        ? `((?:[\\d.,\\u00A0]|\\s(?=[\\d.,\\u00A0]))+?[.,]\\d{2})`
        : `((?:[\\d.,\\u00A0]|\\s(?=[\\d.,\\u00A0]))+)`;
    // Only consume the trailing ISO code (e.g. " USD") when the user has opted in.
    // When off, " USD" stays in the text node so it remains visible after conversion.
    const trailingCode = stripTrailing ? `(?:\\s+[A-Z]{2,4})?` : '';
    const core = currency.position === 'before'
        ? `${sym}\\s*${signPart}${numPart}${trailingCode}`
        : `${signPart}${numPart}\\s*${sym}${trailingCode}`;
    return {
        scan:  new RegExp(core, 'g'),
        match: new RegExp(`^(\\s*)${core}$`),
    };
}

// Elements whose prices are handled manually — skipped by the text-node walker.
// Set for O(1) lookup: this check runs on every text node in the walker filter.
const MANAGED_IDS = new Set([
    'marketWalletBalanceAmount',
    'header_wallet_balance',
    'cc_receive_preview',
    'cc_buyer_preview',
    'ext-wallet-display',
    'market_buy_commodity_order_total',
    'market_buyorder_dialog_walletbalance_amount',
]);

function formatAmount(value, showDecimals = true) {
    // Always start from the locale-formatted string so currency-specific grouping
    // (UAH space, VND period, INR lakh groups, etc.) is preserved by default.
    const places = showDecimals ? 2 : 0;
    let result = value.toLocaleString(TO.numberFormat, { minimumFractionDigits: places, maximumFractionDigits: places });

    // Replace thousands separator only where the user has overridden it.
    // Split-join replaces all group characters at once.
    if (CONFIG.thousandsSep && TO.localeThou) {
        const replacement = CONFIG.thousandsSep === 'none' ? '' : CONFIG.thousandsSep;
        result = result.split(TO.localeThou).join(replacement);
    }

    // Replace decimal separator only where the user has overridden it.
    // lastIndexOf targets the decimal position (always rightmost separator).
    if (CONFIG.decimalSep && TO.localeDec) {
        const idx = result.lastIndexOf(TO.localeDec);
        if (idx !== -1) result = result.slice(0, idx) + CONFIG.decimalSep + result.slice(idx + TO.localeDec.length);
    }

    // Optionally strip the decimal part when it's .00 (or locale equivalent).
    // Only relevant when showDecimals is true — 0-place format already has no decimal.
    if (showDecimals && CONFIG.hideZeroDecimals) {
        const dec = CONFIG.decimalSep || TO.localeDec || '.';
        if (result.endsWith(`${dec}00`)) result = result.slice(0, -(dec.length + 2));
    }

    return result;
}

// "₪1.23" or "1.23₪" — plain converted price, no currency code prefix.
// srcHasDecimal: whether the source price text had a decimal part (e.g. "63,50" → true, "15" → false).
function toLabel(amount, srcHasDecimal = true) {
    const n   = formatAmount(amount, srcHasDecimal);
    const sym = CONFIG.customSymbol   || TO.symbol;
    const pos = CONFIG.symbolPosition || TO.position;
    const sp  = CONFIG.symbolSpace ? ' ' : '';
    return pos === 'before' ? `${sym}${sp}${n}` : `${n}${sp}${sym}`;
}

// "JOD: ₪1.23" — used in sell/buy input preview labels.
const inputPreviewLabel = amt => `Conversion: ${toLabel(amt)}`;

// "₪1.23 (₴100)" — converted price followed by original in parens.
function withOriginal(priceText) {
    return `${convertPriceText(priceText)} (${priceText})`;
}

// Steam prices always have exactly 2 decimal digits when a decimal exists (e.g. $3.99, 2.64€).
// So: if the last separator is followed by exactly 2 digits → it's decimal; everything else is thousands.
// This correctly handles ₩ 27,000 (→ 27000), 312.000₫ (→ 312000), and $9.99 (→ 9.99).
function parsePrice(numStr) {
    const s = numStr.replace(/[\s\u00A0]/g, '');
    const m = s.match(/^(.*)[,.](\d{2})$/);
    if (m) return parseFloat((m[1].replace(/[,.]/g, '') || '0') + '.' + m[2]);
    return parseFloat(s.replace(/[,.]/g, ''));
}

function convertPriceText(text) {
    const m = text.match(PRICE_MATCH_REGEX);
    if (!m) return text;
    const n = parsePrice(m[3]);
    if (isNaN(n)) return text;
    // In stripping-only mode (rate=1, same currency) preserve the source's decimal presence.
    // In conversion mode, always show 2 decimal places — the source having no decimal
    // (e.g. "59 UAH") is irrelevant to whether the converted JOD/USD value needs them.
    const srcHasDecimal = !strippingOnly || /[,.](\d{2})$/.test(m[3].replace(/[\s\u00A0]/g, ''));
    return `${m[1]}${m[2]}${toLabel(n * rate, srcHasDecimal)}`;
}

// Cache: parent element → resolved hover target. WeakMap so entries are
// garbage-collected automatically when the DOM element is removed.
const hoverTargetCache = new WeakMap();

// Walks up the DOM to find the best element to attach hover events to.
// Prefers the enclosing <a> or role=link/button so hovering anywhere on a card
// toggles the original price for all prices within it.
// Result is cached per element — findHoverTarget is called once per price node
// per run(), so caching eliminates the repeated DOM traversal on re-runs.
function findHoverTarget(el) {
    if (hoverTargetCache.has(el)) return hoverTargetCache.get(el);
    let result;
    const anchor = el.closest('a');
    if (anchor) {
        result = anchor;
    } else {
        const purchaseAction = el.closest('.game_purchase_action_bg, .game_purchase_action');
        if (purchaseAction) {
            result = purchaseAction;
        } else {
            const tabItem = el.closest('.tab_item');
            if (tabItem) {
                result = tabItem;
            } else {
                let cur = el.parentElement;
                while (cur && cur !== document.body) {
                    const role = cur.getAttribute('role');
                    if ((role === 'link' || role === 'button') && !cur.classList.contains('discount_block')) {
                        const par = cur.parentElement;
                        result = (par && par.querySelector(':scope > a')) ? par : cur;
                        break;
                    }
                    cur = cur.parentElement;
                }
                // New UI fallback: if no card-level role target was found, group prices
                // under the ancestor that owns the sale badge (StoreSaleDiscountBox) so
                // both the original and final prices toggle together on hover.
                if (!result) result = el.closest(':has(> .StoreSaleDiscountBox)') || el;
            }
        }
    }
    hoverTargetCache.set(el, result);
    return result;
}

// Registers a text node under a hover target so mousing over the target temporarily
// shows the original price. On re-runs (rate update), updates the stored converted
// text in place rather than adding a duplicate entry.
// _ccEntryMap (WeakMap keyed by textNode) gives O(1) deduplication lookup instead
// of the previous O(n) Array.find scan that ran once per price node per re-run.
function setupHover(hoverTarget, textNode, originalText, convertedText, ownerEl) {
    if (!hoverTarget._ccEntries) {
        hoverTarget._ccEntries = [];
        hoverTarget._ccEntryMap = new WeakMap();
        hoverTarget.addEventListener('mouseenter', () => {
            hoverTarget._ccEntries.forEach(e => {
                e.owner.dataset.ccHovering = 'true';
                e.textNode.textContent = e.original;
            });
        });
        hoverTarget.addEventListener('mouseleave', () => {
            hoverTarget._ccEntries.forEach(e => {
                delete e.owner.dataset.ccHovering;
                e.textNode.textContent = e.converted;
            });
        });
    }
    const existing = hoverTarget._ccEntryMap.get(textNode);
    if (existing) {
        existing.converted = convertedText; // rate changed — update without re-registering
    } else {
        const entry = { textNode, original: originalText, converted: convertedText, owner: ownerEl };
        hoverTarget._ccEntries.push(entry);
        hoverTarget._ccEntryMap.set(textNode, entry);
    }
}

// Converts all price text nodes within `root` (defaults to document.body for a
// full-page run). Extracted from run() so the MutationObserver can target only
// newly-added subtrees (e.g. lazy-loaded wishlist items) instead of re-walking
// the entire body every time Steam mutates the DOM on hover.
function runOnRoot(root) {
    if (!FROM || !rateReady) return;

    const rateKey = String(rate);
    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (MANAGED_IDS.has(parent.id)) return NodeFilter.FILTER_REJECT;
                if (parent.dataset.ccHovering)        return NodeFilter.FILTER_REJECT;
                // Already converted at the current rate — nothing to do.
                // This is the critical optimisation for wishlist performance: on every
                // MutationObserver re-run the vast majority of nodes fall here and are
                // rejected in O(1) without any regex work.
                if (parent.dataset.ccOrig &&
                    parent.dataset.ccRate === rateKey &&
                    node.textContent === parent.dataset.ccConv) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Accept nodes that contain FROM-currency prices or were already converted
                // (but need re-converting because the rate changed).
                PRICE_REGEX.lastIndex = 0;
                if (!PRICE_REGEX.test(node.textContent) && !parent.dataset.ccOrig) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentElement;
        // On re-runs, use the stored original to avoid compounding conversions.
        // But if the current text still contains FROM.symbol, the page has updated the price
        // since the last run (e.g. Steam applying a partial-bundle discount) — trust the
        // fresh textContent and discard the stale ccOrig.
        const currentText = node.textContent;
        PRICE_REGEX.lastIndex = 0;
        // hasFreshPrice is true only when FROM-currency prices appear and the current text
        // is NOT our own previously-converted output. Without the ccConv guard, currencies
        // whose symbol is a substring of the TO symbol (e.g. USD "$" inside AUD "A$") would
        // match converted text and re-convert it on every MutationObserver tick — infinite loop.
        const hasFreshPrice = PRICE_REGEX.test(currentText) && currentText !== parent.dataset.ccConv;
        // Use stored original unless the page has replaced the price (hasFreshPrice = true),
        // e.g. Steam updating a bundle discount after first render.
        const original = (parent.dataset.ccOrig && !hasFreshPrice) ? parent.dataset.ccOrig : currentText;
        PRICE_REGEX.lastIndex = 0;
        const converted = original.replace(PRICE_REGEX, m => convertPriceText(m));
        if (converted === original) continue;

        parent.dataset.ccOrig  = original;
        parent.dataset.ccConv  = converted;
        parent.dataset.ccRate  = rateKey;   // stamp the rate so re-runs skip this node
        node.textContent = converted;

        if (!strippingOnly) {
            // Strip " USD" from the hover display when the user opted in;
            // data-cc-orig always keeps the true original for re-run correctness.
            const hoverOriginal = stripUsdTrail
                ? original.replace(PRICE_REGEX, m => m.replace(/ USD$/, ''))
                : original;
            setupHover(findHoverTarget(parent), node, hoverOriginal, converted, parent);
        }
    }
}

function run() {
    if (!FROM || !rateReady) return;
    runOnRoot(document.body);
    convertGraphTooltips();
    const walletOriginal = convertWalletBalances();
    updateSellPreviews(walletOriginal);
    updateBuyPreviews();
}

// Converts the wallet balance elements and returns the original (unconverted) wallet text
// so the sell dialog can display it alongside its wallet label.
// Returns the original text from whichever wallet element is found first:
//   - #marketWalletBalanceAmount  (market page)
//   - #header_wallet_balance      (inventory / store pages)
function convertWalletBalances() {
    let walletOriginal = '';
    for (const selector of ['#marketWalletBalanceAmount', '#header_wallet_balance']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        if (el.dataset.ccHovering) continue;

        const original = el.dataset.ccOrig || el.textContent.trim();
        if (!PRICE_MATCH_REGEX.test(original)) continue;

        const converted = el.id === 'marketWalletBalanceAmount'
            ? withOriginal(original)
            : convertPriceText(original);
        el.textContent = converted;

        if (el.id === 'header_wallet_balance' && !el.dataset.ccHoverSetup && !strippingOnly) {
            el.dataset.ccHoverSetup = 'true';
            el.addEventListener('mouseenter', () => {
                el.dataset.ccHovering = 'true';
                el.textContent = el.dataset.ccOrig;
            });
            el.addEventListener('mouseleave', () => {
                delete el.dataset.ccHovering;
                el.textContent = el.dataset.ccConv;
            });
        }
        el.dataset.ccOrig = original;
        el.dataset.ccConv = converted;

        // Capture from whichever element we successfully processed first.
        // Previously only #marketWalletBalanceAmount set walletOriginal, so on the inventory
        // page (which only has #header_wallet_balance) the return value was always ''.
        if (!walletOriginal) walletOriginal = original;

        if (el.id === 'marketWalletBalanceAmount') {
            const walletLabel = document.getElementById('ext-wallet-display');
            if (walletLabel) walletLabel.textContent = `Wallet Balance: ${withOriginal(original)}`;
        }
    }
    return walletOriginal;
}

const TOOLTIP_SELECTOR = '.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip';

function convertGraphTooltips() {
    document.querySelectorAll(TOOLTIP_SELECTOR).forEach(tooltip => {
        if (tooltip.style.display === 'none') return;
        PRICE_REGEX.lastIndex = 0;
        if (!PRICE_REGEX.test(tooltip.textContent)) return;
        PRICE_REGEX.lastIndex = 0;
        const converted = tooltip.innerHTML.replace(PRICE_REGEX, m => convertPriceText(m));
        if (converted !== tooltip.innerHTML) tooltip.innerHTML = converted;
    });
}

// True when the content script is running inside an embedded iframe (e.g. the
// inventory frame that opens when clicking "Sell" on the market page). In that
// context the top-level header — and therefore the wallet balance — is not
// accessible, so sell-preview logic that depends on it must be skipped.
// Evaluated once at script load — this never changes during a page's lifetime.
const IS_IN_IFRAME = window !== window.top;

function updateSellPreviews(walletOriginalText = '') {
    const receiveInput = document.getElementById('market_sell_currency_input');
    const buyerInput   = document.getElementById('market_sell_buyercurrency_input');
    const zoomControls = document.querySelector('.pricehistory_zoom_controls');

    if (!receiveInput || !buyerInput) return;

    if (!document.getElementById('cc_receive_preview')) {
        const addLabel = (id, container, isWalletLabel = false) => {
            const lbl = document.createElement('div');
            lbl.id = id;
            if (isWalletLabel && zoomControls) {
                const row = document.createElement('div');
                row.className = 'ext-wallet-row';
                zoomControls.parentNode.insertBefore(row, zoomControls);
                row.appendChild(lbl);
                row.appendChild(zoomControls);
            } else if (container) {
                lbl.className = 'cc-input-preview';
                container.appendChild(lbl);
            }
            return lbl;
        };

        addLabel('cc_receive_preview', receiveInput.closest('.market_sell_dialog_input_group'));
        addLabel('cc_buyer_preview',   buyerInput.closest('.market_sell_dialog_input_group'));
        if (zoomControls && walletOriginalText && !IS_IN_IFRAME) {
            addLabel('ext-wallet-display', null, true).textContent = `Wallet Balance: ${withOriginal(walletOriginalText)}`;
        }
    }

    // Elements are guaranteed to exist here (created above or already present).
    const r = document.getElementById('cc_receive_preview');
    const b = document.getElementById('cc_buyer_preview');
    const refresh = () => {
        r.textContent = inputPreviewLabel(parseInputAmount(receiveInput.value) * rate);
        b.textContent = inputPreviewLabel(parseInputAmount(buyerInput.value) * rate);
    };

    if (!receiveInput.dataset.ccListeners) {
        receiveInput.dataset.ccListeners = 'true';
        ['input', 'change'].forEach(ev => {
            receiveInput.addEventListener(ev, refresh);
            buyerInput.addEventListener(ev, refresh);
        });
    }
    refresh();
}

function updateBuyPreviews() {
    const totalDiv = document.getElementById('market_buy_commodity_order_total');
    if (totalDiv) {
        const text = totalDiv.textContent.trim();
        if (PRICE_MATCH_REGEX.test(text)) {
            totalDiv.innerHTML = `${convertPriceText(text)}<br>(${text})`;
        }
    }

    const priceInput = document.getElementById('market_buy_commodity_input_price');
    if (!priceInput) return;

    if (!document.getElementById('cc_buy_price_preview')) {
        const lbl = document.createElement('div');
        lbl.id = 'cc_buy_price_preview';
        lbl.className = 'cc-input-preview';

        const valueCol = document.createElement('div');
        valueCol.className = 'market_buy_commodity_input';
        valueCol.appendChild(lbl);

        const labelCol = document.createElement('div');
        labelCol.className = 'market_buy_commodity_input_label';
        labelCol.textContent = 'Conversion:';

        const row = document.createElement('div');
        row.id = 'cc_buy_price_row';
        row.className = 'market_buy_commodity_input_row';
        row.appendChild(labelCol);
        row.appendChild(valueCol);

        const priceRow = priceInput.closest('.market_buy_commodity_input_row');
        if (priceRow) priceRow.before(row);
    }

    // Element is guaranteed to exist here (created above or already present).
    const lbl = document.getElementById('cc_buy_price_preview');
    const refresh = () => {
        lbl.textContent = toLabel(parseInputAmount(priceInput.value) * rate);
    };

    if (!priceInput.dataset.ccListeners) {
        priceInput.dataset.ccListeners = 'true';
        ['input', 'change'].forEach(ev => priceInput.addEventListener(ev, refresh));
    }
    refresh();

    const amountSpan = document.getElementById('market_buyorder_dialog_walletbalance_amount');
    if (amountSpan && PRICE_MATCH_REGEX.test(amountSpan.textContent.trim())) {
        const formatted  = withOriginal(amountSpan.textContent.trim());
        const walletSpan = document.getElementById('market_buyorder_dialog_walletbalance');
        if (walletSpan) walletSpan.innerHTML = `<span id="market_buyorder_dialog_walletbalance_amount">${formatted}</span>`;
        else amountSpan.textContent = formatted;
    }
}

function parseInputAmount(val) {
    const n = parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
}

function startObserver() {
    // Pending subtree roots collected between debounce ticks.
    // When the wishlist lazy-loads items we process only those new subtrees
    // instead of re-walking the entire body.
    const pendingRoots = new Set();
    let debounceTimer;

    const flush = () => {
        if (pendingRoots.size === 0) {
            // Nothing specific queued — full-body walk (cheap: ccRate stamp skips converted nodes).
            run();
        } else {
            // Process only the subtrees that were actually added to the DOM.
            pendingRoots.forEach(root => runOnRoot(root));
            convertGraphTooltips();
            const walletOriginal = convertWalletBalances();
            updateSellPreviews(walletOriginal);
            updateBuyPreviews();
        }
        pendingRoots.clear();
    };

    new MutationObserver(mutations => {
        // Fast path: all mutations are inside tooltip elements — only convert tooltips.
        if (mutations.every(m =>
            m.target.matches?.(TOOLTIP_SELECTOR) || m.target.closest?.(TOOLTIP_SELECTOR)
        )) {
            convertGraphTooltips();
            return;
        }

        // Collect newly added element subtrees (e.g. wishlist items loading in on scroll).
        // characterData mutations (including our own node.textContent writes) are ignored
        // here — ccRate stamping means the walker rejects already-converted nodes in O(1),
        // so the full-run fallback below is cheap even when Steam fires many text mutations.
        for (const m of mutations) {
            if (m.type !== 'childList') continue;
            for (const added of m.addedNodes) {
                if (added.nodeType === Node.ELEMENT_NODE) {
                    // Don't reprocess our own injected previews / wallet labels.
                    const id = added.id;
                    if (id && (id.startsWith('cc_') || id.startsWith('ext-') || id === 'cc_buy_price_row')) continue;
                    pendingRoots.add(added);
                }
            }
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, 100);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function init() {
    const stored = await chrome.storage.sync.get([
        'targetCurrency', 'fromCurrency', 'conversionEnabled',
        'stripTrailingCode', 'customSymbol', 'symbolPosition', 'symbolSpace', 'applyFormatting',
        'decimalSep', 'thousandsSep', 'hideZeroDecimals',
    ]);

    const conversionOn    = stored.conversionEnabled !== false;
    const applyFormatting = stored.applyFormatting || 'converted'; // 'converted' | 'unconverted' | 'both'
    stripUsdTrail         = !!stored.stripTrailingCode;

    if (stored.targetCurrency) CONFIG.to = stored.targetCurrency;

    const applyOnConvert = applyFormatting === 'converted'   || applyFormatting === 'both';
    const applyOnStrip   = applyFormatting === 'unconverted' || applyFormatting === 'both';

    const manualFrom = stored.fromCurrency && CURRENCIES[stored.fromCurrency]
        ? stored.fromCurrency : null;

    if (!manualFrom) {
        console.log('[CurrencyConverter] No store currency set — configure it in the popup.');
        return;
    }

    FROM = CURRENCIES[manualFrom];
    ({ scan: PRICE_REGEX, match: PRICE_MATCH_REGEX } = buildRegexes(FROM, stripUsdTrail));

    // Load custom formatting when it applies to the current mode.
    const shouldFormat = conversionOn ? applyOnConvert : applyOnStrip;
    if (shouldFormat) {
        CONFIG.customSymbol     = stored.customSymbol   || '';
        CONFIG.symbolPosition   = stored.symbolPosition || '';
        CONFIG.symbolSpace      = !!stored.symbolSpace;
        CONFIG.decimalSep       = stored.decimalSep     || '';
        CONFIG.thousandsSep     = stored.thousandsSep   || '';
        CONFIG.hideZeroDecimals = !!stored.hideZeroDecimals;
    }

    if (!conversionOn) {
        if (!stripUsdTrail && !applyOnStrip) {
            console.log('[CurrencyConverter] Conversion is disabled.');
            return;
        }
        TO = buildToMeta(manualFrom);
        startObserver();
        strippingOnly = true;
        rate = 1;
        rateReady = true;
        run();
        return;
    }

    TO = buildToMeta(CONFIG.to);
    startObserver();

    if (manualFrom === CONFIG.to) {
        if (!stripUsdTrail) return;
        strippingOnly = true;
        rate = 1;
        rateReady = true;
        run();
        return;
    }

    console.log(`[CurrencyConverter] FROM: ${manualFrom} → TO: ${CONFIG.to}`);
    fetchRate(manualFrom, CONFIG.to);
}

init();
