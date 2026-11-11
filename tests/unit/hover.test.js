// One hover rule everywhere: hovering a price, or the clickable thing it belongs to,
// shows Steam's original for every price in that thing. Most of these fixtures carry no
// Steam class names at all — hover must not depend on them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent, sleep } = require('../helpers/load-content');

const SETTLE = 300;
const USD_EUR = { fromCurrency: 'USD', targetCurrency: 'EUR' };

const enter = (p, id) => p.document.getElementById(id).dispatchEvent(new p.window.MouseEvent('mouseenter'));
const leave = (p, id) => p.document.getElementById(id).dispatchEvent(new p.window.MouseEvent('mouseleave'));

test('React card made clickable with cursor:pointer groups all its prices', async () => {
    // Beta market exterior tab: a <div> with a click handler, no link, no role.
    // (jsdom doesn't inherit cursor, so the descendants spell it out.)
    const p = loadContent(`
        <div id="row">
            <div id="tab" style="cursor:pointer">
                <span style="cursor:pointer">Minimal Wear</span>
                <span id="min" style="cursor:pointer">$145.57</span>
                <span id="max" style="cursor:pointer">$396.42</span>
            </div>
            <span id="other">$1.00</span>
        </div>`, USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    enter(p, 'tab');
    assert.equal(p.text('min'), '$145.57');
    assert.equal(p.text('max'), '$396.42');
    assert.equal(p.text('other'), '0,50€', 'a price outside the card must not swap');
    leave(p, 'tab');
    assert.equal(p.text('min'), '72,79€');
});

test('pointer on an ancestor the price opted out of doesn\'t group it', async () => {
    const p = loadContent(`
        <div id="page" style="cursor:pointer">
            <div><span id="p" style="cursor:auto">$4.00</span></div>
        </div>`, USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    enter(p, 'page');
    assert.equal(p.text('p'), '2,00€');
    enter(p, 'p');
    assert.equal(p.text('p'), '$4.00');
});

test('a price that belongs to nothing clickable swaps on its own', async () => {
    // Beta market item popup: the price sits in a <dialog> beside the Buy button.
    const p = loadContent(`
        <dialog open><div>
            <span id="price">UAH 1,205.00</span><button>Buy</button>
        </div></dialog>`, USD_EUR, ({ from }) => ({ rate: from === 'UAH' ? 0.02 : 0.5 }));
    await sleep(SETTLE);
    assert.equal(p.text('price'), '24,10€');
    enter(p, 'price');
    assert.equal(p.text('price'), 'UAH 1,205.00');
    leave(p, 'price');
    assert.equal(p.text('price'), '24,10€');
});

test('links and role=button cards still group their prices', async () => {
    const p = loadContent(`
        <a href="#" id="link"><span id="a1">$2.00</span><span id="a2">$4.00</span></a>
        <div><div role="button" id="btn"><span id="b1">$6.00</span></div><a href="#">title</a></div>`,
    USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    enter(p, 'link');
    assert.deepEqual([p.text('a1'), p.text('a2')], ['$2.00', '$4.00']);
    leave(p, 'link');
    // role=button beside the card's own link: the whole card is the group.
    p.document.getElementById('btn').parentElement.dispatchEvent(new p.window.MouseEvent('mouseenter'));
    assert.equal(p.text('b1'), '$6.00');
});

test('server-rendered React page: prices convert once the page has loaded', async () => {
    const p = loadContent(`<div id="CommunityTemplate" data-react-nav-root="x"><span id="p">$8.00</span></div>`,
        USD_EUR, { rate: 0.5 });
    await sleep(SETTLE + 300);
    assert.equal(p.text('p'), '4,00€');
});

test('Steam rewriting a price mid-hover: it converts again once the mouse leaves', async () => {
    // Steam's own hover script re-renders a row's price while it's hovered (new text node).
    const p = loadContent('<a href="#" id="row"><div id="p">$2.00</div></a>', USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    enter(p, 'row');
    assert.equal(p.text('p'), '$2.00');
    p.document.getElementById('p').textContent = '$3.00';   // replaces the text node
    await sleep(SETTLE);
    leave(p, 'row');
    await sleep(SETTLE);
    assert.equal(p.text('p'), '1,50€', 'stuck on Steam\'s text after hovering');
    enter(p, 'row');
    assert.equal(p.text('p'), '$3.00', 'hover shows the new original');
    leave(p, 'row');
    assert.equal(p.text('p'), '1,50€');
});

test('Steam rewriting the same text node mid-hover: the new price wins, not the old conversion', async () => {
    const p = loadContent('<a href="#" id="row"><div id="p">$2.00</div></a>', USD_EUR, { rate: 0.5 });
    await sleep(SETTLE);
    enter(p, 'row');
    p.document.getElementById('p').firstChild.nodeValue = '$4.00';
    await sleep(SETTLE);
    leave(p, 'row');
    await sleep(SETTLE);
    assert.equal(p.text('p'), '2,00€');
});
