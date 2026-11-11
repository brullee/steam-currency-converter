const SETTINGS_KEYS = [
    'targetCurrency', 'fromCurrency', 'conversionEnabled', 'hoverEnabled', 'stripTrailingCode',
    'formatting', ...LEGACY_FORMAT_KEYS,
];


// Bumped on every settings load. A slower, older load — e.g. a rate request still in
// flight while the user keeps changing the popup — sees the mismatch and drops its result.
let settingsGeneration = 0;

// Turns the stored settings into what to apply, or null when there's nothing to convert.
// Has no side effects, so the page keeps its current state until the new rate is known
// (no flash of unconverted prices while it loads).
async function planConversion(stored) {
    const conversionOn = stored.conversionEnabled !== false;
    const formatting   = readFormatting(stored);

    const to = isBlockedCurrency(stored.targetCurrency) ? null : stored.targetCurrency;
    if (!to) {
        console.log('[CurrencyConverter] No target currency set. Configure it in the popup.');
        return null;
    }

    const from = stored.fromCurrency && !isBlockedCurrency(stored.fromCurrency) && CURRENCIES[stored.fromCurrency]
        ? stored.fromCurrency : null;
    if (!from) {
        console.log('[CurrencyConverter] No store currency set. Configure it in the popup.');
        return null;
    }

    // The popup only offers "Remove USD trail" for a USD store, but the stored flag
    // survives switching currency — ignore it for anything else.
    const strip = !!stored.stripTrailingCode && from === 'USD';

    // Converted prices use the "converted" set. With conversion off, the prices on the
    // page are Steam's own, so they get the "original" set — the same one hover uses.
    const plan = {
        from, to, strip,
        config:   conversionOn ? formatting.converted : formatting.original,
        original: formatting.original,
        hover:    stored.hoverEnabled !== false,
    };

    if (!conversionOn) {
        if (!strip && !hasFormatting(formatting.original)) {
            console.log('[CurrencyConverter] Conversion is disabled.');
            return null;
        }
        return { ...plan, to: from, rate: 1, strippingOnly: true };
    }
    if (from === to) return strip ? { ...plan, rate: 1, strippingOnly: true } : null;

    const r = await requestRate(from, to);
    return r === null ? null : { ...plan, rate: r, strippingOnly: false };
}

// Swaps the page over to a plan in one synchronous step: undo the old conversion,
// set the new state, convert again.
function commitPlan(plan) {
    resetPage();
    if (!plan) return;

    CONFIG.to = plan.to;
    Object.assign(CONFIG, plan.config);
    FROM = CURRENCIES[plan.from];
    FROM_CODE = plan.from;
    codeRates.clear();
    TO   = buildToMeta(plan.to);
    FROM_META       = buildToMeta(plan.from);
    ORIGINAL_CONFIG = plan.original;
    stripUsdTrail = plan.strip;
    ({ scan: PRICE_REGEX, match: PRICE_MATCH_REGEX, matchAlt: PRICE_MATCH_ALT } = buildRegexes(FROM, stripUsdTrail));
    hoverOn       = plan.hover;
    strippingOnly = plan.strippingOnly;
    rate          = plan.rate;
    rateReady     = true;

    console.log(`[CurrencyConverter] FROM: ${plan.from} → TO: ${plan.to}`);
    startObserver();
    run();
}

// React pages rendered on the server (the beta market) compare their HTML with what
// they render on hydration. Text we changed before that is a mismatch: React throws
// away the whole page and renders it again from scratch (React error #418) — slow, and
// every element is replaced. So on those pages the first write waits until the page
// has loaded and gone idle, which is when hydration has finished. Capped, because
// image-heavy pages can take long to fire `load`; if hydration is still running then,
// React recovers on its own and the observer converts the new nodes.
const HYDRATION_WAIT_CAP = 3000;
let hydrated = null;
function whenHydrated() {
    if (hydrated) return hydrated;
    const ssr = document.querySelector('[data-react-nav-root], script[src*="/ssr/"]');
    hydrated = !ssr ? Promise.resolve() : new Promise(resolve => {
        const idle = () => (window.requestIdleCallback
            ? requestIdleCallback(() => resolve(), { timeout: 1000 })
            : setTimeout(resolve, 200));
        if (document.readyState === 'complete') idle();
        else window.addEventListener('load', idle, { once: true });
        setTimeout(resolve, HYDRATION_WAIT_CAP);
    });
    return hydrated;
}

async function applySettings() {
    const gen = ++settingsGeneration;
    const stored = await chrome.storage.sync.get(SETTINGS_KEYS);
    if (gen !== settingsGeneration) return;
    // The rate request and the hydration wait run side by side.
    const [plan] = await Promise.all([planConversion(stored), whenHydrated()]);
    if (gen !== settingsGeneration) return;
    commitPlan(plan);
}

// The popup saves every change as it's made; open Steam tabs follow along without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && SETTINGS_KEYS.some(k => k in changes)) applySettings();
});

applySettings();
