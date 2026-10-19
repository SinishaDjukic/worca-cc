// test/button-audit.test.mjs — the one-button-style audit (tools/button-audit.mjs) on hand-built DOM; the CDP proofs
// run the same function over every real view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { auditButtons, BUTTON_SPEC } from '../tools/button-audit.mjs';

const OK = { borderTopLeftRadius: '4px', borderTopRightRadius: '4px', borderBottomRightRadius: '4px', borderBottomLeftRadius: '4px',
  backgroundImage: 'none', boxShadow: 'none' };
function run(html, styles = {}, { height = 32, coarse = false } = {}) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  const env = {
    coarse,
    rect: (el) => ({ width: el.hasAttribute('data-hidden') ? 0 : 80, height: Number(el.dataset.h || height) }),
    style: (el) => ({ ...OK, fontSize: el.classList.contains('btn-sm') ? '12.5px' : el.classList.contains('btn-lg') ? '14px' : '13px',
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
    <button class="proj-fchip">All</button><div role="button" class="run-row">Row</div><button class="btn-go" data-hidden>x</button>`), []);
});

test('under a coarse pointer every button must be at least 40px', () => {
  assert.deepEqual(run('<button class="btn">a</button>', {}, { coarse: true }).map((v) => v.rule), ['height']);
  assert.deepEqual(run('<button class="btn">a</button>', {}, { coarse: true, height: 40 }), []);
});

test('auditButtons is self-contained: its source runs after a round-trip through Function', () => {
  const fn = new Function(`return (${auditButtons})`)();
  const doc = new JSDOM('<body><button>x</button></body>').window.document;
  assert.equal(fn(doc.body, JSON.parse(JSON.stringify(BUTTON_SPEC)), { rect: () => ({ width: 1, height: 1 }), style: () => ({}) })[0].rule, 'not-the-component');
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
