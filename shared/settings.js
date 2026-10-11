// Formatting is stored as two independent sets, one per kind of price:
//   converted — prices shown in the target currency
//   original  — Steam's own prices: when conversion is off, on hover, and the
//               "(original)" part of wallet balances
// Shared by the popup and the content scripts so both read settings the same way.

const FORMAT_DEFAULTS = {
    customSymbol:     '',      // '' = the currency's own symbol
    symbolPosition:   '',      // '' = the currency's usual side; 'before' | 'after'
    symbolSpace:      false,
    decimalSep:       '',      // '' = locale default
    thousandsSep:     '',      // '' = locale default; 'none' = no separator
    hideZeroDecimals: false,
};

const FORMAT_SETS = ['converted', 'original'];

// The pre-1.2 layout: one flat set of the fields above, plus `applyFormatting`
// ('converted' | 'unconverted') saying which kind of price it was for.
const LEGACY_FORMAT_KEYS = [...Object.keys(FORMAT_DEFAULTS), 'applyFormatting'];

// { converted: {...}, original: {...} } with every field filled in.
function readFormatting(stored) {
    const sets = {};
    for (const name of FORMAT_SETS) sets[name] = { ...FORMAT_DEFAULTS, ...(stored.formatting?.[name] ?? {}) };
    if (!stored.formatting) {
        const target = stored.applyFormatting === 'unconverted' ? 'original' : 'converted';
        for (const key of Object.keys(FORMAT_DEFAULTS)) {
            if (stored[key] !== undefined) sets[target][key] = stored[key];
        }
    }
    return sets;
}

// True when a set changes anything — an untouched "original" set leaves Steam's text exactly as it is.
const hasFormatting = set => Object.keys(FORMAT_DEFAULTS).some(key => set[key] !== FORMAT_DEFAULTS[key]);
