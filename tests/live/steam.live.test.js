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

// Steam selectors the extension uses (content/steam.js), checked on the public page where
// each one belongs. None is needed to convert prices — but a selector matching nothing
// means its extra (a hover group, the sale box) has quietly stopped working.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const STEAM = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'steam.js'), 'utf8') + ';STEAM');
const PUBLIC_SELECTORS = [
    ['https://store.steampowered.com/app/620/Portal_2/', '.game_purchase_action_bg, .game_purchase_action'],
    ['https://store.steampowered.com/search/?specials=1', STEAM.notAHoverGroup],
];

test('Steam selectors in content/steam.js still match on their public pages', async () => {
    for (const [, sel] of PUBLIC_SELECTORS) assert.ok(STEAM.hoverGroups.includes(sel) || Object.values(STEAM).includes(sel), `${sel} is not in steam.js`);
    const stale = [];
    for (const [url, sel] of PUBLIC_SELECTORS) {
        const page = await open(url);
        if (!(await page.$(sel))) stale.push(`${sel}  (${url})`);
        await page.close();
    }
    assert.deepEqual(stale, [], 'Steam renamed these — check the live page, then update content/steam.js');
});

// The beta market is server-rendered React: text changed before hydration makes React
// throw away the page and render it again (minified error #418/#423/#425).
test('beta market: converting causes no React hydration errors', async () => {
    const page = await b.browser.newPage();
    const errors = [];
    page.on('pageerror', e => { if (/Minified React error #(418|423|425)/.test(e.message)) errors.push(e.message.slice(0, 80)); });
    await page.goto('https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20%28Field-Tested%29', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);
    const rateLimited = await page.evaluate(() => /too many requests/i.test(document.body.innerText));
    await page.close();
    if (rateLimited) return console.log('market rate-limited this run; hydration not checked');
    assert.deepEqual(errors, []);
});
