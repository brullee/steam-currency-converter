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
 * @param {object} storage         initial chrome.storage.sync contents
 * @param {object|'throw'|function} rateResponse  what the background replies to a
 *        fetchRate message; a function receives the message ({ from, to }) and returns it
 * @param {{init?: boolean, iframe?: boolean}} opts  init:false skips init.js for unit tests
 */
function loadContent(html, storage = {}, rateResponse = { rate: 0.5 }, { init = true, iframe = false } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
        runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    w.console = { log() {}, warn() {}, error() {} };
    // In-memory sync storage that fires onChanged like the real one, so tests can
    // change settings the way the popup does and watch the page follow.
    const sync = { ...storage };
    const changeListeners = [];
    w.chrome = {
        storage: {
            sync: {
                get: async () => ({ ...sync }),
                set: async items => {
                    const changes = {};
                    for (const [k, v] of Object.entries(items)) {
                        if (sync[k] !== v) changes[k] = { oldValue: sync[k], newValue: v };
                        sync[k] = v;
                    }
                    if (Object.keys(changes).length) changeListeners.forEach(fn => fn(changes, 'sync'));
                },
            },
            onChanged: { addListener: fn => changeListeners.push(fn) },
        },
        runtime: {
            sendMessage: async msg => {
                if (rateResponse === 'throw') throw new Error('service worker unavailable');
                return typeof rateResponse === 'function' ? rateResponse(msg) : rateResponse;
            },
        },
    };

    // Count observers: a second one doubles the work on every page change without
    // changing any text, so nothing else would notice.
    let observers = 0;
    const NativeObserver = w.MutationObserver;
    w.MutationObserver = class extends NativeObserver {
        constructor(cb) { super(cb); observers++; }
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
        observerCount: () => observers,
        /** Change settings like the popup does (fires storage.onChanged). */
        setSettings: items => w.chrome.storage.sync.set(items),
        text: id => w.document.getElementById(id).textContent,
    };
}

module.exports = { loadContent, sleep };
