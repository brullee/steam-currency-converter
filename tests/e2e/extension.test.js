// End-to-end: the packed Chrome extension running in a real Chromium (Helium).
// Pages are fixtures served on real Steam URLs; exchange rates are seeded into the
// background's cache so runs are deterministic and offline.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./browser');

const STORE  = 'https://store.steampowered.com';
const MARKET = 'https://steamcommunity.com';
const USD_EUR = { fromCurrency: 'USD', targetCurrency: 'EUR' };

let b;
before(async () => { b = await launch(); });
after(async () => { await b?.close(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = (page, sel) => page.$eval(sel, el => el.textContent);

// Wait until `sel` has `expected` text; on timeout, fail with the actual text.
async function expectText(page, sel, expected, timeout = 5000) {
    try {
        await page.waitForFunction((s, e) => document.querySelector(s)?.textContent === e, { timeout }, sel, expected);
    } catch {
        assert.equal(await page.$eval(sel, el => el.textContent).catch(() => '<missing>'), expected, sel);
    }
}

test('store page: prices converted, hover reveals original', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${STORE}/app/10/`, {
        '/app/10/': `
            <a href="#" id="card" style="display:block;padding:20px">
                <div class="discount_original_price" id="orig">$20.00</div>
                <div class="discount_final_price" id="final">$10.00</div>
            </a>
            <div id="away" style="height:200px">elsewhere</div>
            <p id="sentence">Only $5. Buy now</p>`,
    });
    await expectText(page, '#final', '5,00€');
    await expectText(page, '#orig', '10,00€');
    assert.equal(await text(page, '#sentence'), 'Only 2,50€. Buy now');

    await page.hover('#final');
    assert.equal(await text(page, '#final'), '$10.00');
    assert.equal(await text(page, '#orig'), '$20.00');
    await page.hover('#away');
    assert.equal(await text(page, '#final'), '5,00€');
    await page.close();
});

test('store page: Steam updating a price is converted and hover shows the new original', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${STORE}/sub/1/`, {
        '/sub/1/': '<a href="#" style="display:block;padding:20px"><div id="p">$10.00</div></a><div id="away" style="height:100px"></div>',
    });
    await expectText(page, '#p', '5,00€');
    await page.evaluate(() => { document.querySelector('#p').firstChild.nodeValue = '$8.00'; });
    await expectText(page, '#p', '4,00€');
    await page.hover('#p');
    assert.equal(await text(page, '#p'), '$8.00');
    await page.close();
});

test('market graph tooltip: only the price line converts, redraws stay correct', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${MARKET}/market/listings/730/x`, {
        '/market/listings/730/x': '<div class="jqplot-highlighter-tooltip" id="t">Mar 01<br>$1.00<br>5 sold</div>',
    });
    const lines = () => page.$eval('#t', t => [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent));
    await expectText(page, '#t', 'Mar 010,50€5 sold');
    assert.deepEqual(await lines(), ['Mar 01', '0,50€', '5 sold']);

    // jqplot redraws via innerHTML on every mouse move.
    for (const [price, want] of [['$3.00', '1,50€'], ['$0.10', '0,05€']]) {
        await page.evaluate(p => { document.querySelector('#t').innerHTML = `Mar 02<br>${p}<br>7 sold`; }, price);
        await expectText(page, '#t', `Mar 02${want}7 sold`);
    }
    await page.close();
});

test('market graph tooltip: USD → BRL converts once and stays stable', async () => {
    await b.configure({ fromCurrency: 'USD', targetCurrency: 'BRL' }, { USD_BRL: 5 });
    const page = await b.openSteam(`${MARKET}/market/listings/730/y`, {
        '/market/listings/730/y': '<div class="jqplot-highlighter-tooltip" id="t">Mar 01<br>$1.00<br>5 sold</div>',
    });
    await expectText(page, '#t', 'Mar 01R$5,005 sold');
    await sleep(1000);
    assert.equal(await text(page, '#t'), 'Mar 01R$5,005 sold');
    await page.close();
});

test('market page goes idle: no DOM writes once converted', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${MARKET}/market/`, {
        '/market/': `
            <a id="header_wallet_balance">$20.00</a>
            <span id="marketWalletBalanceAmount">$20.00</span>
            <div class="market_sell_dialog_input_group"><input id="market_sell_currency_input" value="$1.00"></div>
            <div class="market_sell_dialog_input_group"><input id="market_sell_buyercurrency_input" value="$1.15"></div>
            <div class="market_buy_commodity_input_row"><input id="market_buy_commodity_input_price" value="$2.00"></div>
            <div>$3.00</div>`,
    });
    await expectText(page, '#header_wallet_balance', '10,00€');
    await sleep(500);
    const mutations = await page.evaluate(() => new Promise(resolve => {
        let n = 0;
        const mo = new MutationObserver(ms => { n += ms.length; });
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        setTimeout(() => { mo.disconnect(); resolve(n); }, 2000);
    }));
    assert.equal(mutations, 0, `${mutations} DOM mutations in 2s on an idle page`);
    await page.close();
});

test('market wallet + sell dialog previews follow Steam and user input', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${MARKET}/market/`, {
        '/market/': `
            <span id="marketWalletBalanceAmount">$20.00</span>
            <div class="market_sell_dialog_input_group"><input id="market_sell_currency_input" value=""></div>
            <div class="market_sell_dialog_input_group"><input id="market_sell_buyercurrency_input" value=""></div>`,
    });
    await expectText(page, '#marketWalletBalanceAmount', '10,00€ ($20.00)');
    await page.evaluate(() => { document.querySelector('#marketWalletBalanceAmount').textContent = '$15.00'; });
    await expectText(page, '#marketWalletBalanceAmount', '7,50€ ($15.00)');

    await page.type('#market_sell_currency_input', '1,234.56');
    await expectText(page, '#cc_receive_preview', 'Conversion: 617,28€');
    await page.type('#market_sell_buyercurrency_input', '2');
    await expectText(page, '#cc_buyer_preview', 'Conversion: 1,00€');
    await page.close();
});

test('same-origin iframe (inventory sell frame) converts', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${MARKET}/id/me/inventory/`, {
        '/id/me/inventory/': '<iframe id="f" src="/frame/"></iframe>',
        '/frame/': '<div class="market_listing_row"><span id="p">$2.00</span></div>',
    });
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    await frame.waitForFunction(() => document.querySelector('#p')?.textContent === '1,00€', { timeout: 5000 });
    await page.close();
});

test('no exchange rate available: prices left untouched', async () => {
    // XTS is the ISO "testing" code — the rate API never returns it.
    await b.configure({ fromCurrency: 'USD', targetCurrency: 'XTS' });
    const page = await b.openSteam(`${STORE}/app/20/`, { '/app/20/': '<div id="p">$10.00</div>' });
    await sleep(3000);   // allow the background fetch to fail / return nothing
    assert.equal(await text(page, '#p'), '$10.00');
    await page.close();
});

test('"Remove USD trail" keeps unrelated words', async () => {
    await b.configure({ ...USD_EUR, stripTrailingCode: true }, { USD_EUR: 0.5 });
    const page = await b.openSteam(`${STORE}/search/`, {
        '/search/': '<div id="a">$9.99 USD</div><div id="b">$5.00 OFF</div><div id="c">$10 FORTNITE</div>',
    });
    await expectText(page, '#a', '5,00€');
    assert.equal(await text(page, '#b'), '2,50€ OFF');
    assert.equal(await text(page, '#c'), '5,00€ FORTNITE');
    await page.close();
});

test('popup: rejects an unknown target currency', async () => {
    await b.configure({});
    const page = await b.browser.newPage();
    await page.goto(`chrome-extension://${b.extensionId}/popup/popup.html`);
    await page.type('#to-currency', 'EUE');
    await page.select('#from-currency', 'USD');
    await page.click('#save');
    await sleep(300);
    const msg = await page.$eval('#to-currency', el => el.validationMessage);
    assert.match(msg, /not a recognised currency/);
    assert.deepEqual(await b.storage(), {});
    await page.close();
});

test('popup: saves a valid target and drops the USD-trail flag for non-USD stores', async () => {
    await b.configure({ fromCurrency: 'USD', targetCurrency: 'EUR', stripTrailingCode: true });
    const page = await b.browser.newPage();
    await page.goto(`chrome-extension://${b.extensionId}/popup/popup.html`);
    await page.waitForFunction(() => document.querySelector('#to-currency').value === 'EUR');
    assert.equal(await page.$eval('#strip-trailing', el => el.checked), true);
    await page.select('#from-currency', 'GBP');
    await page.$eval('#to-currency', el => { el.value = ''; });
    await page.type('#to-currency', 'jod');
    page.click('#save').catch(() => {});   // the popup reloads/closes itself after saving
    await sleep(1000);
    const saved = await b.storage();
    assert.equal(saved.targetCurrency, 'JOD');
    assert.equal(saved.fromCurrency, 'GBP');
    assert.equal(saved.stripTrailingCode, false);
    if (!page.isClosed()) await page.close().catch(() => {});
});
