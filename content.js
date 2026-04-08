// 1. SETTINGS
const CONFIG = {
    from: { symbol: '\u20B4', code: 'UAH' },
    to:   { symbol: '$',     code: 'USD', locale: 'en-US' },
    rate:  0.022891511,
};

const CONVERTED_ATTR = "data-steam-converted";
const PRICE_REGEX       = new RegExp(`([-\u2212+]?)([\\d\\s.,\u00A0]+)${CONFIG.from.symbol}`, 'g');
const PRICE_MATCH_REGEX = new RegExp(`^(\\s*)([-\u2212+]?)([\\d\\s.,\u00A0]+)${CONFIG.from.symbol}$`);

// 2. THE CONVERTER ENGINE
function convertPrice(text) {
    const match = text.match(PRICE_MATCH_REGEX);
    if (!match) return text;

    const whitespace = match[1];
    const sign = match[2];
    const numberPart = match[3];

    const rawNumber = numberPart.replace(/[\s\u00A0]/g, '').replace(',', '.');
    const numericValue = parseFloat(rawNumber);

    if (isNaN(numericValue)) return text;

    const converted = numericValue * CONFIG.rate;
    const formatted = converted.toLocaleString(CONFIG.to.locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return `${whitespace}${sign}${CONFIG.to.symbol}${formatted}`;
}

function run() {
    // Create a Walker that ONLY looks at text nodes
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Skip if it doesn't have the symbol or is inside an already converted parent
                if (!node.textContent.includes(CONFIG.from.symbol)) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.hasAttribute(CONVERTED_ATTR)) return NodeFilter.FILTER_REJECT;
                
                // Skip Wallet/Sell Dialog IDs
                const parentId = node.parentElement.id;
                if (['marketWalletBalanceAmount', 'header_wallet_balance', 'usd_receive_preview', 'usd_buyer_preview', 'ext-wallet-display'].includes(parentId)) {
                    return NodeFilter.FILTER_REJECT;
                }
                
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentElement;
        const originalText = node.textContent;
        const newText = originalText.replace(PRICE_REGEX, (match) => convertPrice(match));

        if (newText !== originalText) {
            parent.setAttribute(CONVERTED_ATTR, "true");
            node.textContent = newText;

            // Hover toggle (on the parent, since text nodes can't have listeners)
            parent.onmouseenter = () => { if (parent.childNodes[0]) parent.childNodes[0].textContent = originalText; };
            parent.onmouseleave = () => { if (parent.childNodes[0]) parent.childNodes[0].textContent = newText; };
        }
    }

    handleGraphTooltip();
    handleSellInputs(handleUniversalWallet());
}


// 4. SPECIALTY HANDLERS
function handleUniversalWallet() {
    for (const selector of ['#marketWalletBalanceAmount', '#header_wallet_balance']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const original = el.textContent.trim();
        if (!PRICE_MATCH_REGEX.test(original)) continue; // already converted or not a price

        const converted = convertPrice(original);
        el.textContent = el.id === 'marketWalletBalanceAmount'
            ? `${converted} (${original})`
            : converted;
        el.setAttribute(CONVERTED_ATTR, 'true');

        const wLabel = document.getElementById('ext-wallet-display');
        if (wLabel) wLabel.textContent = `Wallet Balance: ${converted} (${original})`;

        return original;
    }
    return '';
}

function handleGraphTooltip() {
    const tooltips = document.querySelectorAll('.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip');
    tooltips.forEach(tooltip => {
        if (tooltip.style.display === 'none' || !tooltip.textContent.includes(CONFIG.from.symbol)) return;
        const newHtml = tooltip.innerHTML.replace(PRICE_REGEX, (match) => convertPrice(match));
        if (newHtml !== tooltip.innerHTML) {
            tooltip.innerHTML = newHtml;
        }
    });
}

function handleSellInputs(originalWalletText = '') {
    const receiveInput = document.getElementById('market_sell_currency_input');
    const buyerInput = document.getElementById('market_sell_buyercurrency_input');
    const zoomControls = document.querySelector('.pricehistory_zoom_controls');

    if (!receiveInput || !buyerInput) return;

    if (!document.getElementById('usd_receive_preview')) {
        const createLabel = (id, parent, isWallet = false) => {
            const lbl = document.createElement('div');
            lbl.id = id;
            
            if (isWallet && zoomControls) {
                const row = document.createElement('div');
                row.className = 'ext-wallet-row';
                zoomControls.parentNode.insertBefore(row, zoomControls);
                row.appendChild(lbl);
                row.appendChild(zoomControls);
            } else if (parent) {
                lbl.className = 'usd-input-preview';
                parent.appendChild(lbl);
            }
            return lbl;
        };

        createLabel('usd_receive_preview', receiveInput.closest('.market_sell_dialog_input_group'));
        createLabel('usd_buyer_preview', buyerInput.closest('.market_sell_dialog_input_group'));
        if (zoomControls) {
            const wLabel = createLabel('ext-wallet-display', null, true);
            wLabel.textContent = `Wallet Balance: ${convertPrice(originalWalletText)} (${originalWalletText})`;
        }
    }

    const updateValues = () => {
        const rLabel = document.getElementById('usd_receive_preview');
        const bLabel = document.getElementById('usd_buyer_preview');

        const cleanNum = (val) => {
            const sanitized = val.replace(/[^\d.,]/g, '').replace(',', '.');
            const parsed = parseFloat(sanitized);
            return isNaN(parsed) ? 0 : parsed;
        };

        if (rLabel) rLabel.textContent = `${CONFIG.to.code}: ${CONFIG.to.symbol}${(cleanNum(receiveInput.value) * CONFIG.rate).toFixed(2)}`;
        if (bLabel) bLabel.textContent = `${CONFIG.to.code}: ${CONFIG.to.symbol}${(cleanNum(buyerInput.value) * CONFIG.rate).toFixed(2)}`;
    };

    if (!receiveInput.dataset.hasListener) {
        ['input', 'change'].forEach(ev => {
            receiveInput.addEventListener(ev, updateValues);
            buyerInput.addEventListener(ev, updateValues);
        });
        receiveInput.dataset.hasListener = "true";
    }
    updateValues();
}

// 5. OBSERVER & ENGINE
let timeout;
function scheduleRun() {
    clearTimeout(timeout);
    timeout = setTimeout(run, 100);
}

function startObserver() {
    const observer = new MutationObserver(() => scheduleRun());
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) {
    run();
    startObserver();
} else {
    const bodyObserver = new MutationObserver((m, obs) => {
        if (document.body) {
            obs.disconnect();
            run();
            startObserver();
        }
    });
    bodyObserver.observe(document.documentElement, { childList: true });
}

document.addEventListener('mousemove', () => {
    if (document.querySelector('.jqplot-target')) handleGraphTooltip();
}, { passive: true });