// test/design-system-stillhet-switch.test.mjs — StillhetSwitch (docs/rail/navigation.md `nav.design-switch`): the one top-bar
// icon with its 2-row menu, its shared open/pick/busy/restore watch, its CSS, and the glyphs it brings (`stillhet-ui`, the
// toothed Settings gear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { stillhetSwitch, watchStillhetSwitch, STILLHET_NAME, STILLHET_TIP, STILLHET_LOCKED, STILLHET_ITEMS, ICONS, icon } from '../ui/public/design-system/components/index.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SLOT = '[data-stillhet="design-switch"]', ICON = '[data-stillhet="ui-icon"]';
const draw = (t, o) => { const w = new JSDOM(`<body>${stillhetSwitch(o)}</body>`).window; t.after(() => w.close()); return w.document; };
const rows = (d) => [...d.querySelectorAll('[role="menuitemradio"]')];
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A page holding the slot and something outside it, with the watch installed. */
function world(t, o = { on: true }, pick = async () => ({ ok: true })) {
  const w = new JSDOM(`<body><p id="away">away</p><header>${stillhetSwitch(o)}</header></body>`, { pretendToBeVisual: true }).window;
  t.after(() => w.close());
  const d = w.document, calls = [];
  const stop = watchStillhetSwitch(d, { pick: (c) => { calls.push(c); return pick(c); } });
  return { w, d, calls, stop, icon: () => d.querySelector(ICON), slot: () => d.querySelector(SLOT), rows: () => rows(d) };
}

test('closed: one icon named "Stillhet UI · beta", a menu button with its tip, and no menu', (t) => {
  const d = draw(t, { on: true });
  const b = d.querySelectorAll(ICON);
  assert.equal(b.length, 1);
  assert.equal(b[0].getAttribute('aria-label'), 'Stillhet UI · beta');
  assert.equal(b[0].getAttribute('aria-haspopup'), 'menu');
  assert.equal(b[0].getAttribute('aria-expanded'), 'false');
  assert.equal(b[0].getAttribute('title'), STILLHET_TIP);
  assert.equal(STILLHET_TIP, "Stillhet, Worca's new calmer UI · beta");
  assert.equal(STILLHET_NAME, 'Stillhet UI · beta');
  assert.ok(b[0].hasAttribute('data-design-switch'));
  assert.equal(b[0].querySelector('svg').getAttribute('width'), '20');
  assert.equal(d.querySelectorAll('.menu').length, 0);
  assert.equal(d.querySelectorAll('[role="switch"], .chip').length, 0, 'no switch, no beta chip');
  const slot = d.querySelector(SLOT);
  assert.equal(slot.dataset.on, 'true');
  assert.equal(slot.dataset.locked, 'false');
  assert.ok(slot.querySelector(':scope > .rc-pop.is-right'));
});

test('open on: exactly 2 rows, "Try Stillhet" checked', (t) => {
  const d = draw(t, { on: true, open: true });
  assert.deepEqual(rows(d).map((r) => r.textContent), ['Try Stillhet', "Back to today's UI"]);
  assert.deepEqual(rows(d).map((r) => r.getAttribute('aria-checked')), ['true', 'false']);
  assert.deepEqual(STILLHET_ITEMS.map((i) => i.id), ['on', 'off']);
  assert.equal(d.querySelector(ICON).getAttribute('aria-expanded'), 'true');
  assert.ok(rows(d).every((r) => !r.hasAttribute('data-menu-pick')), 'a pick does not carry data-menu-pick');
  assert.deepEqual(rows(d).map((r) => r.dataset.designPick), ['on', 'off']);
});

test('open off: the check moves to "Back to today\'s UI"', (t) => {
  const d = draw(t, { on: false, open: true });
  assert.deepEqual(rows(d).map((r) => r.getAttribute('aria-checked')), ['false', 'true']);
  assert.equal(d.querySelector(SLOT).dataset.on, 'false');
});

test('busy: aria-busy and aria-disabled, never disabled, and no menu even when open', (t) => {
  const d = draw(t, { on: true, busy: true, open: true });
  const b = d.querySelector(ICON);
  assert.equal(b.getAttribute('aria-busy'), 'true');
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  assert.equal(b.hasAttribute('disabled'), false);
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(d.querySelectorAll('.menu').length, 0);
  const idle = draw(t, { on: true }).querySelector(ICON);
  assert.equal(idle.hasAttribute('aria-busy') || idle.hasAttribute('aria-disabled'), false);
});

test('locked: the tip and the name say why; both rows disabled with the reason, still 2 rows', (t) => {
  const d = draw(t, { on: true, locked: true, open: true });
  const b = d.querySelector(ICON);
  assert.ok(b.getAttribute('title').endsWith(' · Locked by WORCA_FLAGS'));
  assert.ok(b.getAttribute('aria-label').endsWith(' · Locked by WORCA_FLAGS'));
  assert.equal(STILLHET_LOCKED, 'Locked by WORCA_FLAGS');
  assert.equal(rows(d).length, 2);
  assert.ok(rows(d).every((r) => r.getAttribute('aria-disabled') === 'true' && r.getAttribute('title') === 'Locked by WORCA_FLAGS'));
  assert.equal(d.querySelector(SLOT).dataset.locked, 'true');
});

test('glyphs: the toothed gear is one drawing for gear, nav-settings and set-general, 8 teeth, never the sun', () => {
  assert.equal(ICONS.gear, ICONS['nav-settings']);
  assert.equal(ICONS.gear, ICONS['set-general']);
  assert.notEqual(ICONS.gear, ICONS.sun);
  for (const n of [14, 16, 20]) {
    const g = icon('gear', n);
    assert.equal(g.match(/A7\.4/g).length, 8, `${n}px: 8 teeth`);
    assert.notEqual(g, icon('sun', n));
    assert.match(g, new RegExp(`width="${n}"`));
  }
  assert.match(icon('stillhet-ui'), /^<svg[^>]*>.+<\/svg>$/);
});

test('watch: a click on the icon opens; Esc closes and focuses the icon; an outside click closes', (t) => {
  const { w, d, icon: ic, rows: rs } = world(t);
  ic().click();
  assert.equal(rs().length, 2);
  assert.equal(ic().getAttribute('aria-expanded'), 'true');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(rs().length, 0);
  assert.equal(d.activeElement, ic());
  ic().click();
  assert.equal(rs().length, 2);
  ic().click();
  assert.equal(rs().length, 0, 'a second click closes it');
  ic().click();
  d.getElementById('away').click();
  assert.equal(rs().length, 0);
});

test('watch: picking the other row calls pick once with "off", busy while pending with the focus on the icon, then repaints off', async (t) => {
  let release; const gate = new Promise((r) => { release = r; });
  const { d, calls, icon: ic, rows: rs, slot } = world(t, { on: true }, async () => { await gate; return { ok: true }; });
  ic().focus();
  ic().click();
  rs()[1].click();
  assert.deepEqual(calls, ['off']);
  assert.equal(rs().length, 0);
  assert.equal(ic().getAttribute('aria-busy'), 'true');
  assert.equal(d.activeElement, ic());
  release(); await settle(); await settle();
  assert.equal(slot().dataset.on, 'false');
  assert.equal(ic().hasAttribute('aria-busy'), false);
  assert.equal(ic().getAttribute('aria-expanded'), 'false');
  ic().click();
  assert.deepEqual(rs().map((r) => r.getAttribute('aria-checked')), ['false', 'true']);
});

test('watch: {ok:false} and a thrown error each restore on, drop aria-busy and refocus the icon', async (t) => {
  for (const fail of [async () => ({ ok: false }), async () => { throw new Error('down'); }, async () => undefined]) {
    const { d, icon: ic, rows: rs, slot } = world(t, { on: true }, fail);
    ic().focus();
    ic().click();
    rs()[1].click();
    await settle(); await settle();
    assert.equal(slot().dataset.on, 'true');
    assert.equal(ic().hasAttribute('aria-busy'), false);
    assert.equal(ic().hasAttribute('aria-disabled'), false);
    assert.equal(rs().length, 0);
    assert.equal(d.activeElement, ic());
  }
});

test('watch: a second pick while busy, a pick on the current row and a pick while locked call pick 0 more times', async (t) => {
  let release; const gate = new Promise((r) => { release = r; });
  const a = world(t, { on: true }, async () => { await gate; return { ok: false }; });
  a.icon().click();
  a.rows()[1].click();
  a.icon().click();   // busy: ignored
  assert.equal(a.rows().length, 0);
  assert.deepEqual(a.calls, ['off']);
  release(); await settle(); await settle();
  a.icon().click();
  a.rows()[0].click();   // the current UI: close only
  assert.equal(a.rows().length, 0);
  assert.deepEqual(a.calls, ['off']);
  const b = world(t, { on: true, locked: true });
  b.icon().click();
  assert.equal(b.rows().length, 2);
  b.rows()[1].click();
  assert.equal(b.rows().length, 2, 'a disabled row does nothing; the menu stays open');
  assert.deepEqual(b.calls, []);
});

test('watch: once per document; the disposer stops it; a slot removed mid-pick does not throw', async (t) => {
  const a = world(t);
  assert.equal(watchStillhetSwitch(a.d, { pick: async () => ({ ok: true }) }), a.stop);
  a.icon().click();
  assert.equal(a.rows().length, 2, 'one listener: one click opens, not twice toggled');
  a.icon().click();
  a.stop();
  a.icon().click();
  assert.equal(a.rows().length, 0);
  let release; const gate = new Promise((r) => { release = r; });
  const b = world(t, { on: true }, async () => { await gate; return { ok: false }; });
  b.icon().click();
  b.rows()[1].click();
  b.slot().remove();
  release(); await settle(); await settle();
  assert.equal(b.d.querySelector(SLOT), null);
});

test('watch: a `current` getter, read at click time, decides the current UI over the painted data-on', (t) => {
  let live = true;
  const w = new JSDOM(`<body>${stillhetSwitch({ on: false })}</body>`).window;
  t.after(() => w.close());
  const d = w.document, calls = [];
  watchStillhetSwitch(d, { pick: (c) => { calls.push(c); return { ok: true }; }, current: () => live });
  const ic = () => d.querySelector(ICON);
  ic().click();
  assert.deepEqual(rows(d).map((r) => r.getAttribute('aria-checked')), ['true', 'false'], 'the flag turned on elsewhere: "Try Stillhet" checked');
  rows(d)[0].click();
  assert.deepEqual(calls, [], 'the live current UI: close only');
  live = false;
  ic().click();
  rows(d)[1].click();
  assert.deepEqual(calls, [], 'off again elsewhere: "Back to today\'s UI" is the current one');
  ic().click();
  rows(d)[0].click();
  assert.deepEqual(calls, ['on']);
});

test('css: every selector is scoped to the slot, the icon is a 36px box with a 20px glyph; parts.json loads it', () => {
  const css = read('ui/public/design-system/stillhet-switch.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
  assert.ok(selectors.length >= 3);
  for (const group of selectors) for (const s of group.split(',')) assert.ok(s.trim().startsWith(SLOT), s);
  assert.match(css, /width:36px;height:36px/);
  assert.match(css, /svg\{width:20px;height:20px/);
  // button() draws `.btn.btn-sm.btn-icon`, and dev's style.css (Stillhet's app.css bundles it before this file) sizes
  // `.btn-sm.btn-icon` at 28px with specificity (0,2,0): the box rule must outrank it, or the icon draws 28 wide
  const box = selectors.find((s) => css.includes(`${s}{width:36px`));
  assert.ok(box, 'the 36px box rule');
  const spec = (s) => (s.match(/\[[^\]]+\]|\.[\w-]+|:[\w-]+/g) || []).length;
  assert.ok(spec(box) > spec('.btn-sm.btn-icon'), `${box} outranks .btn-sm.btn-icon`);
  const parts = JSON.parse(read('ui/public/parts.json')).css;
  assert.ok(parts.includes('design-system/stillhet-switch.css'));
  assert.ok(!parts.includes('design-system/design-switch.css'));
});
