// Market beta (React): dialogs are native <dialog> elements with hashed class names,
// so the fixtures copy the live structure but leave the classes out. The buy order
// price input can be in Steam's local display currency (here ₴ for a USD wallet),
// while the maximum price is always the wallet currency.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent, sleep } = require('../helpers/load-content');

const SETTLE = 300;
const USD_EUR = { fromCurrency: 'USD', targetCurrency: 'EUR' };

const BUY_DIALOG = `
    <dialog open><form><div>
        <h2>Buy an item</h2>
        <div><span>AK-47 | Redline (Battle-Scarred)</span><span id="item">UAH 1,205.00</span></div>
        <div>
            <span>Subtotal:</span><span id="subtotal">$23.06</span>
            <span>Steam transaction fee (5.0%):</span><span id="fee">$1.14</span>
            <span>Total:</span><span id="total">$26.52</span>
        </div>
    </div></form></dialog>`;

const ORDER_DIALOG = `
    <dialog open><form><div>
        <h2>Place Buy Order</h2>
        <div id="grid">
            <span>What price do you want to pay:</span>
            <div><div><input type="text" id="price" value="1 364₴"></div></div>
            <span id="per-item">(per item)</span>
            <span>How many do you want to buy:</span>
            <div><div><input type="text" id="qty" value="1"></div></div>
            <span></span>
            <span>Maximum price <span>(?)</span>:</span>
            <span id="max">$30.00</span>
            <span></span>
        </div>
    </div></form></dialog>`;

// The listing page around the dialogs: header wallet and exterior tabs use the
// account locale ("145.57$"), listing cards the display currency with its code.
const LISTING_PAGE = `
    <span id="wallet">0.87$</span>
    <div><span>Minimal Wear</span><span id="tab-min">145.57$</span><span id="tab-max">396.42$</span></div>
    <a href="#" id="card"><span>Pattern Template: 765</span><span id="card-price">UAH 1,205.00</span></a>
    <span id="top">TOP 10</span>`;

const RATES = { USD_EUR: 0.5, UAH_EUR: 0.02 };
const rates = ({ from, to }) => ({ rate: RATES[`${from}_${to}`] ?? null });

test('listing page: locale-formatted store prices and display-currency prices convert', async () => {
    const p = loadContent(LISTING_PAGE, USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(p.text('wallet'), '0,44€');
    assert.equal(p.text('tab-min'), '72,79€');
    assert.equal(p.text('card-price'), '24,10€');            // 1205 × UAH→EUR, not via USD
    assert.equal(p.text('top'), 'TOP 10');
    // Hover shows Steam's own text.
    p.document.getElementById('card').dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('card-price'), 'UAH 1,205.00');
    p.document.getElementById('card').dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(p.text('card-price'), '24,10€');

    // Back off: every page text exactly as Steam wrote it.
    await p.setSettings({ conversionEnabled: false });
    await sleep(SETTLE);
    assert.equal(p.text('card-price'), 'UAH 1,205.00');
    assert.equal(p.text('wallet'), '0.87$');
});

test('display currency without a rate stays untouched (never 1:1)', async () => {
    const p = loadContent(LISTING_PAGE, USD_EUR, ({ from }) => ({ rate: from === 'USD' ? 0.5 : null }));
    await sleep(SETTLE);
    assert.equal(p.text('card-price'), 'UAH 1,205.00');
    assert.equal(p.text('wallet'), '0,44€');
});

test('display-currency listings added later convert too, and the page goes idle', async () => {
    const p = loadContent(LISTING_PAGE, USD_EUR, rates);
    await sleep(SETTLE);
    const more = p.document.createElement('a');
    more.innerHTML = '<span id="later">UAH 2,410.00</span>';
    p.document.body.append(more);
    await sleep(SETTLE);
    assert.equal(p.text('later'), '48,20€');
    const runs = p.runCount();
    await sleep(SETTLE);
    assert.equal(p.runCount(), runs);
});

test('buy dialog: charges converted, Steam\'s amount kept beside them, hover like everywhere', async () => {
    const p = loadContent(BUY_DIALOG, USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(p.text('subtotal'), '11,53€');
    assert.equal(p.text('total'), '13,26€');
    assert.equal(p.document.getElementById('total').dataset.ccOriginal, '$26.52');
    assert.equal(p.document.getElementById('fee').dataset.ccOriginal, '$1.14');
    // The display-currency price converts with its own rate (no "original" label:
    // it isn't what gets charged).
    assert.equal(p.text('item'), '24,10€');
    assert.equal(p.document.getElementById('item').dataset.ccOriginal, undefined);
    // Hover shows the original in place (CSS hides the annotation while hovering).
    const total = p.document.getElementById('total');
    total.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('total'), '$26.52');
    assert.equal(total.dataset.ccHovering, 'true');
    total.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(p.text('total'), '13,26€');
});

test('buy order: per-item chip under the price input, from the maximum price', async () => {
    const p = loadContent(ORDER_DIALOG, USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    const chip = p.document.getElementById('cc_order_preview');
    assert.ok(chip, 'no preview chip');
    assert.equal(chip.textContent, '≈ 15,00€per item');
    assert.equal(p.document.getElementById('per-item').nextElementSibling, chip);
    assert.equal(p.text('max'), '15,00€');
    assert.equal(p.document.getElementById('max').dataset.ccOriginal, '$30.00');
});

test('buy order: chip follows Steam rewriting the maximum price', async () => {
    const p = loadContent(ORDER_DIALOG, USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    // Typing quantity 3: Steam updates the input and rewrites the maximum (same text node).
    p.document.getElementById('qty').value = '3';
    p.document.getElementById('max').firstChild.nodeValue = '$90.00';
    await sleep(SETTLE);
    assert.equal(p.document.getElementById('cc_order_preview').firstChild.textContent, '≈ 15,00€');
    assert.equal(p.text('max'), '45,00€');
    assert.equal(p.document.getElementById('max').dataset.ccOriginal, '$90.00');

    p.document.getElementById('max').firstChild.nodeValue = '$120.00';
    await sleep(SETTLE);
    assert.equal(p.document.getElementById('cc_order_preview').firstChild.textContent, '≈ 20,00€');
});

test('beta dialogs: page goes idle after converting', async () => {
    const p = loadContent(BUY_DIALOG + ORDER_DIALOG, USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    const runs = p.runCount();
    await sleep(SETTLE);
    assert.equal(p.runCount(), runs);
    assert.equal(p.document.querySelectorAll('#cc_order_preview').length, 1);
});

test('beta dialogs: turning conversion off restores them exactly', async () => {
    const p = loadContent(BUY_DIALOG + ORDER_DIALOG, USD_EUR, { rate: 0.5 });
    const before = p.document.body.innerHTML;
    await sleep(SETTLE);
    assert.notEqual(p.document.body.innerHTML, before);

    await p.setSettings({ conversionEnabled: false });
    await sleep(SETTLE);
    assert.equal(p.document.body.innerHTML, before);

    await p.setSettings({ conversionEnabled: true });
    await sleep(SETTLE);
    assert.equal(p.text('total'), '13,26€');
    assert.ok(p.document.getElementById('cc_order_preview'));
});

const EXTERIOR_TABS = `
    <div>
        <div data-selected="true" id="tab" style="cursor:pointer">
            <span style="cursor:pointer">Minimal Wear</span>
            <span id="lo" style="cursor:pointer">$145.57</span>
            <span id="hi" style="cursor:pointer">$396.42</span>
        </div>
        <div data-selected="false" style="cursor:pointer"><span style="cursor:pointer">Factory New</span><span id="none" style="cursor:pointer">--</span></div>
    </div>`;

test('exterior tabs: prices convert as plain text in Steam styling, hover shows the originals', async () => {
    const p = loadContent(EXTERIOR_TABS, USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(p.text('lo'), '72,79€');
    assert.equal(p.text('hi'), '198,21€');
    assert.equal(p.document.querySelectorAll('[data-cc-chip], .cc-chip').length, 0, 'no chip styling in the tabs');
    p.document.getElementById('tab').dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.deepEqual([p.text('lo'), p.text('hi')], ['$145.57', '$396.42']);
    p.document.getElementById('tab').dispatchEvent(new p.window.MouseEvent('mouseleave'));

    await p.setSettings({ conversionEnabled: false });
    await sleep(SETTLE);
    assert.equal(p.text('lo'), '$145.57');
});

// Listing page sidebar / Advanced Search: min and max in the display currency (₴).
const PRICE_FILTER = `
    <div id="filter"><div>
        <div><div data-has-value="false"><div><input type="text" id="min" placeholder="Min Price"></div><div>₴</div></div></div>
        <span>-</span>
        <div><div data-has-value="false"><div><input type="text" id="max" placeholder="Max Price"></div><div>₴</div></div></div>
    </div>
    <div><span role="slider" aria-valuenow="0"></span><span role="slider" aria-valuenow="208"></span></div></div>`;

const type = (p, id, value) => {
    const el = p.document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new p.window.Event('input', { bubbles: true }));
};
const rangeChip = p => p.document.querySelector('#filter > .cc-range-chip')?.textContent ?? null;

test('price filter: a chip shows the typed range converted from the display currency', async () => {
    const p = loadContent(PRICE_FILTER, USD_EUR, rates);
    await sleep(SETTLE);
    assert.equal(rangeChip(p), null, 'nothing typed, no chip');
    type(p, 'min', '100');
    await sleep(100);
    assert.equal(rangeChip(p), '≥ 2,00€');
    type(p, 'max', '1 000');
    await sleep(100);
    assert.equal(rangeChip(p), '≈ 2,00€ to 20,00€');
    type(p, 'min', '');
    await sleep(100);
    assert.equal(rangeChip(p), '≤ 20,00€');

    await p.setSettings({ conversionEnabled: false });
    await sleep(SETTLE);
    assert.equal(rangeChip(p), null);
});

test('hover in a dialog: the annotation stays put and the width is locked, then released', async () => {
    const p = loadContent(BUY_DIALOG, USD_EUR, rates);
    await sleep(SETTLE);
    const total = p.document.getElementById('total');
    total.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.match(total.style.minWidth, /px$/);
    // An observer pass mid-hover (any page change) must not drop the annotation.
    p.document.body.append(p.document.createElement('div'));
    await sleep(SETTLE);
    assert.equal(total.dataset.ccOriginal, '$26.52');
    assert.equal(p.text('total'), '$26.52');
    total.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    assert.equal(total.style.minWidth, '');
    assert.equal(p.text('total'), '13,26€');
});
