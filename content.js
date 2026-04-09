const CONFIG = {
    from: { symbol: '\u20B4', code: 'UAH' },
    to:   { symbol: '$',     code: 'USD', locale: 'en-US' },
    rate:  0.022891511,
};

const CONVERTED_ATTR = "data-cc-converted";

const PRICE_CORE        = `([-\u2212+]?)([\\d\\s.,\u00A0]+)${CONFIG.from.symbol}`;
const PRICE_REGEX       = new RegExp(PRICE_CORE, 'g');
const PRICE_MATCH_REGEX = new RegExp(`^(\\s*)${PRICE_CORE}$`);

const SPECIALTY_IDS = ['marketWalletBalanceAmount', 'header_wallet_balance', 'usd_receive_preview', 'usd_buyer_preview', 'ext-wallet-display'];

function formatUSD(value) {
    return value.toLocaleString(CONFIG.to.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function convertPrice(text) {
    const match = text.match(PRICE_MATCH_REGEX);
    if (!match) return text;
    const rawNumber = match[3].replace(/[\s\u00A0]/g, '').replace(',', '.');
    const numericValue = parseFloat(rawNumber);
    if (isNaN(numericValue)) return text;
    return `${match[1]}${match[2]}${CONFIG.to.symbol}${formatUSD(numericValue * CONFIG.rate)}`;
}

function pickHoverRoot(el) {
    const anchor = el.closest('a');
    if (anchor) return anchor;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
        const role = cur.getAttribute('role');
        if (role === 'link' || role === 'button') {
            // If a sibling <a> overlay covers this element, attach to the shared parent instead
            const par = cur.parentElement;
            if (par && par.querySelector(':scope > a')) return par;
            return cur;
        }
        cur = cur.parentElement;
    }
    return el;
}

function run() {
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (!node.textContent.includes(CONFIG.from.symbol)) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.hasAttribute(CONVERTED_ATTR)) {
                    // Dynamic content (e.g. bundles) can reset text after conversion.
                    // If ₴ is back and we're not mid-hover, clear the marker so it re-converts.
                    if (node.parentElement.hasAttribute('data-cc-hovering')) return NodeFilter.FILTER_REJECT;
                    node.parentElement.removeAttribute(CONVERTED_ATTR);
                }
                if (SPECIALTY_IDS.includes(node.parentElement.id)) return NodeFilter.FILTER_REJECT;
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

            const textNode = node;
            const hoverRoot = pickHoverRoot(parent);
            hoverRoot.addEventListener('mouseenter', () => {
                parent.setAttribute('data-cc-hovering', 'true');
                textNode.textContent = originalText;
            });
            hoverRoot.addEventListener('mouseleave', () => {
                parent.removeAttribute('data-cc-hovering');
                textNode.textContent = newText;
            });
        }
    }

    handleGraphTooltip();
    handleSellInputs(handleUniversalWallet());
}

function handleUniversalWallet() {
    for (const selector of ['#marketWalletBalanceAmount', '#header_wallet_balance']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const original = el.textContent.trim();
        if (!PRICE_MATCH_REGEX.test(original)) continue;

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

const TOOLTIP_SELECTOR = '.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip';

function handleGraphTooltip() {
    const tooltips = document.querySelectorAll(TOOLTIP_SELECTOR);
    tooltips.forEach(tooltip => {
        if (tooltip.style.display === 'none' || !tooltip.textContent.includes(CONFIG.from.symbol)) return;
        const newHtml = tooltip.innerHTML.replace(PRICE_REGEX, (match) => convertPrice(match));
        if (newHtml !== tooltip.innerHTML) tooltip.innerHTML = newHtml;
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
            const parsed = parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.'));
            return isNaN(parsed) ? 0 : parsed;
        };
        if (rLabel) rLabel.textContent = `${CONFIG.to.code}: ${CONFIG.to.symbol}${formatUSD(cleanNum(receiveInput.value) * CONFIG.rate)}`;
        if (bLabel) bLabel.textContent = `${CONFIG.to.code}: ${CONFIG.to.symbol}${formatUSD(cleanNum(buyerInput.value) * CONFIG.rate)}`;
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

let timeout;
function scheduleRun() {
    clearTimeout(timeout);
    timeout = setTimeout(run, 100);
}

function startObserver() {
    const observer = new MutationObserver((mutations) => {
        const onlyTooltips = mutations.every(m =>
            m.target.matches?.(TOOLTIP_SELECTOR) ||
            m.target.closest?.(TOOLTIP_SELECTOR)
        );
        if (onlyTooltips) {
            handleGraphTooltip();
        } else {
            scheduleRun();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

run();
startObserver();
