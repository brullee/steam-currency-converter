// Whole content-script behaviour on a jsdom page: applySettings → requestRate → run → observer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent, sleep } = require('../helpers/load-content');

const USD_EUR = { fromCurrency: 'USD', targetCurrency: 'EUR' };
const SETTLE = 300; // > observer debounce (100ms) + async init

test('converts prices and keeps surrounding text', async () => {
    const p = loadContent('<div id="a">$10.00</div><div id="b">Total: $1,234.50</div>', USD_EUR);
    await sleep(SETTLE);
    assert.equal(p.text('a'), '5,00€');
    assert.equal(p.text('b'), 'Total: 617,25€');
});

test('sibling price nodes under one parent keep their own values', async () => {
    const p = loadContent('<div id="p">$10.00<br>$20.00</div><div id="other"></div>', USD_EUR);
    await sleep(SETTLE);
    p.document.getElementById('other').append(p.document.createElement('span'));
    await sleep(SETTLE);
    const nodes = [...p.document.getElementById('p').childNodes].filter(n => n.nodeType === 3);
    assert.deepEqual(nodes.map(n => n.textContent), ['5,00€', '10,00€']);
});

test('graph tooltip: non-price lines untouched, redraws converted fresh', async () => {
    const p = loadContent('<div class="jqplot-highlighter-tooltip" id="t">Mar 01<br>$1.00<br>5 sold</div>', USD_EUR);
    await sleep(SETTLE);
    const lines = () => [...p.document.getElementById('t').childNodes].filter(n => n.nodeType === 3).map(n => n.textContent);
    assert.deepEqual(lines(), ['Mar 01', '0,50€', '5 sold']);
    p.document.getElementById('t').innerHTML = 'Mar 02<br>$3.00<br>7 sold';   // jqplot redraw
    await sleep(SETTLE);
    assert.deepEqual(lines(), ['Mar 02', '1,50€', '7 sold']);
});

test('graph tooltip is converted exactly once when TO symbol contains "$"', async () => {
    const p = loadContent('<div class="jqplot-highlighter-tooltip" id="t">Mar 01<br>$1.00<br>5 sold</div>',
        { fromCurrency: 'USD', targetCurrency: 'BRL' }, { rate: 5 });
    await sleep(SETTLE);
    assert.equal(p.text('t'), 'Mar 01R$5,005 sold');
    await sleep(800);
    assert.equal(p.text('t'), 'Mar 01R$5,005 sold');
});

test('USD → AUD page text is stable (no re-conversion of "A$")', async () => {
    const p = loadContent('<div id="a">$10.00</div>', { fromCurrency: 'USD', targetCurrency: 'AUD' }, { rate: 1.5 });
    await sleep(SETTLE);
    p.document.body.append(p.document.createElement('div'));
    await sleep(SETTLE);
    assert.equal(p.text('a'), 'A$15.00');
});

for (const [name, html] of [
    ['wallet balance', '<a id="header_wallet_balance">$20.00</a><div>$1.00</div>'],
    ['sell previews', `
        <div class="market_sell_dialog_input_group"><input id="market_sell_currency_input" value="$1.00"></div>
        <div class="market_sell_dialog_input_group"><input id="market_sell_buyercurrency_input" value="$1.15"></div>`],
    ['buy previews', `
        <div class="market_buy_commodity_input_row"><input id="market_buy_commodity_input_price" value="$2.00"></div>
        <div id="market_buyorder_dialog_walletbalance"><span id="market_buyorder_dialog_walletbalance_amount">$9.00</span></div>`],
]) {
    test(`${name}: observer settles on an idle page`, async () => {
        const p = loadContent(html, USD_EUR);
        await sleep(SETTLE);
        const before = p.runCount();
        await sleep(1500);
        assert.equal(p.runCount() - before, 0, 'run() kept firing with no page changes');
    });
}

test('market wallet picks up a balance Steam writes after load', async () => {
    const p = loadContent('<span id="marketWalletBalanceAmount">$20.00</span>', USD_EUR);
    await sleep(SETTLE);
    assert.equal(p.text('marketWalletBalanceAmount'), '10,00€ ($20.00)');
    p.document.getElementById('marketWalletBalanceAmount').textContent = '$15.00';
    await sleep(SETTLE);
    assert.equal(p.text('marketWalletBalanceAmount'), '7,50€ ($15.00)');
});

test('header wallet hover shows original and restores', async () => {
    const p = loadContent('<a id="header_wallet_balance">$20.00</a>', USD_EUR);
    await sleep(SETTLE);
    const el = p.document.getElementById('header_wallet_balance');
    assert.equal(el.textContent, '10,00€');
    el.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(el.textContent, '$20.00');
    el.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(el.textContent, '10,00€');
});

test('sell previews track input values', async () => {
    const p = loadContent(`
        <div class="market_sell_dialog_input_group"><input id="market_sell_currency_input" value="$1,234.56"></div>
        <div class="market_sell_dialog_input_group"><input id="market_sell_buyercurrency_input" value="$2.00"></div>`, USD_EUR);
    await sleep(SETTLE);
    assert.equal(p.text('cc_receive_preview'), 'Conversion: 617,28€');
    assert.equal(p.text('cc_buyer_preview'), 'Conversion: 1,00€');
    const input = p.document.getElementById('market_sell_buyercurrency_input');
    input.value = '$4.00';
    input.dispatchEvent(new p.window.Event('input'));
    assert.equal(p.text('cc_buyer_preview'), 'Conversion: 2,00€');
});

test('hover shows the current original after Steam updates a price', async () => {
    const p = loadContent('<a href="#"><div id="p">$10.00</div></a>', USD_EUR);
    await sleep(SETTLE);
    p.document.getElementById('p').firstChild.textContent = '$8.00';
    await sleep(SETTLE);
    assert.equal(p.text('p'), '4,00€');
    const a = p.document.querySelector('a');
    a.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('p'), '$8.00');
    a.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(p.text('p'), '4,00€');
});

test('price text changed in place alongside an added element is still converted', async () => {
    const p = loadContent('<div id="p">$10.00</div><div id="list"></div>', USD_EUR);
    await sleep(SETTLE);
    p.document.getElementById('p').firstChild.textContent = '$6.00';
    p.document.getElementById('list').innerHTML = '<span id="n">$2.00</span>';
    await sleep(SETTLE);
    assert.equal(p.text('p'), '3,00€');
    assert.equal(p.text('n'), '1,00€');
});

for (const resp of [{ rate: null }, { rate: undefined }, { rate: 0 }, 'throw']) {
    test(`no usable rate (${JSON.stringify(resp) ?? 'throw'}) leaves prices untouched`, async () => {
        const p = loadContent('<div id="p">$10.00</div>', USD_EUR, resp);
        await sleep(600);   // includes the 300ms retry
        assert.equal(p.text('p'), '$10.00');
    });
}

test('stale "Remove USD trail" flag is ignored for a non-USD store', async () => {
    const p = loadContent('<div id="b">5,00€ USD</div>',
        { fromCurrency: 'EUR', targetCurrency: 'USD', stripTrailingCode: true }, { rate: 2 });
    await sleep(SETTLE);
    assert.equal(p.text('b'), '$10.00 USD');
});

test('"Remove USD trail" with conversion off strips the code only', async () => {
    const p = loadContent('<div id="a">$9.99 USD</div><div id="b">$5 OFF</div>',
        { fromCurrency: 'USD', targetCurrency: 'EUR', conversionEnabled: false, stripTrailingCode: true });
    await sleep(SETTLE);
    assert.equal(p.text('a'), '$9.99');
    assert.equal(p.text('b'), '$5 OFF');
});

test('same store and target currency without stripping does nothing', async () => {
    const p = loadContent('<div id="a">$9.99</div>', { fromCurrency: 'USD', targetCurrency: 'USD' });
    await sleep(SETTLE);
    p.document.body.append(p.document.createElement('div'));
    await sleep(SETTLE);
    assert.equal(p.text('a'), '$9.99');
    assert.equal(p.runCount(), 0);
});

test('ILS target stays disabled', async () => {
    const p = loadContent('<div id="p">$10.00</div>', { fromCurrency: 'USD', targetCurrency: 'ILS' });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '$10.00');
});

test('iframe context still converts', async () => {
    const p = loadContent('<div class="market_listing_row"><span id="p">$2.00</span></div>', USD_EUR, { rate: 0.5 }, { iframe: true });
    await sleep(SETTLE);
    assert.equal(p.text('p'), '1,00€');
});
