// The three manifests are edited by hand and must stay in step: a version bumped in one
// but not the others, or a content script added to only one, ships a broken build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.EXT_ROOT || path.resolve(__dirname, '..', '..');
const load = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
// manifest.json is a copy of the Chrome manifest, so "Load unpacked" on the repo folder
// works in Chrome; Firefox loads manifest.firefox.json.
const main = load('manifest.json');
const firefox = load('manifest.firefox.json');
const chrome = load('manifest.chrome.json');

test('manifest.json and manifest.chrome.json are identical', () => {
    assert.deepEqual(main, chrome);
});

test('Chrome and Firefox manifests agree on everything but the browser-specific keys', () => {
    for (const key of ['version', 'name', 'description', 'icons', 'action', 'host_permissions', 'content_scripts']) {
        assert.deepEqual(chrome[key], firefox[key], `"${key}" differs between manifest.chrome.json and manifest.firefox.json`);
    }
});

test('every file a manifest references exists', () => {
    for (const m of [firefox, chrome]) {
        const files = [
            ...Object.values(m.icons),
            m.action.default_popup,
            ...(m.background.scripts ?? [m.background.service_worker]),
            ...m.content_scripts.flatMap(cs => [...cs.js, ...(cs.css ?? [])]),
        ];
        for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `missing: ${f}`);
    }
});
