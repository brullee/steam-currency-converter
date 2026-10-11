// Live check: the extension against the real Steam store and the real rate API.
// Everything here can break while the code sits untouched - Steam renames a class, the
// rate API changes or dies - so it runs on a schedule, not just on push. Needs network.
//
// Assumes the store serves USD, as it does for US (GitHub runner) and Jordanian IPs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('../e2e/browser');

let b;
before(async () => {
    b = await launch();
    await b.configure({ fromCurrency: 'USD', targetCurrency: 'EUR' });   // no seeded rate → live fetch
});
after(async () => { await b?.close(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url) {
    const page = await b.browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);   // rate fetch + observer debounce
    return page;
}

test('rate API returns a plausible USD → EUR rate', async () => {
    const page = await open('https://store.steampowered.com/search/?specials=1');
    await page.close();
    const rate = await b.worker.evaluate(async () => (await chrome.storage.local.get('v3_rate_USD_EUR')).v3_rate_USD_EUR);
    assert.equal(typeof rate, 'number', 'no rate cached — exchangerate-api.com unreachable or response format changed');
    assert.ok(rate > 0.5 && rate < 1.5, `USD→EUR rate ${rate} is implausible`);
});

test('search page: every final price converted, hover shows the USD original', async () => {
    const page = await open('https://store.steampowered.com/search/?specials=1');
    const prices = await page.$$eval('.discount_final_price', els => els.map(e => e.textContent.trim()));
    assert.ok(prices.length >= 5, `only ${prices.length} .discount_final_price elements — Steam search markup changed?`);
    const unconverted = prices.filter(p => !p.includes('€'));
    assert.deepEqual(unconverted, [], 'prices left unconverted (store not in USD, or detection broke)');

    const first = await page.$('.discount_final_price');
    await first.hover();
    assert.match(await first.evaluate(e => e.textContent.trim()), /^\$\d/, 'hover did not reveal the USD original');
    await page.mouse.move(0, 0);
    await sleep(100);
    assert.match(await first.evaluate(e => e.textContent.trim()), /€$/);
    await page.close();
});

test('app page: purchase prices converted', async () => {
    const page = await open('https://store.steampowered.com/app/620/Portal_2/');
    const prices = await page.$$eval('.game_purchase_price, .discount_final_price', els => els.map(e => e.textContent.trim()));
    assert.ok(prices.length > 0, 'no purchase price elements — app page markup changed (or an age/region gate)');
    assert.deepEqual(prices.filter(p => /\$\d/.test(p)), [], `unconverted: ${JSON.stringify(prices)}`);
    await page.close();
});
