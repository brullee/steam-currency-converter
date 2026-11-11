// Cache: parent element → resolved hover target. WeakMap so entries are
// garbage-collected automatically when the DOM element is removed.
const hoverTargetCache = new WeakMap();

// The one hover rule, everywhere: hovering a price, or the clickable thing it belongs
// to, shows Steam's original for every price in that thing. "Clickable thing", in order:
//   1. a known Steam group (STEAM.hoverGroups) — extras for a few legacy layouts;
//   2. the enclosing link;
//   3. the enclosing role=link / role=button;
//   4. the element a React page made clickable with `cursor: pointer` (the beta market
//      has no links or roles on its cards and tabs, only click handlers);
//   5. the new store's sale box, then the price's own element.
// Steps 2–4 and the fallback need no Steam class names, so hover keeps working when
// Steam renames things. Cached per element: called once per price node per run().
function findHoverTarget(el) {
    if (hoverTargetCache.has(el)) return hoverTargetCache.get(el);
    const result = el.closest(STEAM.hoverGroups)
        || el.closest('a')
        || roleAncestor(el)
        || clickableAncestor(el)
        || el.closest(`:has(> ${STEAM.saleBox})`)
        || el;
    hoverTargetCache.set(el, result);
    return result;
}

function roleAncestor(el) {
    for (let cur = el.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
        const role = cur.getAttribute('role');
        if ((role === 'link' || role === 'button') && !cur.matches(STEAM.notAHoverGroup)) {
            // A role=button beside the card's own link: group the whole card.
            const par = cur.parentElement;
            return (par && par.querySelector(':scope > a')) ? par : cur;
        }
    }
    return null;
}

// The element that made this price clickable: cursor is inherited, so it's the top of
// the unbroken run of `cursor: pointer` ancestors starting at the price itself. A price
// that isn't itself pointer isn't inside anything clickable. A run that never ends
// (a page that's pointer everywhere) names no clear element.
const CLICKABLE_DEPTH = 8;
function clickableAncestor(el) {
    if (getComputedStyle(el).cursor !== 'pointer') return null;
    let cur = el;
    for (let depth = 0; depth < CLICKABLE_DEPTH; depth++) {
        const parent = cur.parentElement;
        if (!parent || parent === document.body || getComputedStyle(parent).cursor !== 'pointer') return cur;
        cur = parent;
    }
    return null;
}

// Registers a text node under a hover target so mousing over the target temporarily
// shows the original price. On re-runs (rate update or the page changing the price),
// updates the stored texts in place rather than adding a duplicate entry.
// _ccEntryMap (WeakMap keyed by textNode) gives O(1) deduplication lookup instead
// of the previous O(n) Array.find scan that ran once per price node per re-run.
function setupHover(hoverTarget, textNode, originalText, convertedText, ownerEl) {
    if (!hoverTarget._ccEntries) {
        hoverTarget._ccEntries = [];
        hoverTarget._ccEntryMap = new WeakMap();
        hoverTargets.add(hoverTarget);
        hoverTarget.addEventListener('mouseenter', () => {
            // Steam may have replaced a price's text node since; those entries are gone.
            hoverTarget._ccEntries = hoverTarget._ccEntries.filter(e => e.textNode.isConnected);
            if (!hoverTarget._ccEntries.length) return;
            // Only a price that is its own target can shrink away from the cursor; a card
            // or tab keeps its size. (Measuring forces a layout, so skip it otherwise.)
            if (hoverTarget._ccEntries.some(e => e.owner === hoverTarget)) lockWidth(hoverTarget);
            hoverTarget._ccEntries.forEach(e => {
                e.owner.dataset.ccHovering = 'true';
                e.textNode.textContent = e.original;
            });
        });
        hoverTarget.addEventListener('mouseleave', () => {
            hoverTarget._ccEntries.forEach(e => {
                delete e.owner.dataset.ccHovering;
                // Put our conversion back only if the text is still what hover showed.
                // Anything else is Steam updating the price mid-hover: that's fresh text
                // for the walker below, and the old conversion would be a wrong price.
                if (e.textNode.isConnected && e.textNode.textContent === e.original) {
                    e.textNode.textContent = e.converted;
                }
            });
            unlockWidth(hoverTarget);
            // The walker skips prices while they're hovered, so anything Steam wrote in
            // the meantime (in place, or as a new text node) is converted now.
            if (rateReady && hoverTarget.isConnected) runOnRoot(hoverTarget);
        });
    }
    const existing = hoverTarget._ccEntryMap.get(textNode);
    if (existing) {
        // Rate or page price changed — update without re-registering.
        existing.original  = originalText;
        existing.converted = convertedText;
    } else {
        const entry = { textNode, original: originalText, converted: convertedText, owner: ownerEl };
        hoverTarget._ccEntries.push(entry);
        hoverTarget._ccEntryMap.set(textNode, entry);
    }
}

// While hovering, the target keeps at least the width it had: a shorter original (or
// the dialog annotation hiding) would otherwise shrink it out from under the cursor —
// mouseleave, converted text back, it grows under the cursor, mouseenter, and round
// again, flickering. Only the inline min-width is touched, and it's put back on leave.
function lockWidth(el) {
    if (el._ccMinWidth !== undefined) return;
    el._ccMinWidth = el.style.minWidth;
    el.style.minWidth = `${el.getBoundingClientRect().width}px`;
}

function unlockWidth(el) {
    if (el._ccMinWidth === undefined) return;
    el.style.minWidth = el._ccMinWidth;
    delete el._ccMinWidth;
}

// Every element that ever got hover listeners, so a settings change can empty them.
// The listeners stay attached (they can't be removed without keeping the handler
// references) — with no entries they do nothing.
const hoverTargets = new Set();

// Drops all hover entries and clears any "currently hovering" flag, which would
// otherwise make the walker skip those nodes forever after the settings change.
function resetHover() {
    for (const target of hoverTargets) {
        target._ccEntries.forEach(e => delete e.owner.dataset.ccHovering);
        unlockWidth(target);
        target._ccEntries = [];
        target._ccEntryMap = new WeakMap();
        if (!target.isConnected) hoverTargets.delete(target);
    }
}
