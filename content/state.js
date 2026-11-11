const CONFIG = {
    to: 'USD',       // set from the stored targetCurrency in commitPlan()
    customSymbol:   '',
    symbolPosition: '', // '' = use TO.position default
    symbolSpace:    false,
    decimalSep:       '', // '' = use TO locale default
    thousandsSep:     '', // '' = use TO locale default; 'none' = no separator
    hideZeroDecimals: false,
};

let FROM, FROM_CODE, PRICE_REGEX, PRICE_MATCH_REGEX, PRICE_MATCH_ALT, TO;

// ILS/ISL are disabled on purpose: as store, target, and named display currency.
const isBlockedCurrency = code => code === 'ILS' || code === 'ISL';

// Rates for prices that name another currency ("UAH 1,205.00"): code → rate, or null
// while the request is out / when none exists. Cleared with every settings commit.
// The version goes into each node's rate key, so a newly arrived rate reconverts.
const codeRates = new Map();
let codeRatesVersion = 0;

// Formatting for Steam's own prices (hover, wallet "(original)", conversion off),
// and FROM's display metadata to rebuild them with. Set in commitPlan().
let ORIGINAL_CONFIG = { ...FORMAT_DEFAULTS };
let FROM_META;

// True when FROM === TO and we're only stripping trailing codes — hover is suppressed
// because the "original" and "converted" values are the same currency.
let strippingOnly = false;

let hoverOn = true;

// Per-text-node conversion record: textNode → { orig, conv, rate }.
// Keyed by the node itself (not the parent element) so several price nodes
// under one parent — e.g. "Mar 01<br>$1.00<br>5 sold" — keep separate originals.
const textState = new WeakMap();

// Mirrors the "Strip trailing USD" popup checkbox.
// When true: " USD" is stripped from hover originals (hover shows "$9.99", not "$9.99 USD").
// When false: hover shows the full original including " USD".
let stripUsdTrail = false;
