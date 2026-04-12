const CONFIG = {
    to: 'USD', // overridden by stored.targetCurrency in init()
};

// Set once FROM is known (manual override in init, or lazy detection in run).
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
function buildToMeta(code) {
    if (CURRENCIES[code]) return CURRENCIES[code];
    try {
        const parts    = new Intl.NumberFormat('en', { style: 'currency', currency: code }).formatToParts(1);
        const symbol   = parts.find(p => p.type === 'currency')?.value ?? code;
        const types    = parts.map(p => p.type);
        const position = types.indexOf('currency') < types.indexOf('integer') ? 'before' : 'after';
        return { symbol, position, numberFormat: undefined };
    } catch {
        return { symbol: code, position: 'after', numberFormat: undefined };
    }
}

function buildRegexes(currency) {
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
    // Some Steam regions append the ISO code after the price (e.g. "$9.99 USD").
    // The optional trailing group consumes it so it doesn't leak into converted output.
    const trailingCode = `(?:\\s+[A-Z]{2,4})?`;
    const core = currency.position === 'before'
        ? `${sym}\\s*${signPart}${numPart}${trailingCode}`
        : `${signPart}${numPart}\\s*${sym}${trailingCode}`;
    return {
        scan:  new RegExp(core, 'g'),
        match: new RegExp(`^(\\s*)${core}$`),
    };
}

// Scans page text for the first currency whose pattern matches any price.
// Tries longer symbols first to avoid false matches (e.g. CDN$ before $, R$ before R).
// JPY and CNY share ¥ — disambiguated by decimal point presence (JPY is integer-only).
function detectFromCurrency() {
    const bodyText = document.body.textContent;
    const sorted = Object.entries(CURRENCIES)
        .sort(([, a], [, b]) => b.symbol.length - a.symbol.length);
    for (const [code, currency] of sorted) {
        const { scan } = buildRegexes(currency);
        scan.lastIndex = 0;
        const m = scan.exec(bodyText);
        if (!m) continue;
        if (code === 'JPY') return m[2].includes('.') ? 'CNY' : 'JPY';
        return code;
    }
    return null; // prices not visible yet
}

// Elements whose prices are handled manually — skipped by the text-node walker.
const MANAGED_IDS = [
    'marketWalletBalanceAmount',
    'header_wallet_balance',
    'cc_receive_preview',
    'cc_buyer_preview',
    'ext-wallet-display',
    'market_buy_commodity_order_total',
    'market_buyorder_dialog_walletbalance_amount',
];

function formatAmount(value) {
    return value.toLocaleString(TO.numberFormat, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "₪1.23" or "1.23₪" — plain converted price, no currency code prefix.
function toLabel(amount) {
    const n = formatAmount(amount);
    return TO.position === 'before' ? `${TO.symbol}${n}` : `${n}${TO.symbol}`;
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
    return `${m[1]}${m[2]}${toLabel(n * rate)}`;
}

// Walks up the DOM to find the best element to attach hover events to.
// Prefers the enclosing <a> or role=link/button so hovering anywhere on a card
// toggles the original price for all prices within it.
function findHoverTarget(el) {
    const anchor = el.closest('a');
    if (anchor) return anchor;
    const purchaseAction = el.closest('.game_purchase_action_bg, .game_purchase_action');
    if (purchaseAction) return purchaseAction;
    const tabItem = el.closest('.tab_item');
    if (tabItem) return tabItem;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
        const role = cur.getAttribute('role');
        if ((role === 'link' || role === 'button') && !cur.classList.contains('discount_block')) {
            const par = cur.parentElement;
            if (par && par.querySelector(':scope > a')) return par;
            return cur;
        }
        cur = cur.parentElement;
    }
    return el;
}

// Registers a text node under a hover target so mousing over the target temporarily
// shows the original price. On re-runs (rate update), updates the stored converted
// text in place rather than adding a duplicate entry.
function setupHover(hoverTarget, textNode, originalText, convertedText, ownerEl) {
    if (!hoverTarget._ccEntries) {
        hoverTarget._ccEntries = [];
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
    const existing = hoverTarget._ccEntries.find(e => e.textNode === textNode);
    if (existing) {
        existing.converted = convertedText; // rate changed — update without re-registering
    } else {
        hoverTarget._ccEntries.push({ textNode, original: originalText, converted: convertedText, owner: ownerEl });
    }
}

function run() {
    if (!FROM) {
        // Lazy detection: try to identify the store currency from visible prices.
        // Called immediately for static pages; the observer retries on each DOM mutation
        // until prices appear (handles SPAs like the cart).
        const detected = detectFromCurrency();
        if (!detected) return; // nothing rendered yet — try again on next mutation
        FROM = CURRENCIES[detected];
        ({ scan: PRICE_REGEX, match: PRICE_MATCH_REGEX } = buildRegexes(FROM));
        if (detected === CONFIG.to) {
            if (!stripUsdTrail) return; // same currency, nothing to do
            strippingOnly = true;
            rate = 1;
            rateReady = true;
            // fall through to convert (strip trailing codes)
        } else {
            console.log(`[CurrencyConverter] FROM: ${detected} → TO: ${CONFIG.to}`);
            fetchRate(detected, CONFIG.to); // calls run() when ready
            return;
        }
    }
    if (!rateReady) return;

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                const parent = node.parentElement;
                if (MANAGED_IDS.includes(parent.id)) return NodeFilter.FILTER_REJECT;
                if (parent.dataset.ccHovering)        return NodeFilter.FILTER_REJECT;
                // Accept nodes that contain FROM-currency prices or were already converted.
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
        const hasFreshPrice = PRICE_REGEX.test(currentText);
        // Use stored original unless the page has replaced the price (hasFreshPrice = true),
        // e.g. Steam updating a bundle discount after first render.
        const original = (parent.dataset.ccOrig && !hasFreshPrice) ? parent.dataset.ccOrig : currentText;
        PRICE_REGEX.lastIndex = 0;
        const converted = original.replace(PRICE_REGEX, m => convertPriceText(m));
        if (converted === original) continue;

        parent.dataset.ccOrig = original;
        node.textContent = converted;

        if (!strippingOnly) {
            // When the checkbox is on, strip " USD" from the hover display too.
            // When off, hover shows the full original including " USD".
            // data-cc-orig always keeps the true original for re-run correctness.
            const hoverOriginal = stripUsdTrail
                ? original.replace(PRICE_REGEX, m => m.replace(/ USD$/, ''))
                : original;
            setupHover(findHoverTarget(parent), node, hoverOriginal, converted, parent);
        }
    }

    convertGraphTooltips();
    const walletOriginal = convertWalletBalances();
    updateSellPreviews(walletOriginal);
    updateBuyPreviews();
}

// Converts the wallet balance elements and returns the original (unconverted) wallet text
// so the sell dialog can display it alongside its wallet label.
function convertWalletBalances() {
    for (const selector of ['#marketWalletBalanceAmount', '#header_wallet_balance']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        if (el.dataset.ccHovering) return el.dataset.ccOrig || '';

        const original = el.dataset.ccOrig || el.textContent.trim();
        if (!PRICE_MATCH_REGEX.test(original)) continue;

        const converted = el.id === 'marketWalletBalanceAmount'
            ? withOriginal(original)
            : convertPriceText(original);
        el.textContent = converted;

        if (!el.dataset.ccHoverSetup) {
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

        const walletLabel = document.getElementById('ext-wallet-display');
        if (walletLabel) walletLabel.textContent = `Wallet Balance: ${withOriginal(original)}`;

        return original;
    }
    return '';
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
        if (zoomControls) {
            addLabel('ext-wallet-display', null, true).textContent = `Wallet Balance: ${withOriginal(walletOriginalText)}`;
        }
    }

    const refresh = () => {
        const r = document.getElementById('cc_receive_preview');
        const b = document.getElementById('cc_buyer_preview');
        if (r) r.textContent = inputPreviewLabel(parseInputAmount(receiveInput.value) * rate);
        if (b) b.textContent = inputPreviewLabel(parseInputAmount(buyerInput.value) * rate);
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
        const container = priceInput.closest('.market_buy_commodity_input');
        if (container) container.insertBefore(lbl, container.firstChild);
    }

    const refresh = () => {
        const lbl = document.getElementById('cc_buy_price_preview');
        if (lbl) lbl.textContent = inputPreviewLabel(parseInputAmount(priceInput.value) * rate);
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

let debounceTimer;
const scheduleRun = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 100);
};

function startObserver() {
    new MutationObserver(mutations =>
        mutations.every(m => m.target.matches?.(TOOLTIP_SELECTOR) || m.target.closest?.(TOOLTIP_SELECTOR))
            ? convertGraphTooltips()
            : scheduleRun()
    ).observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function init() {
    const stored = await chrome.storage.sync.get(['targetCurrency', 'fromCurrency', 'stripTrailingCode', 'conversionEnabled']);
    if (stored.conversionEnabled === false) {
        console.log('[CurrencyConverter] Conversion is disabled.');
        return;
    }
    stripUsdTrail = !!stored.stripTrailingCode;
    if (stored.targetCurrency) CONFIG.to = stored.targetCurrency;
    TO = buildToMeta(CONFIG.to);

    startObserver();

    const manualFrom = stored.fromCurrency && CURRENCIES[stored.fromCurrency]
        ? stored.fromCurrency : null;

    if (manualFrom) {
        // User has explicitly set their store currency — trust it, skip detection.
        FROM = CURRENCIES[manualFrom];
        ({ scan: PRICE_REGEX, match: PRICE_MATCH_REGEX } = buildRegexes(FROM));
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
    } else {
        // No override — detect lazily; run() will retry on each DOM mutation until prices appear.
        run();
    }
}

init();
