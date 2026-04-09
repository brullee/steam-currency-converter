const CONFIG = {
    from: { symbol: '\u20B4', code: 'UAH' },
    to:   { symbol: '$',     code: 'USD', locale: 'en-US' },
    rate:     0.022891511,
    rateDate: '2026-04-07',
};

const daysSinceRate = (Date.now() - new Date(CONFIG.rateDate)) / 86400000;
if (daysSinceRate > 30) console.warn(`[CurrencyConverter] Exchange rate is ${Math.floor(daysSinceRate)} days old. Consider updating.`);

const CONVERTED_ATTR = "data-cc-converted";

const PRICE_CORE        = `([-\u2212+]?)([\\d\\s.,\u00A0]+)${CONFIG.from.symbol}`;
const PRICE_REGEX       = new RegExp(PRICE_CORE, 'g');
const PRICE_MATCH_REGEX = new RegExp(`^(\\s*)${PRICE_CORE}$`);

const SPECIALTY_IDS = ['marketWalletBalanceAmount', 'header_wallet_balance', 'usd_receive_preview', 'usd_buyer_preview', 'ext-wallet-display', 'market_buy_commodity_order_total', 'market_buyorder_dialog_walletbalance_amount'];

function formatUSD(value) {
    return value.toLocaleString(CONFIG.to.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const fmtUSD = amt => `${CONFIG.to.code}: ${CONFIG.to.symbol}${formatUSD(amt)}`;

function bothCurrencies(uahText) {
    return `${convertPrice(uahText)} (${uahText})`;
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
            if (!hoverRoot.dataset.ccHover) {
                hoverRoot.dataset.ccHover = 'true';
                hoverRoot._ccNodes = [];
                hoverRoot.addEventListener('mouseenter', () => {
                    hoverRoot._ccNodes.forEach(entry => {
                        entry.parent.setAttribute('data-cc-hovering', 'true');
                        entry.textNode.textContent = entry.orig;
                    });
                });
                hoverRoot.addEventListener('mouseleave', () => {
                    hoverRoot._ccNodes.forEach(entry => {
                        entry.parent.removeAttribute('data-cc-hovering');
                        entry.textNode.textContent = entry.conv;
                    });
                });
            }
            hoverRoot._ccNodes.push({ textNode, orig: originalText, conv: newText, parent });
        }
    }

    handleGraphTooltip();
    handleSellInputs(handleUniversalWallet());
    handleBuyInputs();
}

function handleUniversalWallet() {
    for (const selector of ['#marketWalletBalanceAmount', '#header_wallet_balance']) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const original = el.textContent.trim();
        if (!PRICE_MATCH_REGEX.test(original)) continue;

        el.textContent = el.id === 'marketWalletBalanceAmount' ? bothCurrencies(original) : convertPrice(original);
        el.setAttribute(CONVERTED_ATTR, 'true');

        const wLabel = document.getElementById('ext-wallet-display');
        if (wLabel) wLabel.textContent = `Wallet Balance: ${bothCurrencies(original)}`;

        return original;
    }
    return '';
}

const TOOLTIP_SELECTOR = '.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip';

function handleGraphTooltip() {
    document.querySelectorAll(TOOLTIP_SELECTOR).forEach(tooltip => {
        if (tooltip.style.display === 'none' || !tooltip.textContent.includes(CONFIG.from.symbol)) return;
        const converted = tooltip.innerHTML.replace(PRICE_REGEX, match => convertPrice(match));
        if (converted !== tooltip.innerHTML) tooltip.innerHTML = converted;
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
            wLabel.textContent = `Wallet Balance: ${bothCurrencies(originalWalletText)}`;
        }
    }

    const updateValues = () => {
        const rLabel = document.getElementById('usd_receive_preview');
        const bLabel = document.getElementById('usd_buyer_preview');
        if (rLabel) rLabel.textContent = fmtUSD(cleanNum(receiveInput.value) * CONFIG.rate);
        if (bLabel) bLabel.textContent = fmtUSD(cleanNum(buyerInput.value) * CONFIG.rate);
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

function handleBuyInputs() {
    // Handle Steam's calculated max price div — show $X.XX (₴X,XXX) like the wallet
    const totalDiv = document.getElementById('market_buy_commodity_order_total');
    if (totalDiv) {
        const text = totalDiv.textContent.trim();
        if (PRICE_MATCH_REGEX.test(text)) {
            totalDiv.innerHTML = `${convertPrice(text)}<br>(${text})`;
            totalDiv.setAttribute(CONVERTED_ATTR, 'true');
        }
    }

    const priceInput = document.getElementById('market_buy_commodity_input_price');
    if (!priceInput) return;

    if (!document.getElementById('usd_buy_price_preview')) {
        const lbl = document.createElement('div');
        lbl.id = 'usd_buy_price_preview';
        lbl.className = 'usd-input-preview';
        const inputContainer = priceInput.closest('.market_buy_commodity_input');
        if (inputContainer) inputContainer.insertBefore(lbl, inputContainer.firstChild);
    }

    const update = () => {
        const lbl = document.getElementById('usd_buy_price_preview');
        if (!lbl) return;
        const perItem = cleanNum(priceInput.value) * CONFIG.rate;
        lbl.textContent = fmtUSD(perItem);
    };

    if (!priceInput.dataset.ccBuyListener) {
        ['input', 'change'].forEach(ev => priceInput.addEventListener(ev, update));
        priceInput.dataset.ccBuyListener = 'true';
    }
    update();

    // Wallet balance shown in the buy dialog — drop Steam's wrapping parens, show $X.XX (₴X,XXX)
    const amountSpan = document.getElementById('market_buyorder_dialog_walletbalance_amount');
    if (amountSpan && PRICE_MATCH_REGEX.test(amountSpan.textContent.trim())) {
        const formatted = bothCurrencies(amountSpan.textContent.trim());
        const walletSpan = document.getElementById('market_buyorder_dialog_walletbalance');
        if (walletSpan) walletSpan.innerHTML = `<span id="market_buyorder_dialog_walletbalance_amount">${formatted}</span>`;
        else amountSpan.textContent = formatted;
    }
}

function cleanNum(val) {
    const parsed = parseFloat(val.replace(/[^\d.,]/g, '').replace(',', '.'));
    return isNaN(parsed) ? 0 : parsed;
}

let debounceTimer;
const scheduleRun = () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(run, 100); };

function startObserver() {
    new MutationObserver(mutations =>
        mutations.every(m => m.target.matches?.(TOOLTIP_SELECTOR) || m.target.closest?.(TOOLTIP_SELECTOR))
            ? handleGraphTooltip()
            : scheduleRun()
    ).observe(document.body, { childList: true, subtree: true, characterData: true });
}

run();
startObserver();
