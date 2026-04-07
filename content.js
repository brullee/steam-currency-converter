// 1. SETTINGS
const EXCHANGE_RATE = 0.022891511; 
const CURRENCY_SYMBOL = "$";
const CONVERTED_ATTR = "data-steam-converted";

let globalOriginalWalletUAH = "0₴";

// 2. THE CONVERTER ENGINE
function convertPrice(text) {
    const match = text.match(/^(\s*)([-−\+]?)([\d\s.,\u00A0]+)\u20B4$/);
    if (!match) return text;

    const whitespace = match[1];
    const sign = match[2];
    const numberPart = match[3];

    const rawNumber = numberPart.replace(/[\s\u00A0]/g, '').replace(',', '.');
    const numericValue = parseFloat(rawNumber);

    if (isNaN(numericValue)) return text;

    const converted = numericValue * EXCHANGE_RATE;
    const formatted = converted.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return `${whitespace}${sign}${CURRENCY_SYMBOL}${formatted}`;
}

function run() {
    const priceRegex = /([-−\+]?)([\d\s.,\u00A0]+)\u20B4/g;

    // 1. Create a Walker that ONLY looks at text nodes
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Skip if it doesn't have the symbol or is inside an already converted parent
                if (!node.textContent.includes('\u20B4')) return NodeFilter.FILTER_REJECT;
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
        const newText = originalText.replace(priceRegex, (match) => convertPrice(match));

        if (newText !== originalText) {
            // Mark the parent as converted
            parent.setAttribute(CONVERTED_ATTR, "true");
            parent.setAttribute('data-original', originalText);
            parent.setAttribute('data-converted', newText);
            
            // Apply the change
            node.textContent = newText;

            // --- HITBOX OPTIMIZATION ---
            if (window.getComputedStyle(parent).display === 'inline') {
                parent.style.display = 'inline-block';
            }

            // Hover toggle (on the parent, since text nodes can't have listeners)
            parent.onmouseenter = () => { 
                // Using childNodes[0] ensures we only swap the text, not any other icons
                if(parent.childNodes[0]) parent.childNodes[0].textContent = parent.getAttribute('data-original'); 
            };
            parent.onmouseleave = () => { 
                if(parent.childNodes[0]) parent.childNodes[0].textContent = parent.getAttribute('data-converted'); 
            };
        }
    }

    handleGraphTooltip();
    handleUniversalWallet(); 
    handleSellInputs();
}


// 4. SPECIALTY HANDLERS
function handleUniversalWallet() {
    const walletSelectors = ['#marketWalletBalanceAmount', '#header_wallet_balance'];
    walletSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (!el || el.hasAttribute('data-wallet-processed')) return;
        const currentText = el.textContent.trim();
        if (currentText.includes('\u20B4')) {
            globalOriginalWalletUAH = currentText;
            const rawNumber = currentText.replace(/[^\d.,]/g, '').replace(',', '.');
            const numericValue = parseFloat(rawNumber);
            if (!isNaN(numericValue)) {
                const converted = (numericValue * EXCHANGE_RATE).toLocaleString('en-US', {
                    style: 'currency', currency: 'USD'
                });
                if (el.id === 'marketWalletBalanceAmount') {
                    el.textContent = `${converted} (${currentText})`;
                } else {
                    el.textContent = converted;
                }
                el.setAttribute('data-wallet-processed', 'true');
                el.setAttribute(CONVERTED_ATTR, "true");
            }
        }
    });
}

function handleGraphTooltip() {
    const tooltips = document.querySelectorAll('.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip');
    tooltips.forEach(tooltip => {
        if (tooltip.style.display === 'none' || !tooltip.textContent.includes('\u20B4')) return;
        const priceRegex = /([-−\+]?)([\d\s.,\u00A0]+)\u20B4/g;
        const newHtml = tooltip.innerHTML.replace(priceRegex, (match) => convertPrice(match));
        if (newHtml !== tooltip.innerHTML) {
            tooltip.innerHTML = newHtml;
        }
    });
}

function handleSellInputs() {
    const receiveInput = document.getElementById('market_sell_currency_input');
    const buyerInput = document.getElementById('market_sell_buyercurrency_input');
    const zoomControls = document.querySelector('.pricehistory_zoom_controls');

    if (!receiveInput || !buyerInput) return;

    // Fix the parent containers so absolute positioning works
    [receiveInput, buyerInput].forEach(input => {
        const parent = input.closest('.market_sell_dialog_input_group');
        if (parent) {
            parent.style.position = 'relative';
            parent.style.display = 'inline-block';
            parent.style.verticalAlign = 'top';
            parent.style.marginBottom = '25px';
            parent.style.textAlign = 'left';
        }
    });

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
                // PINNING LOGIC: Lock it exactly under the box
                lbl.style = `
                    color: #85bb65; 
                    font-weight: bold; 
                    font-family: 'Motiva Sans', Sans-serif; 
                    pointer-events: none; 
                    text-align: left; 
                    font-size: 11px; 
                    position: absolute; 
                    bottom: -18px; 
                    left: 0; 
                    width: 100%;
                `;
                parent.appendChild(lbl);
            }
            return lbl;
        };

        createLabel('usd_receive_preview', receiveInput.closest('.market_sell_dialog_input_group'));
        createLabel('usd_buyer_preview', buyerInput.closest('.market_sell_dialog_input_group'));
        if (zoomControls) createLabel('ext-wallet-display', null, true);
    }

    const updateValues = () => {
        const rLabel = document.getElementById('usd_receive_preview');
        const bLabel = document.getElementById('usd_buyer_preview');
        const wLabel = document.getElementById('ext-wallet-display');
        
        // Adds unconverted walelt value
        if (wLabel && globalOriginalWalletUAH) {
            const rawWallet = globalOriginalWalletUAH.replace(/[^\d.,]/g, '').replace(',', '.');
            const walletUSD = (parseFloat(rawWallet) * EXCHANGE_RATE).toLocaleString('en-US', {
                style: 'currency', currency: 'USD'
            });
            wLabel.textContent = `Wallet: ${walletUSD} (${globalOriginalWalletUAH})`;
        }

        const cleanNum = (val) => {
            const sanitized = val.replace(/[^\d.,]/g, '').replace(',', '.');
            const parsed = parseFloat(sanitized);
            return isNaN(parsed) ? 0 : parsed;
        };

        if (rLabel) rLabel.textContent = `USD: $${(cleanNum(receiveInput.value) * EXCHANGE_RATE).toFixed(2)}`;
        if (bLabel) bLabel.textContent = `USD: $${(cleanNum(buyerInput.value) * EXCHANGE_RATE).toFixed(2)}`;
    };

    if (!receiveInput.dataset.hasListener) {
        ['input', 'keyup', 'change', 'blur'].forEach(ev => {
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