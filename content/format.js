// Builds display metadata for any ISO 4217 currency code.
// Uses the hardcoded CURRENCIES entry when available (Steam-tested symbols),
// otherwise derives symbol and position from the browser's Intl API.
function buildToMeta(code) {
    let meta;
    if (CURRENCIES[code]) {
        meta = { ...CURRENCIES[code] };
    } else {
        try {
            const parts  = new Intl.NumberFormat('en', { style: 'currency', currency: code }).formatToParts(1);
            const symbol = parts.find(p => p.type === 'currency')?.value ?? code;
            const types  = parts.map(p => p.type);
            meta = { symbol, position: types.indexOf('currency') < types.indexOf('integer') ? 'before' : 'after', numberFormat: undefined };
        } catch {
            meta = { symbol: code, position: 'after', numberFormat: undefined };
        }
    }
    return meta;
}

function buildRegexes(currency, stripTrailing = false) {
    // altSymbol: some currencies display differently on certain Steam pages
    // (e.g. PHP shows ₱ on search/browse but ASCII "P" on game pages).
    const sym = currency.altSymbol
        ? `(?:${escapeRegex(currency.symbol)}|${escapeRegex(currency.altSymbol)})`
        : escapeRegex(currency.symbol);
    const signPart = `([-\\u2212+]?)`;
    // Spaces are only consumed if followed by a digit/separator (thousands),
    // not if followed by a letter (e.g. the "U" in " USD"). This prevents the
    // trailing-code group from being blocked by a greedy space match.
    // requireDecimal: use a lazy quantifier that forces a [.,]NN ending, so
    // bare "R18" (age ratings) can't match ZAR's single-char symbol.
    // The number must end in a digit so trailing punctuation ("$5." / "₩ 3,030,")
    // stays in the text instead of being swallowed by the conversion.
    const numPart = currency.requireDecimal
        ? `((?:[\\d.,\\u00A0]|\\s(?=[\\d.,\\u00A0]))+?[.,]\\d{2})`
        : `((?:[\\d.,\\u00A0]|\\s(?=[\\d.,\\u00A0]))*\\d)`;
    // Only consume the trailing " USD" when the user has opted in. The lookahead
    // stops it from eating the start of a longer word (e.g. "USDT").
    // When off, " USD" stays in the text node so it remains visible after conversion.
    const trailingCode = stripTrailing ? `(?:\\s+USD(?![A-Za-z]))?` : '';
    const before = `${sym}\\s*${signPart}${numPart}${trailingCode}`;
    const after  = `${signPart}${numPart}\\s*${sym}${trailingCode}`;
    // The beta market formats prices by the account's locale, so the symbol can sit on
    // the other side from the rest of Steam ("0.87$" next to "$23.06"). That other side
    // is matched strictly: symbol against the number, and not followed by a digit or
    // letter — otherwise "Save 5 $10.00" would read as "5 $", and "5 Players" as PHP "5 P".
    const flipped = currency.position === 'before'
        ? `${signPart}${numPart}${sym}(?![\\dA-Za-z])${trailingCode}`
        : `(?<![\\d.,])${sym}${signPart}${numPart}${trailingCode}`;
    const usual = currency.position === 'before' ? before : after;
    return {
        scan:      new RegExp(`${usual}|${flipped}`, 'g'),
        match:     new RegExp(`^(\\s*)${usual}$`),
        matchAlt:  new RegExp(`^(\\s*)${flipped}$`),
    };
}

// A whole-text FROM price in either symbol position: [full, leading space, sign, number].
function matchPrice(text) {
    return text.match(PRICE_MATCH_REGEX) || (PRICE_MATCH_ALT ? text.match(PRICE_MATCH_ALT) : null);
}

// "UAH 1,205.00": a price that names its currency. The beta market shows listings this
// way, in a local display currency that isn't the wallet's (UAH for a USD wallet in
// Ukraine). The code makes the currency unambiguous, so it converts with its own rate.
// Only Steam's currencies count — "TOP 10" or "ALL 5" are not Tongan or Albanian money.
const CODE_PRICE_REGEX = /(?<![A-Za-z])([A-Z]{3})[  ]?([-−+]?)(\d(?:[\d., ]|\s(?=[\d., ]))*\d|\d)(?![\d])/g;

function hasCodePrice(text) {
    CODE_PRICE_REGEX.lastIndex = 0;
    let m;
    while ((m = CODE_PRICE_REGEX.exec(text))) if (CURRENCIES[m[1]] && m[1] !== CONFIG.to) return true;
    return false;
}

// Asks for one display currency's rate the first time it shows up; the page is
// converted again once it arrives. No rate → those prices stay as Steam wrote them.
function requestCodeRate(code) {
    codeRates.set(code, null);
    const gen = settingsGeneration;
    requestRate(code, CONFIG.to).then(r => {
        if (gen !== settingsGeneration || !r) return;
        codeRates.set(code, r);
        codeRatesVersion++;
        run();
    });
}

function convertCodePrices(text) {
    if (strippingOnly) return text;
    CODE_PRICE_REGEX.lastIndex = 0;
    return text.replace(CODE_PRICE_REGEX, (m, code, sign, num) => {
        if (!CURRENCIES[code] || code === CONFIG.to || isBlockedCurrency(code)) return m;
        const r = code === FROM_CODE ? rate : codeRates.get(code);
        if (r === undefined) { requestCodeRate(code); return m; }
        const n = parsePrice(num);
        if (!r || isNaN(n)) return m;
        return `${sign}${toLabel(n * r)}`;
    });
}

// Building an Intl.NumberFormat is expensive — it was over half of the extension's time
// on a large page (perf/chrome.perf.test.js) — so there is one per locale and decimals.
const numberFormats = new Map();
function numberFormat(locale, places) {
    const key = `${locale}|${places}`;
    let f = numberFormats.get(key);
    if (!f) {
        const opts = { minimumFractionDigits: places, maximumFractionDigits: places };
        try { f = new Intl.NumberFormat(locale, opts); } catch { f = new Intl.NumberFormat('en-US', opts); }
        numberFormats.set(key, f);
    }
    return f;
}

// meta/config default to the converted price's; the original-price path passes FROM's.
function formatAmount(value, showDecimals = true, meta = TO, config = CONFIG) {
    // Format via parts so separators are swapped by role, never by searching the
    // string, so a replaced group separator can't be mistaken for the decimal later.
    // Starting from the locale keeps currency-specific grouping (UAH space, VND period,
    // INR lakh groups, etc.) by default.
    const places = showDecimals ? 2 : 0;
    const parts = numberFormat(meta.numberFormat, places).formatToParts(value);

    const localeDec  = parts.find(p => p.type === 'decimal')?.value;
    const localeThou = parts.find(p => p.type === 'group')?.value;
    let dec = config.decimalSep || localeDec;
    let grp = config.thousandsSep === 'none' ? '' : (config.thousandsSep || localeThou);
    // One override can collide with the other separator's locale default
    // (e.g. EUR with thousands set to "," → "1,234,56"). The explicit choice wins
    // and the defaulted one flips to the other symbol.
    if (grp && grp === dec) {
        const other = grp === ',' ? '.' : ',';
        if (config.decimalSep) grp = other; else dec = other;
    }

    // Optionally drop the decimal part when it's all zeros.
    const fraction = parts.find(p => p.type === 'fraction')?.value;
    const hideFraction = showDecimals && config.hideZeroDecimals && fraction && /^0+$/.test(fraction);

    return parts.map(p => {
        if (p.type === 'group')   return grp;
        if (p.type === 'decimal') return hideFraction ? '' : dec;
        if (p.type === 'fraction') return hideFraction ? '' : p.value;
        return p.value;
    }).join('');
}

// "₪1.23" or "1.23₪" — plain converted price, no currency code prefix.
// srcHasDecimal: whether the source price text had a decimal part (e.g. "63,50" → true, "15" → false).
function toLabel(amount, srcHasDecimal = true, meta = TO, config = CONFIG) {
    const n   = formatAmount(amount, srcHasDecimal, meta, config);
    const sym = config.customSymbol   || meta.symbol;
    const pos = config.symbolPosition || meta.position;
    const sp  = config.symbolSpace ? ' ' : '';
    return pos === 'before' ? `${sym}${sp}${n}` : `${n}${sp}${sym}`;
}

// "JOD: ₪1.23" — used in sell/buy input preview labels.
const inputPreviewLabel = amt => `Conversion: ${toLabel(amt)}`;

// "₪1.23 (₴100)" — converted price followed by original in parens. With conversion
// off both halves are the same currency and amount, so only one is shown.
function withOriginal(priceText) {
    if (strippingOnly) return convertPriceText(priceText);
    return `${convertPriceText(priceText)} (${formatOriginalText(priceText)})`;
}

// Steam prices always have exactly 2 decimal digits when a decimal exists (e.g. $3.99, 2.64€).
// So: if the last separator is followed by exactly 2 digits → it's decimal; everything else is thousands.
// This correctly handles ₩ 27,000 (→ 27000), 312.000₫ (→ 312000), and $9.99 (→ 9.99).
function parsePrice(numStr) {
    const s = numStr.replace(/[\s\u00A0]/g, '');
    const m = s.match(/^(.*)[,.](\d{2})$/);
    if (m) return parseFloat((m[1].replace(/[,.]/g, '') || '0') + '.' + m[2]);
    return parseFloat(s.replace(/[,.]/g, ''));
}

function convertPriceText(text) {
    const m = matchPrice(text);
    if (!m) return text;
    const n = parsePrice(m[3]);
    if (isNaN(n)) return text;
    // In stripping-only mode (rate=1, same currency) preserve the source's decimal presence.
    // In conversion mode, always show 2 decimal places — the source having no decimal
    // (e.g. "59 UAH") is irrelevant to whether the converted JOD/USD value needs them.
    const srcHasDecimal = !strippingOnly || /[,.](\d{2})$/.test(m[3].replace(/[\s\u00A0]/g, ''));
    return `${m[1]}${m[2]}${toLabel(n * rate, srcHasDecimal)}`;
}

// One of Steam's own prices restyled with the "original" formatting set — the same
// currency, so no rate, and decimals kept the way Steam showed them.
function formatOriginalPrice(text) {
    const m = matchPrice(text);
    if (!m) return text;
    const n = parsePrice(m[3]);
    if (isNaN(n)) return text;
    const srcHasDecimal = /[,.](\d{2})$/.test(m[3].replace(/[\s\u00A0]/g, ''));
    return `${m[1]}${m[2]}${toLabel(n, srcHasDecimal, FROM_META, ORIGINAL_CONFIG)}`;
}

// Steam's original text as shown on hover and in "(original)" labels. With an untouched
// original set it stays exactly as Steam wrote it (rebuilding it would change spacing,
// e.g. "CDN$ 3.56" → "CDN$3.56"), apart from the optional " USD" removal.
function formatOriginalText(text) {
    PRICE_REGEX.lastIndex = 0;
    if (hasFormatting(ORIGINAL_CONFIG)) return text.replace(PRICE_REGEX, m => formatOriginalPrice(m));
    return stripUsdTrail ? text.replace(PRICE_REGEX, m => m.replace(/\s+USD$/, '')) : text;
}
