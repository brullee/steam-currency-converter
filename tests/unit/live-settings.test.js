// Settings changed in the popup while a Steam page is open: the page must follow
// without a reload, always converting from Steam's originals (never compounding),
// and fully restoring the page when conversion is turned off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent, sleep } = require('../helpers/load-content');

const SETTLE = 300;
const RATES = { USD_EUR: 0.5, USD_GBP: 0.25, EUR_USD: 2, USD_JOD: 0.7 };
const rates = ({ from, to }) => ({ rate: RATES[`${from}_${to}`] ?? null });
const USD_EUR = { fromCurrency: 'USD', targetCurrency: 'EUR' };

const MARKET_HTML = `
    <a href="#" id="card"><div id="price">$10.00</div></a>
    <a id="header_wallet_balance">$20.00</a>
    <span id="marketWalletBalanceAmount">$30.00</span>
    <div class="jqplot-highlighter-tooltip" id="tip">Mar 01<br>$1.00<br>5 sold</div>
    <div id="zoomparent"><div class="pricehistory_zoom_controls" id="zoom">zoom</div></div>
    <div class="market_sell_dialog_input_group"><input id="market_sell_currency_input" value="$4.00"></div>
    <div class="market_sell_dialog_input_group"><input id="market_sell_buyercurrency_input" value="$4.60"></div>
    <div class="market_buy_commodity_input_row"><input id="market_buy_commodity_input_price" value="$2.00"></div>
    <div id="market_buy_commodity_order_total">$6.00</div>
    <div id="market_buyorder_dialog_walletbalance"><span id="market_buyorder_dialog_walletbalance_amount">$9.00</span></div>`;

const tipLines = p => [...p.document.getElementById('tip').childNodes].filter(n => n.nodeType === 3).map(n => n.textContent);

test('changing the target currency re-converts from the originals', async () => {
    const p = loadContent(MARKET_HTML, USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(p.text('price'), '5,00€');

    await p.setSettings({ targetCurrency: 'GBP' });
    await sleep(SETTLE);
    assert.equal(p.text('price'), '£2.50');                       // 10 × 0.25, not 5 × 0.25
    assert.equal(p.text('header_wallet_balance'), '£5.00');
    assert.equal(p.text('marketWalletBalanceAmount'), '£7.50 ($30.00)');
    assert.deepEqual(tipLines(p), ['Mar 01', '£0.25', '5 sold']);
    assert.equal(p.text('cc_receive_preview'), 'Conversion: £1.00');
    assert.equal(p.text('market_buy_commodity_order_total'), '£1.50($6.00)');
    assert.equal(p.text('market_buyorder_dialog_walletbalance_amount'), '£2.25 ($9.00)');
    assert.equal(p.document.querySelectorAll('.ext-wallet-row').length <= 1, true);

    await p.setSettings({ targetCurrency: 'EUR' });
    await sleep(SETTLE);
    assert.equal(p.text('price'), '5,00€');
});

test('turning conversion off restores the page exactly, and back on converts again', async () => {
    const p = loadContent(MARKET_HTML, USD_EUR, rates);
    const before = p.document.body.innerHTML;
    await sleep(SETTLE);
    assert.notEqual(p.document.body.innerHTML, before);

    await p.setSettings({ conversionEnabled: false });
    await sleep(SETTLE);
    assert.equal(p.text('price'), '$10.00');
    assert.equal(p.text('header_wallet_balance'), '$20.00');
    assert.equal(p.text('marketWalletBalanceAmount'), '$30.00');
    assert.deepEqual(tipLines(p), ['Mar 01', '$1.00', '5 sold']);
    assert.equal(p.text('market_buy_commodity_order_total'), '$6.00');
    assert.equal(p.text('market_buyorder_dialog_walletbalance_amount'), '$9.00');
    for (const id of ['cc_receive_preview', 'cc_buyer_preview', 'cc_buy_price_row']) {
        assert.equal(p.document.getElementById(id), null, `${id} left behind`);
    }
    assert.equal(p.document.querySelector('.ext-wallet-row'), null);
    assert.equal(p.document.getElementById('zoom').parentElement.id, 'zoomparent');

    // Typing in a dialog while off must not bring the previews back.
    const input = p.document.getElementById('market_sell_currency_input');
    input.value = '$8.00';
    input.dispatchEvent(new p.window.Event('input'));
    assert.equal(p.document.getElementById('cc_receive_preview'), null);

    await p.setSettings({ conversionEnabled: true });
    await sleep(SETTLE);
    assert.equal(p.text('price'), '5,00€');
    assert.equal(p.text('cc_receive_preview'), 'Conversion: 4,00€');
    input.value = '$2.00';
    input.dispatchEvent(new p.window.Event('input'));
    assert.equal(p.text('cc_receive_preview'), 'Conversion: 1,00€');
});

test('page goes idle after a settings change', async () => {
    const p = loadContent(MARKET_HTML, USD_EUR, rates);
    await sleep(SETTLE);
    await p.setSettings({ targetCurrency: 'GBP' });
    await sleep(SETTLE);
    await p.setSettings({ conversionEnabled: false });
    await sleep(SETTLE);
    await p.setSettings({ conversionEnabled: true });
    await sleep(SETTLE);
    const before = p.runCount();
    await sleep(1200);
    assert.equal(p.runCount() - before, 0, 'run() kept firing after the change');
    assert.equal(p.observerCount(), 1, 'each settings change added another MutationObserver');
});

test('hover can be switched off and on live', async () => {
    const p = loadContent(MARKET_HTML, USD_EUR, rates);
    await sleep(SETTLE);
    const card = p.document.getElementById('card');
    const wallet = p.document.getElementById('header_wallet_balance');
    const enter = el => el.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    const leave = el => el.dispatchEvent(new p.window.MouseEvent('mouseleave'));

    await p.setSettings({ hoverEnabled: false });
    await sleep(SETTLE);
    enter(card); enter(wallet);
    assert.equal(p.text('price'), '5,00€');
    assert.equal(wallet.textContent, '10,00€');
    leave(card); leave(wallet);

    await p.setSettings({ hoverEnabled: true });
    await sleep(SETTLE);
    enter(card); enter(wallet);
    assert.equal(p.text('price'), '$10.00');
    assert.equal(wallet.textContent, '$20.00');
    leave(card); leave(wallet);
    assert.equal(p.text('price'), '5,00€');
    assert.equal(wallet.textContent, '10,00€');
});

test('hover that was off at page load works once switched on', async () => {
    const p = loadContent(MARKET_HTML, { ...USD_EUR, hoverEnabled: false }, rates);
    await sleep(SETTLE);
    await p.setSettings({ hoverEnabled: true });
    await sleep(SETTLE);
    const wallet = p.document.getElementById('header_wallet_balance');
    wallet.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(wallet.textContent, '$20.00');
    p.document.getElementById('card').dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('price'), '$10.00');
});

test('settings changed while hovering leave nothing stuck', async () => {
    const p = loadContent(MARKET_HTML, USD_EUR, rates);
    await sleep(SETTLE);
    const card = p.document.getElementById('card');
    card.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('price'), '$10.00');
    await p.setSettings({ targetCurrency: 'GBP' });
    await sleep(SETTLE);
    card.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(p.text('price'), '£2.50');
    card.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('price'), '$10.00');
});

const fmt = (converted = {}, original = {}) => ({ formatting: { converted, original } });

test('converted formatting applies live, and only to converted prices', async () => {
    const p = loadContent('<a href="#" id="card"><div id="p">$1,234.00</div></a>', USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(p.text('p'), '617,00€');
    await p.setSettings(fmt({ customSymbol: 'EUR', symbolPosition: 'before', symbolSpace: true, hideZeroDecimals: true }));
    await sleep(SETTLE);
    assert.equal(p.text('p'), 'EUR 617');
    p.document.getElementById('card').dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('p'), '$1,234.00', 'hover original must not use the converted set');
});

test('original formatting styles the hover price', async () => {
    const p = loadContent('<a href="#" id="card"><div id="p">$1,234.00</div></a>',
        { ...USD_EUR, ...fmt({}, { customSymbol: 'US$', symbolSpace: true, thousandsSep: ' ' }) }, rates);
    await sleep(SETTLE);
    const card = p.document.getElementById('card');
    assert.equal(p.text('p'), '617,00€', 'converted price untouched by the original set');
    card.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('p'), 'US$ 1 234.00');
    card.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    // Changing the original set re-renders hover text without a reload.
    await p.setSettings(fmt({}, { hideZeroDecimals: true }));
    await sleep(SETTLE);
    card.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('p'), '$1,234');
});

test('original formatting styles wallet "(original)" text and the header wallet hover', async () => {
    const p = loadContent('<span id="marketWalletBalanceAmount">$20.00</span><a id="header_wallet_balance">$20.00</a>',
        { ...USD_EUR, ...fmt({}, { customSymbol: 'US$', symbolSpace: true }) }, rates);
    await sleep(SETTLE);
    assert.equal(p.text('marketWalletBalanceAmount'), '10,00€ (US$ 20.00)');
    const header = p.document.getElementById('header_wallet_balance');
    header.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(header.textContent, 'US$ 20.00');
    header.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(header.textContent, '10,00€');
});

test('with an untouched original set, hover shows Steam\'s text exactly', async () => {
    const p = loadContent('<a href="#" id="card"><div id="p">CDN$ 3.56</div></a>',
        { fromCurrency: 'CAD', targetCurrency: 'USD' }, () => ({ rate: 0.75 }));
    await sleep(SETTLE);
    p.document.getElementById('card').dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('p'), 'CDN$ 3.56', 'rebuilding the label would drop the space');
});

test('conversion off uses the original set; an empty original set leaves the page alone', async () => {
    const p = loadContent('<div id="p">$1,234.00</div>',
        { ...USD_EUR, conversionEnabled: false, ...fmt({ customSymbol: 'EUR' }, { hideZeroDecimals: true }) }, rates);
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$1,234');
    await p.setSettings(fmt({ customSymbol: 'EUR' }, {}));
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$1,234.00');
});

test('settings saved before 1.2 (one flat set + applyFormatting) still apply', async () => {
    const conv = loadContent('<div id="p">$1,234.00</div>',
        { ...USD_EUR, customSymbol: 'EUR', symbolPosition: 'before', symbolSpace: true }, rates);
    const off = loadContent('<div id="p">$1,234.00</div>',
        { ...USD_EUR, conversionEnabled: false, hideZeroDecimals: true, applyFormatting: 'unconverted' }, rates);
    await sleep(SETTLE);
    assert.equal(conv.text('p'), 'EUR 617,00');
    assert.equal(off.text('p'), '$1,234');
});

test('"Remove USD trail" toggles live', async () => {
    const p = loadContent('<div id="p">$9.99 USD</div>', USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€ USD');
    await p.setSettings({ stripTrailingCode: true });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€');
    await p.setSettings({ stripTrailingCode: false });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€ USD');
});

test('changing the store currency starts again from the page originals', async () => {
    const p = loadContent('<div id="p">$10.00</div>', USD_EUR, rates);
    await sleep(SETTLE);
    await p.setSettings({ fromCurrency: 'EUR', targetCurrency: 'USD' });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$10.00');   // page has no EUR prices — left as Steam shows it
    await p.setSettings({ fromCurrency: 'USD', targetCurrency: 'EUR' });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€');
});

test('configuring the extension on an already-open page starts converting', async () => {
    const p = loadContent('<div id="p">$10.00</div><div id="list"></div>', {}, rates);
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$10.00');
    await p.setSettings(USD_EUR);
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€');
    // The observer is running now too: later content is converted.
    p.document.getElementById('list').innerHTML = '<span id="n">$2.00</span>';
    await sleep(SETTLE);
    assert.equal(p.text('n'), '1,00€');
});

test('switching to a blocked or rate-less currency restores the page', async () => {
    const p = loadContent('<div id="p">$10.00</div>', USD_EUR, rates);
    await sleep(SETTLE);
    await p.setSettings({ targetCurrency: 'ILS' });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$10.00');
    await p.setSettings({ targetCurrency: 'EUR' });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€');
    await p.setSettings({ targetCurrency: 'XAU' });   // no rate available
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$10.00');
});

test('rapid changes: a slow, older rate request never overwrites a newer one', async () => {
    const slowFirst = async ({ from, to }) => {
        if (to === 'JOD') await sleep(400);   // the first change answers last
        return rates({ from, to });
    };
    const p = loadContent('<div id="p">$10.00</div>', USD_EUR, slowFirst);
    await sleep(SETTLE);
    p.setSettings({ targetCurrency: 'JOD' });
    await sleep(20);
    p.setSettings({ targetCurrency: 'GBP' });
    await sleep(700);
    assert.equal(p.text('p'), '£2.50');
});

test('content added while conversion is off is converted when it comes back on', async () => {
    const p = loadContent('<div id="p">$10.00</div><div id="list"></div>', { ...USD_EUR, conversionEnabled: false }, rates);
    await sleep(SETTLE);
    p.document.getElementById('list').innerHTML = '<span id="n">$2.00</span>';
    await sleep(SETTLE);
    assert.equal(p.text('n'), '$2.00');
    await p.setSettings({ conversionEnabled: true });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '5,00€');
    assert.equal(p.text('n'), '1,00€');
});
