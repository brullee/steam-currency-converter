// Performance of the page as a whole: the packed extension in real Chrome on a large
// offline fixture, measured the way a user feels it.
//
//   extension script   main-thread time with the extension's code on the stack, from
//                      V8's CPU profiler (Chrome's page counters miss content scripts)
//   longest task       the longest main-thread block while converting (jank)
//   converted after    page load → last price converted
//   lazy load          cards appended later → converted
//   hover              mouseenter + mouseleave on one card
//
// Budgets are generous upper bounds that catch a step change, not noise. Results go to
// the console and to perf/results/chrome.json for comparing runs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launch } = require('../e2e/browser');
const { cards } = require('../helpers/synthetic');

const N = 3000;
const MORE = 1000;
const URL = 'https://steamcommunity.com/market/listings/730/perf';
const RATES = { USD_EUR: 0.5, UAH_EUR: 0.02 };

const BUDGET_MS = {
    extensionScript: 1500,
    longestTask:     800,
    convertedAfter:  4000,
    lazyLoad:        1500,
    hover:           2,
};

// Page-side probes: long tasks, and when price text last changed.
const PROBES = `<script>
    window.__perf = { longest: 0, lastWrite: 0 };
    new PerformanceObserver(l => l.getEntries().forEach(e => { __perf.longest = Math.max(__perf.longest, e.duration); }))
        .observe({ type: 'longtask', buffered: true });
    new MutationObserver(() => { __perf.lastWrite = performance.now(); })
        .observe(document.body, { characterData: true, childList: true, subtree: true });
</script>`;

let b;
before(async () => { b = await launch(); });
after(async () => { await b?.close(); });

const allConverted = n => `document.querySelectorAll('[data-price]').length === ${n}
    && [...document.querySelectorAll('[data-price]')].every(e => e.textContent.includes('€'))`;

// Main-thread time with the extension's code on the stack, from V8's sampling CPU
// profiler: a sample counts when any frame in it comes from chrome-extension://, so
// native work the extension calls (regex, DOM) is included. (A Chrome trace misses
// most of it: code resumed after an `await` runs as a microtask with no script URL.)
function extensionTime(profile) {
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const inExt = new Map();
    const isExt = id => {
        if (inExt.has(id)) return inExt.get(id);
        const n = byId.get(id);
        const r = n.callFrame.url.startsWith('chrome-extension://') || (parent.has(id) && isExt(parent.get(id)));
        inExt.set(id, r);
        return r;
    };
    // Per function: each sample goes to the nearest extension frame on its stack, so
    // native work (regex, DOM calls) is charged to the extension function that asked.
    let us = 0;
    const perFn = {};
    profile.samples.forEach((id, i) => {
        if (!isExt(id)) return;
        const dt = profile.timeDeltas[i + 1] ?? 0;
        us += dt;
        let n = byId.get(id);
        while (!n.callFrame.url.startsWith('chrome-extension://')) n = byId.get(parent.get(n.id));
        const f = n.callFrame;
        const key = `${f.functionName || '(anonymous)'}  ${f.url.replace(/^chrome-extension:\/\/[^/]+\//, '')}:${f.lineNumber + 1}`;
        perFn[key] = (perFn[key] ?? 0) + dt;
    });
    const top = Object.entries(perFn).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([fn, t]) => ({ function: fn, ms: +(t / 1000).toFixed(1) }));
    return { ms: us / 1000, top };
}

async function openFixture(settings) {
    await b.configure(settings, RATES);
    const page = await b.openSteam(URL, { '/market/listings/730/perf': PROBES + cards(0, N) }, {
        beforeGoto: async p => {
            await p.setViewport({ width: 1280, height: 800 });
            p.__cdp = await p.createCDPSession();
            await p.__cdp.send('Profiler.enable');
            await p.__cdp.send('Profiler.setSamplingInterval', { interval: 200 });
            await p.__cdp.send('Profiler.start');
        },
    });
    return page;
}

test('the extension stays light on a large page', async () => {
    const page = await openFixture({ fromCurrency: 'USD', targetCurrency: 'EUR' });
    await page.waitForFunction(allConverted(N), { timeout: 30000, polling: 50 });
    await new Promise(r => setTimeout(r, 1000));      // settle: display-currency rate, observer
    const results = {};
    const cpu = extensionTime((await page.__cdp.send('Profiler.stop')).profile);
    results.extensionScript = cpu.ms;
    const probe = await page.evaluate(() => window.__perf);
    results.longestTask = probe.longest;
    results.convertedAfter = probe.lastWrite;

    // Lazy load: append cards the way an infinite list does.
    const lazyStart = await page.evaluate(html => {
        const t = performance.now();
        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.append(div);
        return t;
    }, cards(N, MORE));
    await page.waitForFunction(allConverted(N + MORE), { timeout: 30000, polling: 20 });
    results.lazyLoad = (await page.evaluate(() => window.__perf.lastWrite)) - lazyStart;

    // Hover: events reach the extension's listeners like real mouse moves do.
    results.hover = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[id^=c]')].slice(0, 300);
        const t = performance.now();
        for (const el of els) {
            el.dispatchEvent(new MouseEvent('mouseenter'));
            el.dispatchEvent(new MouseEvent('mouseleave'));
        }
        return (performance.now() - t) / els.length;
    });
    await page.close();

    console.log('Where the extension spends its time (first conversion):');
    console.table(cpu.top);
    console.table(Object.entries(results).map(([phase, v]) => ({ phase, ms: +v.toFixed(2), budget: BUDGET_MS[phase] })));
    const dir = path.join(__dirname, 'results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chrome.json'), JSON.stringify({ date: new Date().toISOString(), cards: N, ...results, topFunctions: cpu.top }, null, 2));
    for (const [phase, budget] of Object.entries(BUDGET_MS)) {
        assert.ok(results[phase] <= budget, `${phase}: ${results[phase].toFixed(1)}ms > budget ${budget}ms`);
    }
});
