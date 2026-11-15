// The Stillhet switch as a top-bar icon: the owner's mock (plans/rail/prototype/stillhet-switch.html and .js), its persona
// note and PNGs (plans/rail/stillhet-switch.md, plans/rail/mocks/), and the guard on what stays live: the ask switch is off
// and Settings › Labs keeps the `rail` row.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as R from '../ui/public/design-system/components/index.mjs';
import { ICONS } from '../ui/public/design-system/components/icons.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SCRIPT = 'plans/rail/prototype/stillhet-switch.js';

const windows = [];
after(() => { for (const w of windows) w.close(); });

function world() {
  const dom = new JSDOM('<body><p data-mock-note></p><div id="mock"></div><button id="away">away</button></body>', { runScripts: 'outside-only' });
  const w = dom.window, calls = [];
  windows.push(w);
  w.fetch = (...a) => { calls.push(a); return Promise.reject(new Error('no network in the mock')); };
  const open = w.XMLHttpRequest.prototype.open;
  w.XMLHttpRequest.prototype.open = function (...a) { calls.push(a); return open.apply(this, a); };
  w.navigator.sendBeacon = (...a) => { calls.push(a); return false; };
  w.WebSocket = function (...a) { calls.push(a); throw new Error('no network in the mock'); };
  w.RailUI = R;
  w.eval(read(SCRIPT));
  const M = w.StillhetSwitchMock, host = w.document.getElementById('mock');
  const icon = () => host.querySelector('[data-stillhet="ui-icon"]');
  const rows = () => [...host.querySelectorAll('[role^="menuitem"]')];
  return { w, doc: w.document, M, host, icon, rows, calls };
}

test('the icon sits right of Ask worca and Pulse at 20px', () => {
  const { M, host, icon } = world();
  M.draw(host, { case: 'closed' });
  const order = [...host.querySelectorAll('#topnav-ask, .pz-pulse-b, [data-stillhet="ui-icon"]')];
  assert.deepEqual(order.map((e) => e.id || e.dataset.stillhet || 'pulse'), ['topnav-ask', 'pulse', 'ui-icon']);
  assert.ok(order[1].classList.contains('pz-pulse-b'));
  const slot = host.querySelector('.pz-pulse-b').nextElementSibling;
  assert.equal(slot.dataset.stillhet, 'ui-slot');
  assert.ok(slot.contains(icon()));
  assert.ok(icon().classList.contains('btn-sm') && icon().classList.contains('topnav-act'));
  const svg = icon().querySelector('svg');
  assert.equal(svg.getAttribute('width'), '20');
  assert.equal(svg.getAttribute('height'), '20');
  assert.equal(icon().getAttribute('aria-expanded'), 'false');
  assert.equal(icon().getAttribute('aria-haspopup'), 'menu');
});

test('a click opens exactly two rows, the current UI checked, with Stillhet on and off', () => {
  for (const [on, checked] of [[true, 'Try Stillhet'], [false, "Back to today's UI"]]) {
    const { M, host, icon, rows } = world();
    M.draw(host, { case: 'closed', on });
    assert.equal(rows().length, 0);
    icon().click();
    assert.equal(rows().length, 2);
    assert.deepEqual(rows().map((r) => r.textContent), [...M.ITEMS]);
    assert.deepEqual(rows().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent), [checked]);
    assert.equal(host.querySelectorAll('.menu-h, .menu-sep').length, 0, 'no header, no separator');
    assert.equal(icon().getAttribute('aria-expanded'), 'true');
    icon().click();
    assert.equal(rows().length, 0, 'a second click closes it');
  }
});

test('Esc closes and gives focus back; so does a click outside', () => {
  const { w, doc, M, host, icon, rows } = world();
  M.draw(host, { case: 'menu' });
  assert.equal(rows().length, 2);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(rows().length, 0);
  assert.equal(doc.activeElement, icon());
  assert.equal(icon().getAttribute('aria-expanded'), 'false');
  icon().click();
  assert.equal(rows().length, 2);
  doc.querySelector('[data-mock-note]').click();
  assert.equal(rows().length, 0);
  assert.equal(doc.activeElement, icon());
});

test('the tip names it the new UI', () => {
  const { doc, M, host, icon } = world();
  M.draw(host, { case: 'closed' });
  assert.equal(icon().getAttribute('title'), M.TIP);
  assert.match(M.TIP, /new/);
  assert.match(M.TIP, /beta/);
  assert.equal(icon().getAttribute('data-tip-text'), null);
  assert.equal(icon().getAttribute('aria-label'), 'Stillhet UI · beta');
  M.draw(host, { case: 'tip' });
  assert.equal(doc.activeElement, icon());
});

test('locked says why, on the tip and on both rows', () => {
  const { M, host, icon, rows } = world();
  M.draw(host, { case: 'locked' });
  assert.equal(M.LOCKED, 'Locked by WORCA_FLAGS');
  assert.ok(icon().getAttribute('title').includes(M.LOCKED));
  icon().click();
  assert.equal(rows().length, 2);
  assert.ok(rows().every((r) => r.getAttribute('aria-disabled') === 'true' && r.getAttribute('title') === M.LOCKED));
  rows()[1].click();
  assert.equal(rows().length, 2, 'a disabled row does nothing; the menu stays open');
  assert.equal(rows()[0].getAttribute('aria-checked'), 'true');
});

test('a pick moves the check and stays in the mock', () => {
  const { doc, M, host, icon, rows, calls } = world();
  M.draw(host, { case: 'menu' });
  rows()[1].click();
  assert.equal(rows().length, 0, 'the menu is gone');
  assert.match(doc.querySelector('[data-mock-note]').textContent, /^Picked: Back to today's UI · the build reloads into today's app/);
  assert.equal(doc.activeElement, icon());
  icon().click();
  assert.equal(rows()[1].getAttribute('aria-checked'), 'true');
  assert.equal(rows()[0].getAttribute('aria-checked'), 'false');
  doc.querySelector('[data-mock-note]').textContent = '';
  rows()[1].click();
  assert.equal(rows().length, 0, 'the checked row only closes');
  assert.equal(doc.querySelector('[data-mock-note]').textContent, '', 'and changes nothing');
  assert.equal(calls.length, 0);
});

test('an unknown case throws', () => {
  const { M, host } = world();
  assert.throws(() => M.draw(host, { case: 'x' }), /unknown case "x"/);
});

test('the gear panel shows before and after, each in the Pulse head', () => {
  const { M, host } = world();
  M.draw(host, { case: 'icons' });
  assert.ok(host.querySelector('[data-stillhet="ui-icon"]'), 'the top bar is drawn too');
  const side = (s) => host.querySelector(`[data-panel="gear"] [data-side="${s}"]`);
  const parsed = (html) => { const t = host.ownerDocument.createElement('template'); t.innerHTML = html; return t.content.querySelector('svg').innerHTML; };
  const inner = (s) => [...side(s).querySelectorAll('svg')].map((x) => x.innerHTML);
  const gear = parsed(R.icon('gear')), sun = parsed(R.icon('sun'));
  for (const before of [M.BEFORE_GEAR, M.BEFORE_NAV_SETTINGS]) {
    assert.ok(inner('before').includes(parsed(`<svg>${before}</svg>`)));
    assert.notEqual(before, ICONS.gear);
    assert.notEqual(before, ICONS.sun);
  }
  assert.ok(inner('after').includes(gear), 'after: the library\'s gear');
  assert.ok(inner('after').includes(sun), 'sun beside it');
  assert.ok(inner('after').includes(parsed(R.icon('stillhet-ui'))));
  for (const [s, want] of [['before', parsed(`<svg>${M.BEFORE_GEAR}</svg>`)], ['after', gear]]) {
    const b = side(s).querySelector('[data-context="pulse-head"]');
    assert.equal(b.getAttribute('aria-label'), 'Notification settings');
    assert.equal(b.querySelector('svg').innerHTML, want);
  }
});

test('the Pulse row panel shows the smaller Pulse mark in each tone', () => {
  const { M, host } = world();
  M.draw(host, { case: 'icons' });
  assert.deepEqual([...M.ROW_TONES], ['ask', 'idle', 'fail', 'act']);
  const signal = (() => { const t = host.ownerDocument.createElement('template'); t.innerHTML = R.icon('signal'); return t.content.querySelector('svg').innerHTML; })();
  for (const s of ['before', 'after']) {
    const marks = [...host.querySelectorAll(`[data-panel="pulse-row"] [data-side="${s}"] .kind-mark`)];
    assert.equal(marks.length, 4, s);
    assert.deepEqual(marks.map((m) => [...m.classList].find((c) => c.startsWith('is-'))), [...M.ROW_TONES].map((t) => 'is-' + t));
    assert.ok(marks.every((m) => (m.querySelector('svg').innerHTML === signal) === (s === 'after')), s);
  }
});

test('the mock holds no copied markup and exactly 2 own drawings', () => {
  const src = read(SCRIPT);
  for (const bad of ['class="btn', 'role="menu', 'topnav-ask', 'kind-mark', 'data-menu-pick', 'const GEAR', 'const GLYPH']) assert.ok(!src.includes(bad), bad);
  assert.deepEqual([...src.matchAll(/^\s*const (\w+) = '<circle/gm)].map((m) => m[1]), ['BEFORE_GEAR', 'BEFORE_NAV_SETTINGS']);
  assert.equal(src.split('<svg').length - 1, 1, 'one frame for both "before" drawings');
  assert.match(src, /R\.stillhetSwitch\(/);
  assert.match(src, /R\.watchStillhetSwitch\(/);
});

test('the page loads the library first and holds no handler; the index links it', () => {
  const html = read('plans/rail/prototype/stillhet-switch.html');
  assert.ok(html.indexOf('stillhet/components.js') > 0 && html.indexOf('stillhet/components.js') < html.indexOf('stillhet-switch.js'));
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sheets.length >= 5);
  assert.ok(sheets.every((h) => h.startsWith('../../../ui/public/stillhet/')), sheets.join(' '));
  assert.doesNotMatch(html, /\son[a-z]+\s*=/);
  assert.match(read('plans/rail/prototype/index.html'), /href="stillhet-switch\.html"/);
});

test('STILLHET_ASK_ON is still false', async () => {
  const { STILLHET_ASK_ON } = await import('../src/core/stillhet.mjs');
  assert.equal(STILLHET_ASK_ON, false);
});

test('Settings › Labs still renders the Stillhet row, off and on', async () => {
  const { stillhetLabsRow } = await import('../ui/public/stillhet.mjs');
  const { flagRowsHtml } = await import('../ui/public/flags-view.mjs');
  for (const on of [false, true]) {
    const rows = [{ key: 'rail', title: 'Stillhet', description: 'd', stage: 'experimental', on, locked: false }];
    assert.match(flagRowsHtml(rows.filter(stillhetLabsRow())), /data-flag-row="rail"/, `on: ${on}`);
  }
});

test('the persona note lists each persona\'s challenge and its outcome', () => {
  const md = read('plans/rail/stillhet-switch.md');
  const parts = md.split(/^### /m).slice(1);
  for (const who of ['New user', 'Daily user', 'UX reviewer']) {
    const part = parts.find((p) => p.startsWith(who));
    assert.ok(part, who);
    const lines = part.split('\n').filter((l) => l.startsWith('- **Challenge:**'));
    assert.ok(lines.length >= 1, who);
    for (const l of lines) assert.match(l, /(Changed|Rejected):/, l);
  }
  const all = md.split('\n').filter((l) => l.startsWith('- **Challenge:**'));
  for (const topic of [/gear/, /Pulse row/]) {
    const hit = all.filter((l) => topic.test(l));
    assert.ok(hit.length >= 1, String(topic));
    for (const l of hit) assert.match(l, /(Changed|Rejected):/);
  }
});

test('the owner\'s PNGs exist at their widths', () => {
  const names = ['menu-light-1280', 'menu-dark-1280', 'menu-light-360', 'menu-dark-360', 'menu-off-light-1280', 'tip-light-1280', 'locked-light-1280', 'icons-light-1280', 'icons-dark-1280'];
  for (const n of names) {
    const b = readFileSync(new URL(`../plans/rail/mocks/stillhet-switch-${n}.png`, import.meta.url));
    assert.deepEqual([...b.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], n);
    assert.equal(b.readUInt32BE(16), n.endsWith('-360') ? 500 : 1280, n);
  }
});
