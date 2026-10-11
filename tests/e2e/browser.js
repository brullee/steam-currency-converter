// Launches a real Chrome with the extension installed and serves fixture HTML on
// real Steam URLs, so the content scripts inject exactly as they do in production.
//
// Browser: the installed Google Chrome by default. BROWSER=helium uses the local
//          Helium install; BROWSER_PATH overrides both.
// Headed:  set HEADED=1 to watch the run.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

// EXT_ROOT lets the suite run against another checkout (e.g. to confirm a test fails before a fix).
const ROOT = process.env.EXT_ROOT || path.resolve(__dirname, '..', '..');
const BROWSERS = {
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    helium: 'C:\\Program Files\\imput\\Helium\\Application\\chrome.exe',
};
const SHIPPED = ['background', 'content', 'icons', 'popup', 'shared'];

// Copy the shipped files into a temp dir with the Chrome manifest (service worker
// background) as manifest.json — the root manifest.json is the Firefox flavour.
function buildChromeExtension() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-ext-'));
    for (const d of SHIPPED) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'manifest.chrome.json'), path.join(dir, 'manifest.json'));
    return dir;
}

// Google Chrome (not Helium/Chromium) keeps "Default/Account Web Data" locked after it
// exits — no chrome.exe is left running, and plain ACLs allow the delete — so each run
// leaves an ~11 MB profile behind. Sweep whatever has been released since (at the latest
// after a reboot).
function removeStaleTempDirs() {
    for (const name of fs.readdirSync(os.tmpdir())) {
        if (!/^scc-(ext|profile)-/.test(name)) continue;
        try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); } catch { /* still in use */ }
    }
}

async function launch() {
    removeStaleTempDirs();
    const executablePath = process.env.BROWSER_PATH || BROWSERS[process.env.BROWSER || 'chrome'];
    if (!executablePath || !fs.existsSync(executablePath)) {
        throw new Error(`Browser not found at ${executablePath} — set BROWSER_PATH (or BROWSER=chrome|helium)`);
    }
    const extDir = buildChromeExtension();
    // Our own profile dir: Puppeteer deletes the temp profile it creates on close, and on
    // Windows that fails with EPERM while Chrome still holds files in it. A dir we pass in
    // is left alone, and we remove it ourselves with retries.
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-profile-'));
    const browser = await puppeteer.launch({
        executablePath,
        userDataDir: profileDir,
        headless: !process.env.HEADED,
        enableExtensions: true,
        // GitHub's Ubuntu runners block the unprivileged user namespaces Chrome's sandbox
        // needs; the runner VM is throwaway, so run unsandboxed there only.
        args: ['--no-first-run', '--no-default-browser-check', ...(process.env.CI ? ['--no-sandbox'] : [])],
    });
    const extensionId = await browser.installExtension(extDir);
    const swTarget = await browser.waitForTarget(
        t => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}/`));
    const worker = await swTarget.worker();
    // The worker target can appear a moment before Chrome injects the extension APIs into
    // it ("chrome is not defined" on the first configure()) — wait until they're there.
    for (let i = 0; i < 50; i++) {
        if (await worker.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.sync).catch(() => false)) break;
        await new Promise(r => setTimeout(r, 100));
    }

    // Replace extension storage. `rates` seeds the background's daily cache so no
    // network request is made, e.g. { 'USD_EUR': 0.5 }.
    async function configure(settings, rates = {}) {
        await worker.evaluate(async (settings, rates) => {
            await chrome.storage.sync.clear();
            await chrome.storage.local.clear();
            await chrome.storage.sync.set(settings);
            const local = {};
            for (const [pair, rate] of Object.entries(rates)) {
                local[`v3_rate_${pair}`] = rate;
                local[`v3_ts_${pair}`]   = Date.now();
            }
            await chrome.storage.local.set(local);
        }, settings, rates);
    }

    const storage = () => worker.evaluate(() => chrome.storage.sync.get(null));

    // Open `url` with the document (and any same-host frame) served from `pages`
    // ({ pathname: html }). Every other request is aborted, keeping runs offline.
    async function openSteam(url, pages) {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', req => {
            const u = new URL(req.url());
            const html = pages[u.pathname];
            if (html !== undefined && req.isNavigationRequest()) {
                req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>` });
            } else {
                req.abort();
            }
        });
        // Helium occasionally aborts the first navigation of a fresh tab before it
        // reaches interception (net::ERR_ABORTED) — a browser-side race, so retry.
        for (let attempt = 1; ; attempt++) {
            try {
                await page.goto(url, { waitUntil: 'load' });
                return page;
            } catch (e) {
                if (attempt >= 3 || !String(e.message).includes('ERR_ABORTED')) throw e;
            }
        }
    }

    async function close() {
        await browser.close();
        for (const dir of [extDir, profileDir]) {
            try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
            catch { /* Chrome still releasing a file — a leftover temp dir isn't worth a failed run */ }
        }
    }

    return { browser, extensionId, worker, configure, storage, openSteam, close };
}

module.exports = { launch };
