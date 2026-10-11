// End-to-end: the packed Chrome extension running in real Chrome.
// Pages are fixtures served on real Steam URLs; exchange rates are seeded into the
// background's cache so runs are deterministic and offline.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./browser');

const STORE  = 'https://store.steampowered.com';
const MARKET = 'https://steamcommunity.com';
const USD_EUR = { fromCurrency: 'USD', targetCurrency: 'EUR' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

let b;
before(async () => { b = await launch(); });
// Close every tab between tests: a popup left open by a failed test would save its
// stale values when it loses focus and leak them into the next test.
// A close can hang on a page that's already going away, so each one gets a time limit.
afterEach(async () => {
    const pages = await b.browser.pages();
    await Promise.all(pages.slice(1).map(p => Promise.race([p.close().catch(() => {}), sleep(2000)])));
});
after(async () => { await b?.close(); });

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

const openPopup = async () => {
    const page = await b.browser.newPage();
    await page.goto(`chrome-extension://${b.extensionId}/popup/popup.html`);
    return page;
};

// Wait until chrome.storage.sync satisfies `check`; on timeout, fail showing what was saved.
async function expectStorage(check, timeout = 3000) {
    const end = Date.now() + timeout;
    let saved;
    while (Date.now() < end) {
        saved = await b.storage();
        if (check(saved)) return saved;
        await sleep(100);
    }
    assert.fail(`storage never matched; saved: ${JSON.stringify(saved)}`);
}

test('popup: has no Save button, and an unknown target currency is never saved', async () => {
    await b.configure({});
    const page = await openPopup();
    assert.equal(await page.$('#save'), null);
    assert.equal(await page.$('#save-more'), null);
    await page.select('#from-currency', 'USD');
    await page.type('#to-currency', 'EUE');
    await page.keyboard.press('Tab');   // leaving the field reports the problem
    await sleep(600);
    assert.match(await page.$eval('#to-currency', el => el.validationMessage), /not a recognised currency/);
    const saved = await b.storage();
    assert.equal(saved.fromCurrency, 'USD');
    assert.equal(saved.targetCurrency, undefined);
    await page.close();
});

test('popup: every change saves itself; USD-trail flag dropped for non-USD stores', async () => {
    await b.configure({ fromCurrency: 'USD', targetCurrency: 'EUR', stripTrailingCode: true });
    const page = await openPopup();
    await page.waitForFunction(() => document.querySelector('#to-currency').value === 'EUR');
    assert.equal(await page.$eval('#strip-trailing', el => el.checked), true);
    const indicatorShown = () => page.$eval('.save-indicator', el => el.classList.contains('visible'));
    assert.equal(await indicatorShown(), false, 'save indicator showing before any change');

    await page.select('#from-currency', 'GBP');
    await page.waitForFunction(() => document.querySelector('.save-indicator').classList.contains('visible'), { timeout: 2000 });
    assert.equal(await page.$eval('.save-text', el => el.textContent), 'Saved');
    await page.waitForFunction(() => !document.querySelector('.save-indicator').classList.contains('visible'), { timeout: 3000 });
    await expectStorage(s => s.fromCurrency === 'GBP' && s.stripTrailingCode === false);

    await page.$eval('#to-currency', el => { el.value = ''; });
    await page.type('#to-currency', 'jod');   // a complete code saves without leaving the field
    await expectStorage(s => s.targetCurrency === 'JOD');

    await page.click('#hover-enabled');
    await expectStorage(s => s.hoverEnabled === false);

    await page.click('#more-btn');
    const conv = s => s.formatting?.converted ?? {};
    const orig = s => s.formatting?.original ?? {};
    await page.type('#custom-symbol', 'JD');
    await expectStorage(s => conv(s).customSymbol === 'JD');
    await page.select('#dec-sep', ',');
    await expectStorage(s => conv(s).decimalSep === ',');
    await page.select('#thou-sep', '.');
    await expectStorage(s => conv(s).thousandsSep === '.' && conv(s).decimalSep === ',');
    // "," is the decimal, so it can't also be picked as thousands separator.
    assert.equal(await page.$eval('#thou-sep option[value=","]', o => o.disabled), true);
    await page.close();
});

test('popup: Converted and Original formatting are separate sets', async () => {
    // Pre-1.2 layout: one flat set, marked as being for unconverted prices.
    await b.configure({ fromCurrency: 'USD', targetCurrency: 'EUR', customSymbol: 'US$', applyFormatting: 'unconverted' });
    const page = await openPopup();
    await page.waitForFunction(() => document.querySelector('#to-currency').value === 'EUR');
    await page.click('#more-btn');

    // Opens on the set in use (conversion is on → Converted), which the old layout left empty.
    assert.equal(await page.$eval('input[name="format-set"]:checked', r => r.value), 'converted');
    assert.equal(await page.$eval('#custom-symbol', el => el.value), '');

    await page.click('.segmented label:nth-child(2)');   // Original
    assert.equal(await page.$eval('#custom-symbol', el => el.value), 'US$');
    await sleep(500);
    assert.equal((await b.storage()).formatting, undefined, 'switching sets alone saved something');

    await page.click('#hide-zero-decimals');
    const saved = await expectStorage(s => s.formatting?.original?.hideZeroDecimals === true);
    assert.equal(saved.formatting.original.customSymbol, 'US$');
    assert.equal(saved.formatting.converted.hideZeroDecimals, false);
    assert.equal(saved.customSymbol, undefined, 'old flat keys left behind');
    assert.equal(saved.applyFormatting, undefined, 'old flat keys left behind');

    await page.click('.segmented label:nth-child(1)');   // back to Converted
    assert.equal(await page.$eval('#hide-zero-decimals', el => el.checked), false);
    await page.close();
});

test('live: popup changes update an open Steam tab without reloading it', async () => {
    await b.configure(USD_EUR, { USD_EUR: 0.5, USD_GBP: 0.25 });
    const steam = await b.openSteam(`${STORE}/app/30/`, {
        '/app/30/': `
            <a href="#" id="card" style="display:block;padding:20px"><div id="p">$10.00</div></a>
            <div id="away" style="height:100px"></div>
            <a id="header_wallet_balance">$20.00</a>`,
    });
    await expectText(steam, '#p', '5,00€');
    await steam.evaluate(() => { window.__notReloaded = true; });

    const popup = await openPopup();
    await popup.waitForFunction(() => document.querySelector('#to-currency').value === 'EUR');
    await popup.$eval('#to-currency', el => { el.value = ''; });
    await popup.type('#to-currency', 'GBP');
    await expectText(steam, '#p', '£2.50');
    await expectText(steam, '#header_wallet_balance', '£5.00');

    await popup.click('label.toggle');                   // off (the checkbox itself is visually hidden)
    await expectText(steam, '#p', '$10.00');
    await expectText(steam, '#header_wallet_balance', '$20.00');

    await popup.click('label.toggle');                   // back on
    await expectText(steam, '#p', '£2.50');

    await popup.click('#hover-enabled');                 // hover off
    await sleep(500);
    await steam.bringToFront();
    await steam.hover('#p');
    assert.equal(await text(steam, '#p'), '£2.50');
    await steam.hover('#away');

    await popup.bringToFront();
    await popup.click('#more-btn');
    await popup.type('#custom-symbol', 'GBP');
    await popup.click('input[name="sym-pos"][value="before"]');
    await popup.click('#sym-space');
    await expectText(steam, '#p', 'GBP 2.50');

    assert.equal(await steam.evaluate(() => window.__notReloaded), true, 'the Steam tab was reloaded');
    await popup.close();
    await steam.close();
});

test('live: a tab opened before the extension was configured starts converting', async () => {
    await b.configure({}, { USD_EUR: 0.5 });
    const steam = await b.openSteam(`${STORE}/app/40/`, { '/app/40/': '<div id="p">$10.00</div><div id="list"></div>' });
    await sleep(500);
    assert.equal(await text(steam, '#p'), '$10.00');

    const popup = await openPopup();
    await popup.select('#from-currency', 'USD');
    await popup.type('#to-currency', 'EUR');
    await expectText(steam, '#p', '5,00€');
    await steam.evaluate(() => { document.querySelector('#list').innerHTML = '<span id="n">$4.00</span>'; });
    await expectText(steam, '#n', '2,00€');
    await popup.close();
    await steam.close();
});
