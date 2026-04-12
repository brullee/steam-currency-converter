// Shared rate — set by fetchRate() before run() is ever called.
let rate = 1;

// Guards against the MutationObserver firing run() before a real rate is available.
let rateReady = false;

async function fetchRate(from, to) {
    const response = await chrome.runtime.sendMessage({ type: 'fetchRate', from, to });

    if (response?.rate != null) {
        rate = response.rate;
        console.log(`[CurrencyConverter] ${from}→${to} rate: ${rate}`);
    } else {
        console.warn(`[CurrencyConverter] No rate returned for ${from}→${to}, using 1.`);
    }

    rateReady = true;
    run();
}
