// Shared rate — set by fetchRate() before run() is ever called. Conversion never
// starts (rateReady stays false) if no valid rate is available.
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
            console.warn('[CurrencyConverter] Retry failed.', e2);
        }
    }

    // Without a real rate, leave the page untouched. Relabelling prices at 1:1 with
    // the target symbol would show plausible-looking but wrong amounts.
    const r = response?.rate;
    if (!(typeof r === 'number' && Number.isFinite(r) && r > 0)) {
        console.warn(`[CurrencyConverter] No rate available for ${from}→${to}; prices left unconverted.`);
        return;
    }

    rate = r;
    console.log(`[CurrencyConverter] ${from}→${to} rate: ${rate}`);
    rateReady = true;
    run();
}
