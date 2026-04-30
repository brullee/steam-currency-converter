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
                if (parent.closest('.itad-pricing, .es_regional')) return NodeFilter.FILTER_REJECT;
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

        if (!strippingOnly && hoverOn) {
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
