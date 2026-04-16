// Shared rate — set by fetchRate() before run() is ever called.
let rate = 1;

// Guards against the MutationObserver firing run() before a real rate is available.
let rateReady = false;

async function fetchRate(from, to) {
    let response;
    try {
        response = await chrome.runtime.sendMessage({ type: 'fetchRate', from, to });
    } catch (e) {
        // Service worker was killed or extension was reloaded — wake it and retry once.
        console.warn('[CurrencyConverter] sendMessage failed, retrying once.', e);
        await new Promise(r => setTimeout(r, 300));
        try {
            response = await chrome.runtime.sendMessage({ type: 'fetchRate', from, to });
        } catch (e2) {
            console.warn('[CurrencyConverter] Retry failed, falling back to rate=1.', e2);
        }
    }

    if (response?.rate != null) {
        rate = response.rate;
        console.log(`[CurrencyConverter] ${from}→${to} rate: ${rate}`);
    } else {
        console.warn(`[CurrencyConverter] No rate returned for ${from}→${to}, using 1.`);
    }

    rateReady = true;
    run();
}
