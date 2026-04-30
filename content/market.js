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

function parseInputAmount(val) {
    const n = parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
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

        if (el.id === 'header_wallet_balance' && !el.dataset.ccHoverSetup && !strippingOnly && hoverOn) {
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

function convertGraphTooltips() {
    document.querySelectorAll(TOOLTIP_SELECTOR).forEach(tooltip => {
        if (tooltip.style.display === 'none') return;
        PRICE_REGEX.lastIndex = 0;
        if (!PRICE_REGEX.test(tooltip.textContent)) return;
        const walker = document.createTreeWalker(tooltip, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            PRICE_REGEX.lastIndex = 0;
            if (PRICE_REGEX.test(node.nodeValue)) {
                PRICE_REGEX.lastIndex = 0;
                node.nodeValue = node.nodeValue.replace(PRICE_REGEX, m => convertPriceText(m));
            }
        }
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
            totalDiv.textContent = convertPriceText(text);
            totalDiv.appendChild(document.createElement('br'));
            totalDiv.appendChild(document.createTextNode(`(${text})`));
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
        if (walletSpan) {
            const newSpan = document.createElement('span');
            newSpan.id = 'market_buyorder_dialog_walletbalance_amount';
            newSpan.textContent = formatted;
            walletSpan.textContent = '';
            walletSpan.appendChild(newSpan);
        }
        else amountSpan.textContent = formatted;
    }
}
