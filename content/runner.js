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
                const st = textState.get(node);
                if (st && st.rate === rateKey && node.textContent === st.conv) return NodeFilter.FILTER_REJECT;
                // Accept nodes that contain FROM-currency prices or were already converted
                // (but need re-converting because the rate changed).
                PRICE_REGEX.lastIndex = 0;
                if (!PRICE_REGEX.test(node.textContent) && !st) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentElement;
        const st = textState.get(node);
        // If the text is still our own output, re-convert from the stored original
        // (rate changed) to avoid compounding. Anything else means the page wrote new
        // content (e.g. Steam applying a partial-bundle discount) — trust it. Comparing
        // against our output, not testing for FROM.symbol, matters when FROM's symbol is
        // a substring of TO's (USD "$" inside AUD "A$"): converted text would otherwise
        // look fresh and be re-converted on every tick.
        const currentText = node.textContent;
        const original = (st && currentText === st.conv) ? st.orig : currentText;
        PRICE_REGEX.lastIndex = 0;
        const converted = original.replace(PRICE_REGEX, m => convertPriceText(m));
        if (converted === original) {
            textState.delete(node);
            continue;
        }

        textState.set(node, { orig: original, conv: converted, rate: rateKey });
        if (currentText !== converted) node.textContent = converted;

        if (!strippingOnly && hoverOn) {
            // Strip " USD" from the hover display when the user opted in;
            // textState always keeps the true original for re-run correctness.
            const hoverOriginal = stripUsdTrail
                ? original.replace(PRICE_REGEX, m => m.replace(/\s+USD$/, ''))
                : original;
            setupHover(findHoverTarget(parent), node, hoverOriginal, converted, parent);
        }
    }
}

function run() {
    if (!FROM || !rateReady) return;
    runOnRoot(document.body);
    convertMarketElements();
}

// Wallet balances, buy/sell dialog previews and graph tooltips — elements the
// text walker either skips (MANAGED_IDS) or that need extra handling.
function convertMarketElements() {
    convertGraphTooltips();
    const walletOriginal = convertWalletBalances();
    updateSellPreviews(walletOriginal);
    updateBuyPreviews();
}

// Puts the page back the way Steam rendered it, so new settings convert from the
// originals instead of from text converted under the old settings.
function resetPage() {
    rateReady = false;   // stops the observer and preview listeners until the next commit
    resetHover();        // first: clears ccHovering, which would hide nodes from the walk below
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
        const st = textState.get(node);
        if (!st) continue;
        // Anything other than our output (e.g. the original shown by hover) stays as is.
        if (node.textContent === st.conv) node.textContent = st.orig;
        textState.delete(node);
    }
    restoreMarketElements();
}

// Our own preview / wallet labels — never fed back into the walker.
const isOwnElement = el => !!el?.id && (el.id.startsWith('cc_') || el.id.startsWith('ext-'));

// Settings can be applied many times per page, but one observer is enough.
let observing = false;

function startObserver() {
    if (observing) return;
    observing = true;
    // Pending subtree roots collected between debounce ticks.
    // When the wishlist lazy-loads items we process only those new subtrees
    // instead of re-walking the entire body.
    const pendingRoots = new Set();
    let debounceTimer;

    const flush = () => {
        if (!FROM || !rateReady) { pendingRoots.clear(); return; }
        if (pendingRoots.size === 0) {
            // Nothing specific queued — full-body walk (cheap: textState skips converted nodes).
            run();
        } else {
            // Process only the subtrees that actually changed.
            pendingRoots.forEach(root => { if (root.isConnected) runOnRoot(root); });
            convertMarketElements();
        }
        pendingRoots.clear();
    };

    const elementOf = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    new MutationObserver(mutations => {
        // Conversion is off or waiting on a rate — nothing to queue. The next commit
        // runs a full pass anyway, so mutations skipped here aren't lost.
        if (!rateReady) return;
        // Fast path: all mutations are inside tooltip elements — only convert tooltips.
        // A characterData mutation targets the Text node itself, so resolve to its element.
        if (mutations.every(m => elementOf(m.target)?.closest(TOOLTIP_SELECTOR))) {
            if (rateReady) convertGraphTooltips();
            return;
        }

        // Collect the elements whose text changed: newly added subtrees (e.g. wishlist
        // items loading in on scroll), elements whose children were replaced
        // (el.textContent = ...), and text nodes edited in place. Our own writes land
        // here too, but textState makes the walker reject them in O(1), so the loop
        // settles after one extra pass instead of re-running forever.
        let relevant = false;
        for (const m of mutations) {
            const target = elementOf(m.target);
            if (!target || isOwnElement(target)) continue;   // e.g. a preview label refresh
            relevant = true;
            if (m.type === 'characterData') {
                pendingRoots.add(target);
                continue;
            }
            for (const added of m.addedNodes) {
                const el = added.nodeType === Node.ELEMENT_NODE ? added : target;
                if (!isOwnElement(el)) pendingRoots.add(el);
            }
        }
        if (!relevant) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, 100);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
