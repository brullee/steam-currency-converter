// Cache: parent element → resolved hover target. WeakMap so entries are
// garbage-collected automatically when the DOM element is removed.
const hoverTargetCache = new WeakMap();

// Walks up the DOM to find the best element to attach hover events to.
// Prefers the enclosing <a> or role=link/button so hovering anywhere on a card
// toggles the original price for all prices within it.
// Result is cached per element — findHoverTarget is called once per price node
// per run(), so caching eliminates the repeated DOM traversal on re-runs.
function findHoverTarget(el) {
    if (hoverTargetCache.has(el)) return hoverTargetCache.get(el);
    let result;
    const marketCell = el.closest('.market_listing_row, .market_commodity_order_summary');
    if (marketCell) {
        result = marketCell;
    } else if (el.closest('a')) {
        result = el.closest('a');
    } else {
        const purchaseAction = el.closest('.game_purchase_action_bg, .game_purchase_action');
        if (purchaseAction) {
            result = purchaseAction;
        } else {
            const tabItem = el.closest('.tab_item');
            if (tabItem) {
                result = tabItem;
            } else {
                let cur = el.parentElement;
                while (cur && cur !== document.body) {
                    const role = cur.getAttribute('role');
                    if ((role === 'link' || role === 'button') && !cur.classList.contains('discount_block')) {
                        const par = cur.parentElement;
                        result = (par && par.querySelector(':scope > a')) ? par : cur;
                        break;
                    }
                    cur = cur.parentElement;
                }
                // New UI fallback: if no card-level role target was found, group prices
                // under the ancestor that owns the sale badge (StoreSaleDiscountBox) so
                // both the original and final prices toggle together on hover.
                if (!result) result = el.closest(':has(> .StoreSaleDiscountBox)') || el;
            }
        }
    }
    hoverTargetCache.set(el, result);
    return result;
}

// Registers a text node under a hover target so mousing over the target temporarily
// shows the original price. On re-runs (rate update), updates the stored converted
// text in place rather than adding a duplicate entry.
// _ccEntryMap (WeakMap keyed by textNode) gives O(1) deduplication lookup instead
// of the previous O(n) Array.find scan that ran once per price node per re-run.
function setupHover(hoverTarget, textNode, originalText, convertedText, ownerEl) {
    if (!hoverTarget._ccEntries) {
        hoverTarget._ccEntries = [];
        hoverTarget._ccEntryMap = new WeakMap();
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
    const existing = hoverTarget._ccEntryMap.get(textNode);
    if (existing) {
        existing.converted = convertedText; // rate changed — update without re-registering
    } else {
        const entry = { textNode, original: originalText, converted: convertedText, owner: ownerEl };
        hoverTarget._ccEntries.push(entry);
        hoverTarget._ccEntryMap.set(textNode, entry);
    }
}
