// Pure parsing / formatting functions from content/format.js and content/market.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('../helpers/load-content');

const env = loadContent('', {}, null, { init: false });
const call = (fn, ...args) => env.evaluate(`${fn}(${args.map(a => JSON.stringify(a)).join(',')})`);

// Point the content scripts at a FROM/TO pair with the given CONFIG overrides.
function setup({ from = 'USD', to = 'EUR', config = {}, strip = false, stripping = false } = {}) {
    env.evaluate(`
        FROM = CURRENCIES[${JSON.stringify(from)}];
        ({ scan: PRICE_REGEX, match: PRICE_MATCH_REGEX } = buildRegexes(FROM, ${strip}));
        TO = buildToMeta(${JSON.stringify(to)});
        Object.assign(CONFIG, { customSymbol: '', symbolPosition: '', symbolSpace: false,
            decimalSep: '', thousandsSep: '', hideZeroDecimals: false }, ${JSON.stringify(config)});
        strippingOnly = ${stripping};
        rate = 1;`);
}

test('parsePrice handles each regional format', () => {
    assert.equal(call('parsePrice', '9.99'), 9.99);
    assert.equal(call('parsePrice', '27,000'), 27000);      // ₩ 27,000
    assert.equal(call('parsePrice', '312.000'), 312000);    // 312.000₫
    assert.equal(call('parsePrice', '1 234,56'), 1234.56);
    assert.equal(call('parsePrice', '1,23,456'), 123456);   // ₹ lakh grouping
    assert.equal(call('parsePrice', '1.234,56'), 1234.56);
});

test('parseInputAmount reads market inputs with thousands separators and symbols', () => {
    setup({ from: 'USD' });
    assert.equal(call('parseInputAmount', '$1,234.56'), 1234.56);
    assert.equal(call('parseInputAmount', '0.03'), 0.03);
    setup({ from: 'EUR' });
    assert.equal(call('parseInputAmount', '1.234,56€'), 1234.56);
    assert.equal(call('parseInputAmount', '0,03€'), 0.03);
    assert.equal(call('parseInputAmount', '12,5'), 12.5);    // mid-typing
    setup({ from: 'PEN' });
    assert.equal(call('parseInputAmount', 'S/.6.46'), 6.46);
    setup({ from: 'RUB' });
    assert.equal(call('parseInputAmount', '1 100 руб.'), 1100);
    assert.equal(call('parseInputAmount', ''), 0);
});

test('formatAmount keeps locale defaults', () => {
    setup({ to: 'USD' });
    assert.equal(call('formatAmount', 1234.5, true), '1,234.50');
    setup({ to: 'EUR' });
    assert.equal(call('formatAmount', 1234.5, true), '1.234,50');
    setup({ to: 'INR' });
    assert.equal(call('formatAmount', 123456, true), '1,23,456.00');
});

test('formatAmount applies separator overrides by role, not by string search', () => {
    setup({ to: 'USD', config: { thousandsSep: '.', decimalSep: ',' } });
    assert.equal(call('formatAmount', 1234.5, true), '1.234,50');
    assert.equal(call('formatAmount', 1234, false), '1.234');  // used to come out as "1,234"
    setup({ to: 'EUR', config: { thousandsSep: 'none' } });
    assert.equal(call('formatAmount', 1234567.5, true), '1234567,50');
    setup({ to: 'USD', config: { thousandsSep: ' ' } });
    assert.equal(call('formatAmount', 1234.5, true), '1 234.50');
});

test('formatAmount never outputs the same symbol for both separators', () => {
    // Thousands override collides with the locale decimal → decimal flips.
    setup({ to: 'EUR', config: { thousandsSep: ',' } });
    assert.equal(call('formatAmount', 1234.56, true), '1,234.56');
    // Decimal override collides with the locale group → group flips.
    setup({ to: 'USD', config: { decimalSep: ',' } });
    assert.equal(call('formatAmount', 1234.56, true), '1.234,56');
});

test('formatAmount hideZeroDecimals', () => {
    setup({ to: 'USD', config: { hideZeroDecimals: true } });
    assert.equal(call('formatAmount', 1234, true), '1,234');
    assert.equal(call('formatAmount', 1234.5, true), '1,234.50');
    setup({ to: 'EUR', config: { hideZeroDecimals: true, decimalSep: '.', thousandsSep: ',' } });
    assert.equal(call('formatAmount', 12, true), '12');
});

test('toLabel applies symbol, position and spacing overrides', () => {
    setup({ to: 'EUR' });
    assert.equal(call('toLabel', 5), '5,00€');
    setup({ to: 'EUR', config: { customSymbol: 'EUR', symbolPosition: 'before', symbolSpace: true } });
    assert.equal(call('toLabel', 5), 'EUR 5,00');
    setup({ to: 'JOD' });   // not in CURRENCIES → derived from Intl
    assert.match(call('toLabel', 5), /^JOD\s?5\.00$/);
});

test('price regex leaves trailing punctuation in place', () => {
    setup({ from: 'USD', to: 'EUR' });
    env.evaluate('rate = 0.5');
    const conv = s => env.evaluate(`${JSON.stringify(s)}.replace(PRICE_REGEX, m => convertPriceText(m))`);
    assert.equal(conv('Only $5. Buy now'), 'Only 2,50€. Buy now');
    assert.equal(conv('$1,234.50, then'), '617,25€, then');
    setup({ from: 'KRW', to: 'USD' });
    env.evaluate('rate = 0.001');
    assert.equal(conv('₩ 27,000.'), '$27.00.');
});

test('"Remove USD trail" strips only the USD code', () => {
    setup({ from: 'USD', to: 'EUR', strip: true });
    env.evaluate('rate = 0.5');
    const conv = s => env.evaluate(`${JSON.stringify(s)}.replace(PRICE_REGEX, m => convertPriceText(m))`);
    assert.equal(conv('$9.99 USD'), '5,00€');
    assert.equal(conv('$5.00 OFF'), '2,50€ OFF');
    assert.equal(conv('$10 FORTNITE'), '5,00€ FORTNITE');
    assert.equal(conv('$10 USDT'), '5,00€ USDT');
});

test('ZAR price regex ignores "R18" age ratings', () => {
    setup({ from: 'ZAR', to: 'USD' });
    env.evaluate('rate = 0.05');
    const conv = s => env.evaluate(`${JSON.stringify(s)}.replace(PRICE_REGEX, m => convertPriceText(m))`);
    assert.equal(conv('R18 rated. R 27.88'), 'R18 rated. $1.39');
});
