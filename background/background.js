const ONE_DAY = 24 * 60 * 60 * 1000;

// Bump this whenever a bad rate may have been cached, to force a fresh fetch.
const V = 'v3';

// Registering these listeners at the top level ensures Chrome keeps the service
// worker alive long enough to handle messages and doesn't discard it immediately.
chrome.runtime.onInstalled.addListener(() => {});
chrome.runtime.onStartup.addListener(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'fetchRate') return;
    getRate(msg.from, msg.to).then(sendResponse);
    return true; // keep channel open for async response
});

async function getRate(from, to) {
    const rateKey = `${V}_rate_${from}_${to}`;
    const tsKey   = `${V}_ts_${from}_${to}`;

    const stored = await chrome.storage.local.get([rateKey, tsKey]);
    const cached = stored[rateKey];
    const ts     = stored[tsKey];

    if (typeof cached === 'number' && ts && Date.now() - ts < ONE_DAY) {
        return { rate: cached };
    }

    try {
        const res  = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
        const data = await res.json();
        const live = data?.rates?.[to];
        if (typeof live === 'number') {
            chrome.storage.local.set({ [rateKey]: live, [tsKey]: Date.now() });
            return { rate: live };
        }
        console.warn(`[CurrencyConverter] No rate for ${from}→${to} in response.`);
    } catch (e) {
        console.warn('[CurrencyConverter] Fetch failed.', e);
    }

    // Fall back to stale cache rather than returning nothing
    return typeof cached === 'number' ? { rate: cached } : { rate: null };
}
