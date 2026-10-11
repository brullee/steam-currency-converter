// Loads the real content scripts (in manifest order) into a jsdom window with a
// mocked `chrome` API. Scripts run in one vm context so their top-level
// const/let/function declarations are shared, exactly like content scripts.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// EXT_ROOT lets the suite run against another checkout (e.g. to confirm a test fails before a fix).
const ROOT = process.env.EXT_ROOT || path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SCRIPTS = manifest.content_scripts[0].js;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {string} html            body HTML
 * @param {object} storage         chrome.storage.sync contents
 * @param {object|'throw'} rateResponse  what the background replies to fetchRate
 * @param {{init?: boolean, iframe?: boolean}} opts  init:false skips init() for unit tests
 */
function loadContent(html, storage = {}, rateResponse = { rate: 0.5 }, { init = true, iframe = false } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
        runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    w.console = { log() {}, warn() {}, error() {} };
    w.chrome = {
        storage: { sync: { get: async () => ({ ...storage }) } },
        runtime: {
            sendMessage: async () => {
                if (rateResponse === 'throw') throw new Error('service worker unavailable');
                return rateResponse;
            },
        },
    };

    const ctx = dom.getInternalVMContext();
    const run = code => new vm.Script(code).runInContext(ctx);
    let code = SCRIPTS.filter(f => init || f !== 'content/init.js').map(read).join('\n;\n');
    if (iframe) code = code.replace('window !== window.top', 'true');
    run(code);
    // Count run() calls so tests can detect observer feedback loops.
    run('var __runs = 0; const __run = run; run = function () { __runs++; return __run(); };');

    return {
        window: w,
        document: w.document,
        /** Evaluate an expression inside the content-script scope. */
        evaluate: run,
        runCount: () => run('__runs'),
        text: id => w.document.getElementById(id).textContent,
    };
}

module.exports = { loadContent, sleep };
