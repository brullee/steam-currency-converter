// Elements whose prices are handled manually — skipped by the text-node walker.
// Set for O(1) lookup: this check runs on every text node in the walker filter.
const MANAGED_IDS = new Set([
    STEAM.marketWallet,
    STEAM.headerWallet,
    'cc_receive_preview',
    'cc_buyer_preview',
    'ext-wallet-display',
    STEAM.buyOrderTotal,
    STEAM.buyOrderWalletAmt,
]);

const TOOLTIP_SELECTOR = STEAM.graphTooltip;

// True when the content script is running inside an embedded iframe (e.g. the
// inventory frame that opens when clicking "Sell" on the market page). In that
// context the top-level header — and therefore the wallet balance — is not
// accessible, so sell-preview logic that depends on it must be skipped.
// Evaluated once at script load — this never changes during a page's lifetime.
const IS_IN_IFRAME = window !== window.top;

// Parses a sell/buy input like "$1,234.56", "1.234,56€" or "S/.6.46".
// The store symbol is removed first so separators inside it (PEN "S/.", RUB "руб.")
// aren't read as part of the number. The last separator is the decimal point when
// 1–2 digits follow it (also covers "12,5" mid-typing); all others are thousands.
function parseInputAmount(val) {
    let s = val;
    for (const sym of [FROM.symbol, FROM.altSymbol]) if (sym) s = s.split(sym).join('');
    s = s.replace(/[^\d.,]/g, '');
    const m = s.match(/^(.*)[.,](\d{1,2})$/);
    const n = m
        ? parseFloat((m[1].replace(/[.,]/g, '') || '0') + '.' + m[2])
        : parseFloat(s.replace(/[.,]/g, ''));
    return isNaN(n) ? 0 : n;
}

// Writing textContent always fires a mutation, even when unchanged — and every
// mutation schedules another observer pass. Only write when the text differs.
// Takes an element or a single text node.
function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
}

// The wallet element's own balance text. With pending funds Steam adds a child
// ("176,15₴<span>Pending: 5,00₴</span>"), so the element's full textContent is no
// longer a single price. Only the direct text node is ours; the walker converts
// the pending child like any other price.
function walletTextNode(el) {
    for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) return n;
    }
    return null;
}

// Converts the wallet balance elements and returns the original (unconverted) wallet text
// so the sell dialog can display it alongside its wallet label.
// Returns the original text from whichever wallet element is found first:
//   - #marketWalletBalanceAmount  (market page)
//   - #header_wallet_balance      (inventory / store pages)
function convertWalletBalances() {
    let walletOriginal = '';
    for (const id of [STEAM.marketWallet, STEAM.headerWallet]) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.dataset.ccHovering) continue;
        const node = walletTextNode(el);
        if (!node) continue;

        // Reuse the stored original only while the element still shows our output;
        // anything else is a fresh balance written by Steam (e.g. after a purchase).
        const current  = node.textContent.trim();
        const original = (el.dataset.ccOrig && current === el.dataset.ccConv) ? el.dataset.ccOrig : current;
        if (!matchPrice(original)) continue;

        const converted = el.id === STEAM.marketWallet
            ? withOriginal(original)
            : convertPriceText(original);
        setText(node, converted);

        // Attached once per page; the settings can change afterwards, so the handlers
        // check them on every hover instead of at setup. They look the text node up
        // each time, since Steam may have replaced it since.
        if (el.id === STEAM.headerWallet && !el.dataset.ccHoverSetup) {
            el.dataset.ccHoverSetup = 'true';
            el.addEventListener('mouseenter', () => {
                const n = walletTextNode(el);
                if (!n || !el.dataset.ccConv || !hoverOn || strippingOnly) return;
                el.dataset.ccHovering = 'true';
                n.textContent = formatOriginalText(el.dataset.ccOrig);
            });
            el.addEventListener('mouseleave', () => {
                if (!el.dataset.ccHovering) return;
                delete el.dataset.ccHovering;
                const n = walletTextNode(el);
                if (n) n.textContent = el.dataset.ccConv;
            });
        }
        el.dataset.ccOrig = original;
        el.dataset.ccConv = converted;

        // Capture from whichever element we successfully processed first.
        // Previously only #marketWalletBalanceAmount set walletOriginal, so on the inventory
        // page (which only has #header_wallet_balance) the return value was always ''.
        if (!walletOriginal) walletOriginal = original;

        if (el.id === STEAM.marketWallet) {
            const walletLabel = document.getElementById('ext-wallet-display');
            if (walletLabel) setText(walletLabel, `Wallet Balance: ${withOriginal(original)}`);
        }
    }
    return walletOriginal;
}

// jqplot rewrites the tooltip on every mouse move. Running the regular walker on it
// (instead of a separate replace pass) shares textState, so a tooltip node is never
// converted twice — that used to compound for "$"-family targets (USD → A$, R$, ...).
function convertGraphTooltips() {
    document.querySelectorAll(TOOLTIP_SELECTOR).forEach(tooltip => {
        if (tooltip.style.display === 'none') return;
        runOnRoot(tooltip);
    });
}

function updateSellPreviews(walletOriginalText = '') {
    const receiveInput = document.getElementById(STEAM.sellReceiveInput);
    const buyerInput   = document.getElementById(STEAM.sellBuyerInput);
    const zoomControls = document.querySelector(STEAM.graphZoomControls);

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

        addLabel('cc_receive_preview', receiveInput.closest(STEAM.sellInputGroup));
        addLabel('cc_buyer_preview',   buyerInput.closest(STEAM.sellInputGroup));
        if (zoomControls && walletOriginalText && !IS_IN_IFRAME) {
            addLabel('ext-wallet-display', null, true).textContent = `Wallet Balance: ${withOriginal(walletOriginalText)}`;
        }
    }

    if (!receiveInput.dataset.ccListeners) {
        receiveInput.dataset.ccListeners = 'true';
        ['input', 'change'].forEach(ev => {
            receiveInput.addEventListener(ev, refreshSellPreviews);
            buyerInput.addEventListener(ev, refreshSellPreviews);
        });
    }
    refreshSellPreviews();
}

// Looks everything up on each call: the listeners outlive a settings change, which
// removes the preview labels and may stop conversion altogether.
function refreshSellPreviews() {
    const receiveInput = document.getElementById(STEAM.sellReceiveInput);
    const buyerInput   = document.getElementById(STEAM.sellBuyerInput);
    const r = document.getElementById('cc_receive_preview');
    const b = document.getElementById('cc_buyer_preview');
    if (!rateReady || !receiveInput || !buyerInput || !r || !b) return;
    setText(r, inputPreviewLabel(parseInputAmount(receiveInput.value) * rate));
    setText(b, inputPreviewLabel(parseInputAmount(buyerInput.value) * rate));
}

function updateBuyPreviews() {
    const totalDiv = document.getElementById(STEAM.buyOrderTotal);
    if (totalDiv) {
        const text = totalDiv.textContent.trim();
        if (matchPrice(text)) {
            totalDiv.textContent = convertPriceText(text);
            totalDiv.appendChild(document.createElement('br'));
            totalDiv.appendChild(document.createTextNode(`(${text})`));
            totalDiv.dataset.ccOrig = text;
            totalDiv.dataset.ccConv = totalDiv.textContent;
        }
    }

    const priceInput = document.getElementById(STEAM.buyOrderPrice);
    if (!priceInput) return;

    if (!document.getElementById('cc_buy_price_preview')) {
        const lbl = document.createElement('div');
        lbl.id = 'cc_buy_price_preview';
        lbl.className = 'cc-input-preview';

        const valueCol = document.createElement('div');
        valueCol.className = STEAM.buyOrderInputCol;
        valueCol.appendChild(lbl);

        const labelCol = document.createElement('div');
        labelCol.className = STEAM.buyOrderLabelCol;
        labelCol.textContent = 'Conversion:';

        const row = document.createElement('div');
        row.id = 'cc_buy_price_row';
        row.className = STEAM.buyOrderRow;
        row.appendChild(labelCol);
        row.appendChild(valueCol);

        const priceRow = priceInput.closest(`.${STEAM.buyOrderRow}`);
        if (priceRow) priceRow.before(row);
    }

    if (!priceInput.dataset.ccListeners) {
        priceInput.dataset.ccListeners = 'true';
        ['input', 'change'].forEach(ev => priceInput.addEventListener(ev, refreshBuyPreview));
    }
    refreshBuyPreview();

    const amountSpan = document.getElementById(STEAM.buyOrderWalletAmt);
    if (amountSpan && matchPrice(amountSpan.textContent.trim())) {
        const formatted  = withOriginal(amountSpan.textContent.trim());
        const walletSpan = document.getElementById(STEAM.buyOrderWallet);
        if (walletSpan) {
            const newSpan = document.createElement('span');
            newSpan.id = STEAM.buyOrderWalletAmt;
            newSpan.textContent = formatted;
            newSpan.dataset.ccOrig = amountSpan.textContent.trim();
            walletSpan.textContent = '';
            walletSpan.appendChild(newSpan);
        } else {
            amountSpan.dataset.ccOrig = amountSpan.textContent.trim();
            amountSpan.textContent = formatted;
        }
    }
}

// ---- Market beta ----
// The beta market is a React app with class names hashed per build, so nothing here
// keys on them. Its dialogs are native <dialog> elements; the buy order form is the
// one with exactly two text inputs (price, quantity).

// The original-price text of a single-price text node, whether or not the walker has
// converted it yet. Null for anything that isn't one whole FROM price.
function originalPriceOf(node) {
    const st = textState.get(node);
    const text = (st && node.textContent === st.conv ? st.orig : node.textContent).trim();
    return matchPrice(text) ? text : null;
}

// In a dialog, Steam's own amount is what actually gets charged, so it stays visible
// next to each converted price (CSS ::after reads data-cc-original). React owns these
// spans: we only set an attribute, never add nodes inside them.
function annotateDialogPrices() {
    for (const dialog of document.querySelectorAll(STEAM.betaDialog)) {
        const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
            const el = node.parentElement;
            if (!el || el.classList.contains('cc-own') || el.childNodes.length !== 1) continue;
            // Mid-hover the text is the original on purpose; leave the label as it is,
            // or the box changes size under the cursor.
            if (el.dataset.ccHovering) continue;
            const st = textState.get(node);
            const converted = !strippingOnly && st && node.textContent === st.conv && originalPriceOf(node);
            const label = converted ? formatOriginalText(st.orig) : null;
            if (label) {
                if (el.dataset.ccOriginal !== label) el.dataset.ccOriginal = label;
            } else if (el.dataset.ccOriginal !== undefined) {
                delete el.dataset.ccOriginal;
            }
        }
    }
}

// Buy order dialog: "≈ €18.92 per item" under the price input. The input may be in
// Steam's local display currency (e.g. ₴ for a USD wallet in Ukraine), but the maximum
// price is always the wallet currency and equals price × quantity — so the per-item
// price comes from there. Steam rewrites the maximum on every keystroke, and that
// mutation brings us back here, so no input listeners are needed.
function updateBetaOrderPreview() {
    let preview = document.getElementById('cc_order_preview');
    const form = [...document.querySelectorAll(`${STEAM.betaDialog} form`)]
        .find(f => f.querySelectorAll('input[type="text"]').length === 2);
    if (!form || strippingOnly) { preview?.remove(); return; }

    const [priceInput, qtyInput] = form.querySelectorAll('input[type="text"]');
    let grid = priceInput.parentElement;
    while (grid && !grid.contains(qtyInput)) grid = grid.parentElement;
    if (!grid) return;

    let maxOriginal = null;
    for (const cell of grid.children) {
        if (cell.childNodes.length === 1 && cell.firstChild.nodeType === Node.TEXT_NODE) {
            maxOriginal = originalPriceOf(cell.firstChild);
            if (maxOriginal) break;
        }
    }
    const m = maxOriginal && matchPrice(maxOriginal);
    const qty = parseInt(qtyInput.value, 10);
    if (!m || !(qty > 0)) { preview?.remove(); return; }

    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'cc_order_preview';
        preview.className = 'cc-own cc-chip';
        const value = document.createElement('span');
        value.className = 'cc-own cc-chip-value';
        const unit = document.createElement('span');
        unit.className = 'cc-own cc-chip-muted';
        unit.textContent = 'per item';
        preview.append(value, unit);
    }
    // Right under the price input: after the input's cell and its "(per item)" suffix.
    const inputCell = [...grid.children].find(c => c.contains(priceInput));
    const anchor = inputCell?.nextElementSibling;
    if (anchor && anchor.nextElementSibling !== preview) anchor.after(preview);

    setText(preview.firstChild, `≈ ${toLabel(parsePrice(m[3]) / qty * rate)}`);
}

// Price filters (listing page sidebar, Advanced Search): a min and a max input, each
// with a currency adornment ("₴"), beside role=slider handles. The amounts are in
// Steam's display currency, so a chip under the slider shows the range converted:
// "≈ 4,73€ to 18,92€". Found by that structure, not by class names.
function findPriceFilters() {
    const filters = new Set();
    for (const slider of document.querySelectorAll('[role="slider"]')) {
        let box = slider.parentElement;
        for (let depth = 0; box && box !== document.body && depth < 6; depth++, box = box.parentElement) {
            if (box.querySelectorAll('input[type="text"]').length >= 2) { filters.add(box); break; }
        }
    }
    return [...filters];
}

// The currency a filter input is in, from the adornment next to it: an ISO code, or a
// symbol (the store currency's first, since "$" is shared by several).
function filterCurrency(input) {
    const wrap = input.closest('[data-has-value]') || input.parentElement?.parentElement;
    const adorn = wrap && [...wrap.querySelectorAll('*')]
        .find(e => e !== input && e.childElementCount === 0 && e.textContent.trim())?.textContent.trim();
    if (!adorn) return null;
    if (CURRENCIES[adorn]) return adorn;
    if (FROM && (adorn === FROM.symbol || adorn === FROM.altSymbol)) return FROM_CODE;
    const codes = Object.keys(CURRENCIES).filter(c => CURRENCIES[c].symbol === adorn || CURRENCIES[c].altSymbol === adorn);
    return codes.length === 1 ? codes[0] : null;
}

function updatePriceFilterPreviews() {
    for (const box of findPriceFilters()) {
        const [minInput, maxInput] = box.querySelectorAll('input[type="text"]');
        let chip = box.querySelector(':scope > .cc-range-chip');
        const code = filterCurrency(minInput);
        const r = !code || strippingOnly || code === CONFIG.to ? null
            : code === FROM_CODE ? rate
            : codeRates.get(code);
        if (r === undefined) requestCodeRate(code);
        const amount = input => {
            const v = input.value.replace(/[^\d.,]/g, '');
            return v ? parsePrice(v) : NaN;
        };
        // Typing and dragging the slider don't change the DOM (React sets the input's
        // value property), so the filter is refreshed on input and pointer events. Read
        // a frame later, after React has applied the change.
        if (!box.dataset.ccListeners) {
            box.dataset.ccListeners = 'true';
            let queued = false;
            const refresh = () => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(() => { queued = false; if (rateReady) updatePriceFilterPreviews(); });
            };
            for (const ev of ['input', 'change', 'pointermove', 'pointerup', 'keyup']) box.addEventListener(ev, refresh);
        }

        const lo = amount(minInput), hi = amount(maxInput);
        const label = !r ? null
            : !isNaN(lo) && !isNaN(hi) ? `≈ ${toLabel(lo * r)} to ${toLabel(hi * r)}`
            : !isNaN(lo) ? `≥ ${toLabel(lo * r)}`
            : !isNaN(hi) ? `≤ ${toLabel(hi * r)}`
            : null;
        if (!label) { chip?.remove(); continue; }

        if (!chip) {
            chip = document.createElement('div');
            chip.id = `cc_range_${++priceFilterCount}`;
            chip.className = 'cc-own cc-chip cc-range-chip';
            const value = document.createElement('span');
            value.className = 'cc-own cc-chip-value';
            chip.append(value);
            box.append(chip);
        }
        setText(chip.firstChild, label);
    }
}
let priceFilterCount = 0;

// Same reasoning as refreshSellPreviews: the listener outlives settings changes.
function refreshBuyPreview() {
    const priceInput = document.getElementById(STEAM.buyOrderPrice);
    const lbl = document.getElementById('cc_buy_price_preview');
    if (!rateReady || !priceInput || !lbl) return;
    setText(lbl, toLabel(parseInputAmount(priceInput.value) * rate));
}

// Undoes everything this file writes, so new settings start from Steam's own page:
// original wallet texts and buy totals back, our preview labels and wallet row removed.
function restoreMarketElements() {
    for (const id of [STEAM.marketWallet, STEAM.headerWallet]) {
        const el = document.getElementById(id);
        if (!el?.dataset.ccConv) continue;
        const node = walletTextNode(el);
        if (node && (el.dataset.ccHovering || node.textContent.trim() === el.dataset.ccConv)) node.textContent = el.dataset.ccOrig;
        delete el.dataset.ccOrig;
        delete el.dataset.ccConv;
        delete el.dataset.ccHovering;
    }

    const totalDiv = document.getElementById(STEAM.buyOrderTotal);
    if (totalDiv?.dataset.ccOrig) {
        if (totalDiv.textContent === totalDiv.dataset.ccConv) totalDiv.textContent = totalDiv.dataset.ccOrig;
        delete totalDiv.dataset.ccOrig;
        delete totalDiv.dataset.ccConv;
    }

    const amountSpan = document.getElementById(STEAM.buyOrderWalletAmt);
    if (amountSpan?.dataset.ccOrig) {
        amountSpan.textContent = amountSpan.dataset.ccOrig;
        delete amountSpan.dataset.ccOrig;
    }

    document.querySelectorAll('[data-cc-original]').forEach(el => delete el.dataset.ccOriginal);
    document.querySelectorAll('.cc-range-chip').forEach(el => el.remove());

    for (const id of ['cc_receive_preview', 'cc_buyer_preview', 'cc_buy_price_row', 'cc_order_preview']) {
        document.getElementById(id)?.remove();
    }
    // The wallet row wraps Steam's zoom controls — put them back where they were.
    document.querySelectorAll('.ext-wallet-row').forEach(row => {
        const zoom = row.querySelector(STEAM.graphZoomControls);
        if (zoom) row.replaceWith(zoom); else row.remove();
    });
}
