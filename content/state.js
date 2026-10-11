const CONFIG = {
    to: 'USD',       // overridden by stored.targetCurrency in init()
    customSymbol:   '',
    symbolPosition: '', // '' = use TO.position default
    symbolSpace:    false,
    decimalSep:       '', // '' = use TO locale default
    thousandsSep:     '', // '' = use TO locale default; 'none' = no separator
    hideZeroDecimals: false,
};

let FROM, PRICE_REGEX, PRICE_MATCH_REGEX, TO;

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
