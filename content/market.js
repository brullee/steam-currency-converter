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

const TOOLTIP_SELECTOR = '.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip';

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
function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
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

        // Reuse the stored original only while the element still shows our output;
        // anything else is a fresh balance written by Steam (e.g. after a purchase).
        const current  = el.textContent.trim();
        const original = (el.dataset.ccOrig && current === el.dataset.ccConv) ? el.dataset.ccOrig : current;
        if (!PRICE_MATCH_REGEX.test(original)) continue;

        const converted = el.id === 'marketWalletBalanceAmount'
            ? withOriginal(original)
            : convertPriceText(original);
        setText(el, converted);

        // Attached once per page; the settings can change afterwards, so the handlers
        // check them on every hover instead of at setup.
        if (el.id === 'header_wallet_balance' && !el.dataset.ccHoverSetup) {
            el.dataset.ccHoverSetup = 'true';
            el.addEventListener('mouseenter', () => {
                if (!el.dataset.ccConv || !hoverOn || strippingOnly) return;
                el.dataset.ccHovering = 'true';
                el.textContent = formatOriginalText(el.dataset.ccOrig);
            });
            el.addEventListener('mouseleave', () => {
                if (!el.dataset.ccHovering) return;
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
    const receiveInput = document.getElementById('market_sell_currency_input');
    const buyerInput   = document.getElementById('market_sell_buyercurrency_input');
    const r = document.getElementById('cc_receive_preview');
    const b = document.getElementById('cc_buyer_preview');
    if (!rateReady || !receiveInput || !buyerInput || !r || !b) return;
    setText(r, inputPreviewLabel(parseInputAmount(receiveInput.value) * rate));
    setText(b, inputPreviewLabel(parseInputAmount(buyerInput.value) * rate));
}

function updateBuyPreviews() {
    const totalDiv = document.getElementById('market_buy_commodity_order_total');
    if (totalDiv) {
        const text = totalDiv.textContent.trim();
        if (PRICE_MATCH_REGEX.test(text)) {
            totalDiv.textContent = convertPriceText(text);
            totalDiv.appendChild(document.createElement('br'));
            totalDiv.appendChild(document.createTextNode(`(${text})`));
            totalDiv.dataset.ccOrig = text;
            totalDiv.dataset.ccConv = totalDiv.textContent;
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

    if (!priceInput.dataset.ccListeners) {
        priceInput.dataset.ccListeners = 'true';
        ['input', 'change'].forEach(ev => priceInput.addEventListener(ev, refreshBuyPreview));
    }
    refreshBuyPreview();

    const amountSpan = document.getElementById('market_buyorder_dialog_walletbalance_amount');
    if (amountSpan && PRICE_MATCH_REGEX.test(amountSpan.textContent.trim())) {
        const formatted  = withOriginal(amountSpan.textContent.trim());
        const walletSpan = document.getElementById('market_buyorder_dialog_walletbalance');
        if (walletSpan) {
            const newSpan = document.createElement('span');
            newSpan.id = 'market_buyorder_dialog_walletbalance_amount';
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

// Same reasoning as refreshSellPreviews: the listener outlives settings changes.
function refreshBuyPreview() {
    const priceInput = document.getElementById('market_buy_commodity_input_price');
    const lbl = document.getElementById('cc_buy_price_preview');
    if (!rateReady || !priceInput || !lbl) return;
    setText(lbl, toLabel(parseInputAmount(priceInput.value) * rate));
}

// Undoes everything this file writes, so new settings start from Steam's own page:
// original wallet texts and buy totals back, our preview labels and wallet row removed.
function restoreMarketElements() {
    for (const id of ['marketWalletBalanceAmount', 'header_wallet_balance']) {
        const el = document.getElementById(id);
        if (!el?.dataset.ccConv) continue;
        if (el.dataset.ccHovering || el.textContent.trim() === el.dataset.ccConv) el.textContent = el.dataset.ccOrig;
        delete el.dataset.ccOrig;
        delete el.dataset.ccConv;
        delete el.dataset.ccHovering;
    }

    const totalDiv = document.getElementById('market_buy_commodity_order_total');
    if (totalDiv?.dataset.ccOrig) {
        if (totalDiv.textContent === totalDiv.dataset.ccConv) totalDiv.textContent = totalDiv.dataset.ccOrig;
        delete totalDiv.dataset.ccOrig;
        delete totalDiv.dataset.ccConv;
    }

    const amountSpan = document.getElementById('market_buyorder_dialog_walletbalance_amount');
    if (amountSpan?.dataset.ccOrig) {
        amountSpan.textContent = amountSpan.dataset.ccOrig;
        delete amountSpan.dataset.ccOrig;
    }

    for (const id of ['cc_receive_preview', 'cc_buyer_preview', 'cc_buy_price_row']) {
        document.getElementById(id)?.remove();
    }
    // The wallet row wraps Steam's zoom controls — put them back where they were.
    document.querySelectorAll('.ext-wallet-row').forEach(row => {
        const zoom = row.querySelector('.pricehistory_zoom_controls');
        if (zoom) row.replaceWith(zoom); else row.remove();
    });
}
