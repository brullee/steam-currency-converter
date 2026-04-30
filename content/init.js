async function init() {
    const stored = await chrome.storage.sync.get([
        'targetCurrency', 'fromCurrency', 'conversionEnabled',
        'hoverEnabled', 'stripTrailingCode', 'customSymbol', 'symbolPosition', 'symbolSpace', 'applyFormatting',
        'decimalSep', 'thousandsSep', 'hideZeroDecimals',
    ]);

    const conversionOn    = stored.conversionEnabled !== false;
    hoverOn               = stored.hoverEnabled !== false;
    const applyFormatting = stored.applyFormatting || 'converted';
    stripUsdTrail         = !!stored.stripTrailingCode;

    const targetCurrency = (stored.targetCurrency === 'ILS' || stored.targetCurrency === 'ISL') ? null : stored.targetCurrency;
    if (!targetCurrency) {
        console.log('[CurrencyConverter] No target currency set — configure it in the popup.');
        return;
    }
    CONFIG.to = targetCurrency;

    const applyOnConvert = applyFormatting === 'converted';
    const applyOnStrip   = applyFormatting === 'unconverted';

    const manualFrom = stored.fromCurrency && stored.fromCurrency !== 'ILS' && stored.fromCurrency !== 'ISL' && CURRENCIES[stored.fromCurrency]
        ? stored.fromCurrency : null;

    if (!manualFrom) {
        console.log('[CurrencyConverter] No store currency set — configure it in the popup.');
        return;
    }

    FROM = CURRENCIES[manualFrom];
    ({ scan: PRICE_REGEX, match: PRICE_MATCH_REGEX } = buildRegexes(FROM, stripUsdTrail));

    // Load custom formatting when it applies to the current mode.
    const shouldFormat = conversionOn ? applyOnConvert : applyOnStrip;
    if (shouldFormat) {
        CONFIG.customSymbol     = stored.customSymbol   || '';
        CONFIG.symbolPosition   = stored.symbolPosition || '';
        CONFIG.symbolSpace      = !!stored.symbolSpace;
        CONFIG.decimalSep       = stored.decimalSep     || '';
        CONFIG.thousandsSep     = stored.thousandsSep   || '';
        CONFIG.hideZeroDecimals = !!stored.hideZeroDecimals;
    }

    if (!conversionOn) {
        if (!stripUsdTrail && !applyOnStrip) {
            console.log('[CurrencyConverter] Conversion is disabled.');
            return;
        }
        TO = buildToMeta(manualFrom);
        startObserver();
        strippingOnly = true;
        rate = 1;
        rateReady = true;
        run();
        return;
    }

    TO = buildToMeta(CONFIG.to);
    startObserver();

    if (manualFrom === CONFIG.to) {
        if (!stripUsdTrail) return;
        strippingOnly = true;
        rate = 1;
        rateReady = true;
        run();
        return;
    }

    console.log(`[CurrencyConverter] FROM: ${manualFrom} → TO: ${CONFIG.to}`);
    fetchRate(manualFrom, CONFIG.to);
}

init();
