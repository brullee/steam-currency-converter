// Performance, phase by phase, of the content scripts in jsdom.
//
// Each phase is timed on its own so a slowdown points at the code responsible:
//   first pass      run(): full walk, conversion, hover setup        (runner.js, hover.js, format.js)
//   idle pass       run() with nothing changed — must stay cheap      (textState fast path)
//   lazy load       observer handling cards appended later            (startObserver, runOnRoot)
//   text churn      React rewriting price text in place               (characterData path)
//   settings        popup change: reset + convert again               (resetPage, commitPlan)
//   hover           mouseenter + mouseleave on one card               (setupHover listeners)
//
// Budgets are generous upper bounds (jsdom is several times slower than Chrome, CI
// machines slower still): they catch a step change, like an accidental O(n²), not noise.
// Results go to the console and to perf/results/content.json for comparing runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadContent, sleep } = require('../helpers/load-content');
const { cards } = require('../helpers/synthetic');

const N = 2000;                 // cards on the page (~3000 prices, ~20k text nodes)
const MORE = 500;               // cards appended by "lazy load"
const RATES = { USD_EUR: 0.5, UAH_EUR: 0.02, USD_GBP: 0.25, UAH_GBP: 0.01 };
const rates = ({ from, to }) => ({ rate: RATES[`${from}_${to}`] ?? null });

const BUDGET_MS = {
    firstPass: 4000,
    idlePass:  1500,
    lazyLoad:  1500,
    textChurn: 1500,
    settings:  6000,
    hover:     5,
};

// Wraps the content-script functions (inside their own scope) to time each call.
const TIMING = `
    var __perf = { run: [], runOnRoot: 0, flushRoots: 0 };
    (() => {
        const origRun = run, origRoot = runOnRoot;
        run = function () { const t = performance.now(); const r = origRun(); __perf.run.push(performance.now() - t); return r; };
        runOnRoot = function (root) { const t = performance.now(); const r = origRoot(root); __perf.runOnRoot += performance.now() - t; __perf.flushRoots++; return r; };
    })();`;

async function until(p, expr, timeout = 30000) {
    const end = Date.now() + timeout;
    while (!p.evaluate(expr)) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${expr}`);
        await sleep(20);
    }
}

const results = {};
const priced = `document.querySelectorAll('[data-price]')`;
const allConverted = (n, sym = '€') => `[...${priced}].length === ${n} && [...${priced}].every(e => e.textContent.includes('${sym}'))`;

test('content scripts stay fast on a large page', async () => {
    const p = loadContent(cards(0, N), { fromCurrency: 'USD', targetCurrency: 'EUR' }, rates);
    p.evaluate(TIMING);
    await until(p, allConverted(N));
    await sleep(300);                                   // display-currency rate arrival + settle
    await until(p, allConverted(N));
    const firstRuns = p.evaluate('__perf.run.slice()');
    results.firstPass = firstRuns.reduce((a, b) => a + b, 0);

    // Idle: a full walk where every node is already converted.
    let t = performance.now();
    p.evaluate('run()');
    results.idlePass = performance.now() - t;

    // Lazy load: cards appended in one go, picked up by the observer.
    p.evaluate('__perf.runOnRoot = 0; __perf.flushRoots = 0; __perf.run = [];');
    const more = p.document.createElement('div');
    more.innerHTML = require('../helpers/synthetic').cards(N, MORE);
    p.document.body.append(more);
    await until(p, allConverted(N + MORE));
    results.lazyLoad = p.evaluate('__perf.runOnRoot + __perf.run.reduce((a, b) => a + b, 0)');
    results.lazyLoadFullWalks = p.evaluate('__perf.run.length');

    // Text churn: React rewrites 500 price texts in place (same text nodes).
    await sleep(200);
    p.evaluate('__perf.runOnRoot = 0; __perf.run = [];');
    p.evaluate(`[...${priced}].slice(0, 500).forEach((e, i) => { if (e.closest('[style]') && e.textContent.includes('€')) e.firstChild.nodeValue = '$' + (i + 1) + '.00'; })`);
    await sleep(400);
    results.textChurn = p.evaluate('__perf.runOnRoot + __perf.run.reduce((a, b) => a + b, 0)');

    // Settings: target currency change from the popup.
    t = performance.now();
    await p.setSettings({ targetCurrency: 'GBP' });
    await until(p, allConverted(N + MORE, '£'));
    results.settings = performance.now() - t;

    // Hover: one card in, one card out, averaged.
    const targets = [...p.document.querySelectorAll('[id^=c]')].slice(0, 200);
    t = performance.now();
    for (const el of targets) {
        el.dispatchEvent(new p.window.MouseEvent('mouseenter'));
        el.dispatchEvent(new p.window.MouseEvent('mouseleave'));
    }
    results.hover = (performance.now() - t) / targets.length;

    // The page must settle: no observer pass keeps re-triggering itself.
    const runs = p.runCount();
    await sleep(400);
    results.idleAfter = p.runCount() - runs;

    report('content', results);
    assert.equal(results.idleAfter, 0, 'page never went idle');
    for (const [phase, budget] of Object.entries(BUDGET_MS)) {
        assert.ok(results[phase] <= budget, `${phase}: ${results[phase].toFixed(1)}ms > budget ${budget}ms`);
    }
});

function report(name, data) {
    const rows = Object.entries(data).map(([k, v]) => ({
        phase: k, value: typeof v === 'number' ? +v.toFixed(2) : v, budget: BUDGET_MS[k] ?? '',
    }));
    console.table(rows);
    const dir = path.join(__dirname, 'results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ date: new Date().toISOString(), cards: N, ...data }, null, 2));
}
