// Builds display metadata for any ISO 4217 currency code.
// Uses the hardcoded CURRENCIES entry when available (Steam-tested symbols),
// otherwise derives symbol and position from the browser's Intl API.
// Always adds: decimals (natural decimal places), localeDec, localeThou.
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
    try {
        const parts     = new Intl.NumberFormat(meta.numberFormat ?? 'en-US').formatToParts(1000.1);
        meta.localeDec  = parts.find(p => p.type === 'decimal')?.value ?? '.';
        meta.localeThou = parts.find(p => p.type === 'group')?.value   ?? ',';
    } catch {
        meta.localeDec  = '.';
        meta.localeThou = ',';
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
    const numPart = currency.requireDecimal
        ? `((?:[\\d.,\\u00A0]|\\s(?=[\\d.,\\u00A0]))+?[.,]\\d{2})`
        : `((?:[\\d.,\\u00A0]|\\s(?=[\\d.,\\u00A0]))+)`;
    // Only consume the trailing ISO code (e.g. " USD") when the user has opted in.
    // When off, " USD" stays in the text node so it remains visible after conversion.
    const trailingCode = stripTrailing ? `(?:\\s+[A-Z]{2,4})?` : '';
    const core = currency.position === 'before'
        ? `${sym}\\s*${signPart}${numPart}${trailingCode}`
        : `${signPart}${numPart}\\s*${sym}${trailingCode}`;
    return {
        scan:  new RegExp(core, 'g'),
        match: new RegExp(`^(\\s*)${core}$`),
    };
}

function formatAmount(value, showDecimals = true) {
    // Always start from the locale-formatted string so currency-specific grouping
    // (UAH space, VND period, INR lakh groups, etc.) is preserved by default.
    const places = showDecimals ? 2 : 0;
    let result = value.toLocaleString(TO.numberFormat, { minimumFractionDigits: places, maximumFractionDigits: places });

    // Replace thousands separator only where the user has overridden it.
    // Split-join replaces all group characters at once.
    if (CONFIG.thousandsSep && TO.localeThou) {
        const replacement = CONFIG.thousandsSep === 'none' ? '' : CONFIG.thousandsSep;
        result = result.split(TO.localeThou).join(replacement);
    }

    // Replace decimal separator only where the user has overridden it.
    // lastIndexOf targets the decimal position (always rightmost separator).
    if (CONFIG.decimalSep && TO.localeDec) {
        const idx = result.lastIndexOf(TO.localeDec);
        if (idx !== -1) result = result.slice(0, idx) + CONFIG.decimalSep + result.slice(idx + TO.localeDec.length);
    }

    // Optionally strip the decimal part when it's .00 (or locale equivalent).
    // Only relevant when showDecimals is true — 0-place format already has no decimal.
    if (showDecimals && CONFIG.hideZeroDecimals) {
        const dec = CONFIG.decimalSep || TO.localeDec || '.';
        if (result.endsWith(`${dec}00`)) result = result.slice(0, -(dec.length + 2));
    }

    return result;
}

// "₪1.23" or "1.23₪" — plain converted price, no currency code prefix.
// srcHasDecimal: whether the source price text had a decimal part (e.g. "63,50" → true, "15" → false).
function toLabel(amount, srcHasDecimal = true) {
    const n   = formatAmount(amount, srcHasDecimal);
    const sym = CONFIG.customSymbol   || TO.symbol;
    const pos = CONFIG.symbolPosition || TO.position;
    const sp  = CONFIG.symbolSpace ? ' ' : '';
    return pos === 'before' ? `${sym}${sp}${n}` : `${n}${sp}${sym}`;
}

// "JOD: ₪1.23" — used in sell/buy input preview labels.
const inputPreviewLabel = amt => `Conversion: ${toLabel(amt)}`;

// "₪1.23 (₴100)" — converted price followed by original in parens.
function withOriginal(priceText) {
    return `${convertPriceText(priceText)} (${priceText})`;
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
    const m = text.match(PRICE_MATCH_REGEX);
    if (!m) return text;
    const n = parsePrice(m[3]);
    if (isNaN(n)) return text;
    // In stripping-only mode (rate=1, same currency) preserve the source's decimal presence.
    // In conversion mode, always show 2 decimal places — the source having no decimal
    // (e.g. "59 UAH") is irrelevant to whether the converted JOD/USD value needs them.
    const srcHasDecimal = !strippingOnly || /[,.](\d{2})$/.test(m[3].replace(/[\s\u00A0]/g, ''));
    return `${m[1]}${m[2]}${toLabel(n * rate, srcHasDecimal)}`;
}
