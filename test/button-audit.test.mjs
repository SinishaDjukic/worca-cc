// test/button-audit.test.mjs — the one-button-style audit (tools/button-audit.mjs) on hand-built DOM; the CDP proofs
// run the same function over every real view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { auditButtons, auditSizes, auditStray, auditSurface, auditType, BUTTON_SPEC, SIZE_SPEC, STRAY_SPEC, SURFACE_SPEC, TYPE_SPEC } from '../tools/button-audit.mjs';

const OK = { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', borderBottomRightRadius: '6px', borderBottomLeftRadius: '6px',
  backgroundImage: 'none', boxShadow: 'none' };
function run(html, styles = {}, { height = 32, coarse = false } = {}) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  const env = {
    coarse,
    rect: (el) => ({ width: el.hasAttribute('data-hidden') ? 0 : 80, height: Number(el.dataset.h || height) }),
    style: (el) => ({ ...OK, fontSize: el.classList.contains('btn-sm') ? '12px' : '13px',
      fontWeight: el.classList.contains('btn-primary') ? '600' : '500', ...(styles[el.id] || {}) }),
  };
  return auditButtons(doc.body, BUTTON_SPEC, env);
}

test('the 3 sizes x 4 variants pass', () => {
  assert.deepEqual(run(`<button class="btn">a</button><button class="btn btn-sm btn-quiet" data-h="28">b</button>
    <button class="btn btn-lg btn-primary" data-h="40">c</button><button class="btn btn-danger">d</button>`), []);
});

test('the Start run split button counts as one primary beside a secondary (D11)', () => {
  assert.deepEqual(run(`<div><div class="btn-split"><button class="btn btn-lg btn-primary" data-h="40">Start run</button>
    <button class="btn btn-lg btn-primary btn-icon btn-split-more" data-h="40" aria-label="More ways to start"></button></div>
    <button class="btn btn-lg" data-h="40">Save</button></div>`), []);
});

test('a button that is not .btn fails as not-the-component (known bug 4)', () => {
  assert.deepEqual(run('<button class="btn-go">Go</button>').map((v) => v.rule), ['not-the-component']);
});

test('a wrong height, a pill corner, a gradient and a resting shadow each fail', () => {
  const rules = run('<button id="p" class="btn" data-h="38">x</button>', {
    p: { borderTopLeftRadius: '999px', backgroundImage: 'linear-gradient(red, blue)', boxShadow: '0 6px 28px #000' } }).map((v) => v.rule);
  assert.deepEqual(rules, ['height', 'corner', 'gradient', 'shadow-at-rest']);
});

test('two size or two variant classes fail', () => {
  assert.deepEqual(run('<button class="btn btn-sm btn-lg btn-primary btn-quiet" data-h="28">x</button>').map((v) => v.rule).slice(0, 2), ['two-sizes', 'two-variants']);
});

test('two primaries in one group of actions fail once', () => {
  assert.deepEqual(run('<div><button class="btn btn-primary">a</button><button class="btn btn-primary">b</button></div>').map((v) => v.rule), ['two-primaries']);
});

test('controls (tabs, nav rows, chips, role=button rows) and hidden buttons are skipped', () => {
  assert.deepEqual(run(`<nav class="nav"><button>Runs</button></nav><button role="tab">Logs</button>
    <button class="filter-chip">All</button><div role="button" class="run-row">Row</div><button class="btn-go" data-hidden>x</button>`), []);
});

test('under a coarse pointer every button must be at least 40px', () => {
  assert.deepEqual(run('<button class="btn">a</button>', {}, { coarse: true }).map((v) => v.rule), ['height']);
  assert.deepEqual(run('<button class="btn">a</button>', {}, { coarse: true, height: 40 }), []);
});

test('auditButtons and auditSurface are self-contained: their source runs after a round-trip through Function', () => {
  const fn = new Function(`return (${auditButtons})`)();
  const doc = new JSDOM('<body><button>x</button></body>').window.document;
  assert.equal(fn(doc.body, JSON.parse(JSON.stringify(BUTTON_SPEC)), { rect: () => ({ width: 1, height: 1 }), style: () => ({}) })[0].rule, 'not-the-component');
  const surf = new Function(`return (${auditSurface})`)();
  const d2 = new JSDOM('<body><button class="tab">x</button></body>').window.document;
  assert.equal(surf(d2.body, JSON.parse(JSON.stringify(SURFACE_SPEC)), { rect: () => ({ width: 1, height: 36 }), style: () => ({}) })[0].rule, 'control-height');
});

test('corners are the 6px control token (decided 2026-10-19)', () => {
  assert.deepEqual(BUTTON_SPEC.corners, ['6px', '0px']);
});

test('a .tab button is a control, not a stray button (D4)', () => {
  assert.deepEqual(run('<div class="tabs"><button class="tab on">General</button></div>'), []);
});

test('long-label: more than 3 words of visible text fail; "Approve with N open issue(s)" and long aria-labels pass (A14)', () => {
  assert.deepEqual(run('<button class="btn">Continue with what you have</button>').map((v) => [v.rule, v.got]),
    [['long-label', 'Continue with what you have']]);
  assert.deepEqual(run('<button class="btn">Approve with 1 open issue</button><button class="btn">Approve with 3 open issues</button>'), []);
  assert.deepEqual(run('<button class="btn btn-icon" aria-label="Open the run in a new window right now"></button>'), []);
});

/** auditSurface on hand-built DOM: `rects` / `styles` by id; everything else is a visible 80x32 static box. */
function surface(html, { styles = {}, heights = {}, sizes = {} } = {}) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  const env = {
    rect: (el) => ({ width: 80, height: heights[el.id] ?? 32 }),
    size: (el) => sizes[el.id] || { scroll: 0, client: 0 },
    style: (el) => ({ position: 'static', boxShadow: 'none', backgroundColor: 'rgba(0, 0, 0, 0)',
      borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
      borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none', ...(styles[el.id] || {}) }),
  };
  return auditSurface(doc.body, SURFACE_SPEC, env).map((v) => v.rule);
}
const BORDER = { borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
  borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid' };

test('auditSurface: each rule returns for its failing fixture (review A–C)', () => {
  assert.deepEqual(surface('<button class="tab" id="t">x</button>', { heights: { t: 36 } }), ['control-height']);
  assert.deepEqual(surface('<button class="chat-home-act" id="a">x</button>', { heights: { a: 78 } }), ['control-height']);
  assert.deepEqual(surface('<button class="info-tip" id="i">i</button>', { heights: { i: 16 } }), ['control-height']);
  assert.deepEqual(surface('<div id="d">x</div>', { styles: { d: { boxShadow: 'rgba(0, 0, 0, 0.1) 0px 6px 28px 0px' } } }), ['shadow-at-rest']);
  assert.deepEqual(surface('<button class="tab" id="t">x</button>', { styles: { t: { backgroundColor: 'rgb(25, 25, 27)' } } }), ['boxed-tab']);
  assert.deepEqual(surface('<div class="ask-card" id="c"><div id="n">x</div></div>', { styles: { c: BORDER, n: BORDER } }), ['nested-border']);
  assert.deepEqual(surface('<div class="run-prog-fill" id="b"></div>', { styles: { b: { backgroundColor: 'rgb(91, 166, 204)' } } }), ['blue-bar']);
  assert.deepEqual(surface('<div class="tabs"><span class="flag-chip">Beta</span></div>'), ['chip-outside-label']);
});

test('auditSurface: a Chat home tile that wears .btn.btn-lg is a 40px control (F-15)', () => {
  assert.deepEqual(surface('<button class="btn btn-lg chat-home-act" id="a">New run</button>', { heights: { a: 40 } }), []);
});

test('auditSurface: the passing fixture returns nothing', () => {
  assert.deepEqual(surface(`<div class="tabs"><button class="tab">General <span class="flag-chip">Beta</span></button></div>
    <button class="chat-home-act" id="a">New run</button><button class="info-tip" id="i">i</button>
    <div id="f">menu</div><section class="card" id="c"><div class="file" id="fz">Choose files</div></section>`, { heights: { a: 56, i: 28 },
    styles: { f: { position: 'fixed', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 6px 28px 0px' }, c: BORDER, fz: BORDER } }), []);
});

// Static markup, without layout: every button in index.html, including the ones inside <template> (cloned at runtime,
// and invisible to querySelectorAll on the document), is the one component or a D10 control.
test('every button in ui/public/index.html is .btn or a control (D20, known bug 4)', () => {
  const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const roots = [];
  const collect = (root) => { roots.push(root); for (const t of root.querySelectorAll('template')) collect(t.content); };
  collect(doc);
  const controls = BUTTON_SPEC.controls.join(',');
  const bad = roots.flatMap((r) => [...r.querySelectorAll('button, input[type="button"], input[type="submit"]')])
    .filter((b) => !b.classList.contains('btn') && !b.closest(controls))
    .map((b) => `${b.id ? `#${b.id}` : b.tagName.toLowerCase()}${[...b.classList].map((c) => `.${c}`).join('')}`);
  assert.deepEqual(bad, []);
});

test('the Chat › Plans row and the release row links are controls, not §1.2 buttons (impl review 2)', () => {
  const doc = new JSDOM(`<ul><li class="chat-home-plan"><button class="chat-home-plan-open">Charts</button></li></ul>
    <div class="release-row"><button class="release-row-edit">Edit</button></div>`).window.document;
  const controls = BUTTON_SPEC.controls.join(',');
  assert.deepEqual([...doc.querySelectorAll('button')].filter((b) => !b.closest(controls)).map((b) => b.className), []);
});

test('B7: the run page\'s "Add tags" is a quiet sm button with a short label — no finding', () => {
  assert.deepEqual(run('<button class="btn btn-sm btn-quiet hd-tags-edit" data-h="28">Add cost tags</button>'), []);
});

test('QA 1: a truncated badge fails the surface audit; a whole one passes', () => {
  assert.deepEqual(surface('<button class="chat-home-act" id="t"><span class="chat-home-act-badge" id="b">Labs</span></button>',
    { heights: { t: 60 }, sizes: { b: { scroll: 81, client: 59 } } }), ['badge-truncated']);
  assert.deepEqual(surface('<button class="chat-home-act" id="t"><span class="chat-home-act-badge" id="b">Labs</span></button>',
    { heights: { t: 60 }, sizes: { b: { scroll: 81, client: 81 } } }), []);
});

test('a label that types "+" fails as typed-plus; the plus icon passes; nothing is excused any more', () => {
  assert.deepEqual(run('<button class="btn">+ Add folder</button>').map((v) => v.rule), ['typed-plus']);
  assert.deepEqual(run('<button class="btn"><span class="ic"></span>Add folder</button>'), []);
  assert.deepEqual(run('<button class="btn">+ Add server</button>').map((v) => v.rule), ['typed-plus']);
  assert.deepEqual(run('<button class="btn">+3</button>'), []);
});

test('auditSizes: a 46px field, a 24px segment and a 21px chip fail; a listed debt field is skipped', () => {
  const doc = new JSDOM(`<body><select id="a"></select><div class="wm-filters"><select class="select" id="b"></select></div>
    <div class="seg"><button id="c">Day</button></div><span class="badge" id="d">Beta</span></body>`).window.document;
  const heights = { a: 46, b: 46, c: 24, d: 21 };
  const env = { rect: (el) => ({ width: 10, height: heights[el.id] ?? 0 }), style: () => ({ borderTopLeftRadius: '6px' }) };
  const got = auditSizes(doc.body, { ...SIZE_SPEC, debt: ['.wm-filters .select'] }, env).map((v) => v.rule);
  assert.deepEqual(got, ['field-height', 'seg-height', 'chip-height']);
  const ok = { a: 32, b: 46, c: 28, d: 18 };
  assert.deepEqual(auditSizes(doc.body, { ...SIZE_SPEC, debt: ['.wm-filters .select'] },
    { ...env, rect: (el) => ({ width: 10, height: ok[el.id] ?? 0 }) }), []);
  // An 18px chip whose label overflows its box fails as chip-truncated.
  const clipped = auditSizes(doc.body, { ...SIZE_SPEC, debt: ['.wm-filters .select'] },
    { ...env, rect: (el) => ({ width: 10, height: ok[el.id] ?? 0 }), over: (el) => el.id === 'd' });
  assert.deepEqual(clipped.map((v) => v.rule), ['chip-truncated']);
});

test('auditType: 12.5px and 13.33px text fail once per signature; steps, em code, a skipped graph and hidden text pass', () => {
  const doc = new JSDOM(`<body><p id="a" class="m">x</p><p id="b" class="m">y</p><button id="c">Go</button>
    <span id="d">ok</span><code id="h">npm test</code><div class="run-flow"><span id="e">node</span></div><span id="g">hid</span></body>`).window.document;
  const size = { a: '12.5px', b: '12.5px', c: '13.3333px', d: '12px', h: '11.96px', e: '9.5px', g: '10px' };
  const env = { style: (el) => ({ fontSize: size[el.id] || '13px' }),
    rect: (el) => (el.id === 'g' ? { width: 0, height: 0 } : { width: 10, height: 10 }) };
  assert.deepEqual(auditType(doc.body, TYPE_SPEC, env).map((v) => [v.sig, v.got]), [['p.m', '12.5px'], ['button', '13.3333px']]);
});

test('auditType: the Chat home hero (--fs-hero, 32px) is a step of the scale (docs/design-system.md › Type)', () => {
  const doc = new JSDOM('<body><h1 class="chat-home-title">What should worca do?</h1></body>').window.document;
  const env = { style: () => ({ fontSize: '32px' }), rect: () => ({ width: 10, height: 10 }) };
  assert.deepEqual(auditType(doc.body, TYPE_SPEC, env), []);
});

test('auditStray: a button outside .btn and outside the shared controls is listed; .btn, chips, tabs and rows are not', () => {
  const { window } = new JSDOM(`<body><div id="v">
    <button class="btn btn-sm">Ok</button><button class="filter-chip" aria-pressed="true">All</button>
    <button class="tab" role="tab">A</button><button class="wfl-folder row-btn">F</button><div role="button" class="row-btn">R</div>
    <button class="linkish">Show all</button><button class="tp-chip-rm">x</button><div role="button" class="odd">r</div></div></body>`);
  const env = { rect: () => ({ width: 10, height: 10 }) };
  const got = auditStray(window.document.getElementById('v'), STRAY_SPEC, env).map((f) => f.sig);
  assert.deepEqual(got, ['button.linkish', 'button.tp-chip-rm', 'div.odd']);
});
test('auditStray is self-contained (it runs in the page as its source)', () => {
  assert.doesNotThrow(() => new Function(`return (${auditStray})`)());
});
test('typed-plus: no label is excused any more (slice 3 emptied plusDebt)', () => {
  assert.deepEqual(BUTTON_SPEC.plusDebt, []);
});
