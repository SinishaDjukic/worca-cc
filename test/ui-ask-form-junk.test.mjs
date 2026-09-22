// test/ui-ask-form-junk.test.mjs — the renderer is TOTAL over what the gates admit.
// Gate 1 admits `"constructor"` as a row key name and `[null]` shapes in places the
// dialect does not pin; gate 2 admits opaque rows. For every such shape the
// renderer must neither throw (a throw inside renderQpanel leaves the panel hidden
// and the run parked with no way to answer) nor leak `undefined`, `[object Object]`
// or `function Object() { [native code] }` into the DOM. The sweep mutates the CDP
// fixture — every layout key, every answer keyword, every data location — and
// exercises every control of every admitted result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { renderAskForm } from '../ui/public/ask/form-renderer.mjs';
import { validateFormDef } from '../src/shared/forms/form-def.mjs';
import { checkAskData, fileRefs } from '../src/shared/forms/answer.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';
import { ASK_FORM_FIXTURE as FIX } from './helpers/ask-form-fixture.mjs';

const vc = new VirtualConsole();
const listenerErrors = [];
vc.on('jsdomError', (e) => listenerErrors.push(String((e && e.detail && e.detail.message) || (e && e.message) || e)));
const win = new JSDOM('<!doctype html><body></body>', { virtualConsole: vc }).window;
const doc = win.document;

// The CDP fixture as the DEF it came from (data schema + example), so gate 1 and
// gate 2 can rule on every mutation exactly as P2 would.
const DEF = {
  version: 1, title: 'Review mockups', surface: 'any',
  data: { type: 'object', properties: {
    summary: { type: 'string' },
    images: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, caption: { type: 'string' }, file: { type: 'file' } } } },
    items: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, title: { type: 'string' }, meta: { type: 'string' } } } },
    doc: { type: 'file' }, patch: { type: 'string' } } },
  layout: FIX.layout, answer: FIX.answerSchema, example: FIX.data,
};

const MIME = { png: 'image/png', pdf: 'application/pdf' };
const clone = (v) => JSON.parse(JSON.stringify(v));
const BAD_TEXT = /undefined|\[object |native code|NaN/;
const JUNK = [null, {}, [null], 'constructor', 7, ''];

function askOf(def, data) {
  const refs = fileRefs(def.data, data);
  const files = refs.map((r, i) => ({ index: i, rel: r.rel, name: String(r.rel).split('/').pop(),
    mime: MIME[String(r.rel).split('.').pop()] || 'text/plain', bytes: 10, sha256: 'x' }));
  return { id: 'q:1', askId: 'q_1', kind: 'form', form: 'f', version: 1, title: def.title, surface: 'any', data,
    layout: def.layout, answerSchema: resolveAnswerSchema(def.answer, data),
    fileRefs: refs.map(({ path, rel }) => ({ path, rel })), files };
}

/** Mount, read, poke every control, collect, dispose. Throws on any leak. */
function exercise(ask) {
  const f = renderAskForm(ask, { doc, fileUrl: (i) => `/f/${i}`, loadText: () => Promise.resolve('a,b\n1,2'),
    markdown: () => ({ kind: 'plain' }), onChange: () => {} });
  const leak = (t) => { const m = t.match(BAD_TEXT); if (m) throw new Error(`leaked "${m[0]}" near "${t.slice(Math.max(0, m.index - 24), m.index + 24)}"`); };
  leak(f.el.textContent);
  f.collect(); f.progress();
  f.setErrors([{ path: 'verdict', code: 'x', message: 'm' }, { path: '', code: 'type' }, null]); f.setErrors([]);
  for (const k of Object.keys(ask.answerSchema.properties || {})) for (const j of JUNK) f.setValue(k, j);
  const before = listenerErrors.length;
  for (const b of f.el.querySelectorAll('button')) b.dispatchEvent(new win.Event('click', { bubbles: true }));
  for (const n of f.el.querySelectorAll('input, textarea, select')) {
    n.dispatchEvent(new win.Event('input', { bubbles: true }));
    n.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  for (const tab of f.el.querySelectorAll('[role="tab"]')) tab.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  // jsdom swallows listener exceptions: read them back from the virtual console.
  if (listenerErrors.length > before) throw new Error(`a listener threw: ${listenerErrors.slice(before).join(' | ')}`);
  leak(f.el.textContent);
  f.snapshot(); f.paintMarkdown(); f.collect(); f.dispose(); f.setValue('verdict', 'x');
}

function* locations(obj, path = []) {
  if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i += 1) { yield [path, i]; yield* locations(obj[i], [...path, i]); } }
  else if (obj && typeof obj === 'object') { for (const k of Object.keys(obj)) { yield [path, k]; yield* locations(obj[k], [...path, k]); } }
}
const at = (root, path) => path.reduce((o, k) => o[k], root);

/** Render only what BOTH gates admit; report every admitted shape that misbehaves.
 *  Yields every 50 mounts: jsdom queues a toggle task per `<details open>` (the json
 *  widget) and a synchronous loop never drains it, so every detached tree would be
 *  retained until the test ends. */
async function sweep(mutations) {
  const bad = [];
  let admitted = 0;
  let n = 0;
  for (const { tag, def, data } of mutations) {
    if (!validateFormDef(def, { id: 'f' }).ok || !checkAskData(def, data).ok) continue;
    admitted += 1;
    try { exercise(askOf(def, data)); } catch (e) { bad.push(`${tag}: ${e.message}`); }
    if ((n += 1) % 50 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { admitted, bad: [...new Set(bad)] };
}

test('the fixture itself renders clean and every control survives a poke', () => {
  assert.ok(validateFormDef(DEF, { id: 'f' }).ok);
  assert.ok(checkAskData(DEF, DEF.example).ok);
  exercise(askOf(DEF, DEF.example));
});

test('every layout key and answer keyword set to junk: admitted shapes never throw or leak', async () => {
  const muts = [];
  for (const side of ['layout', 'answer']) {
    for (const [path, key] of locations(DEF[side])) {
      for (const j of JUNK) {
        const def = clone(DEF); at(def[side], path)[key] = j;
        muts.push({ tag: `${side}.${[...path, key].join('.')}=${JSON.stringify(j)}`, def, data: DEF.example });
      }
    }
  }
  const { admitted, bad } = await sweep(muts);
  assert.ok(admitted >= 20, `gate 1 admitted ${admitted} mutations (the sweep is not vacuous)`);
  assert.deepEqual(bad, []);
});

test('every data location set to junk: admitted data never throws or leaks', async () => {
  const muts = [];
  for (const [path, key] of locations(DEF.example)) {
    for (const j of JUNK) {
      const data = clone(DEF.example); at(data, path)[key] = j;
      muts.push({ tag: `data.${[...path, key].join('.')}=${JSON.stringify(j)}`, def: DEF, data });
    }
  }
  const { admitted, bad } = await sweep(muts);
  assert.ok(admitted >= 5, `gate 2 admitted ${admitted} mutations`);
  assert.deepEqual(bad, []);
});

test('inherited names as field, row key and column key: own values only, no prototype writes', () => {
  // `constructor` is a legal property name for gate 1; `__proto__` is refused there.
  const def = JSON.parse(`{"version":1,"title":"inh","data":{"type":"object","properties":{"constructor":{"type":"string"},
    "rows":{"type":"array","items":{"type":"object","required":["id"],"properties":{"id":{"type":"string"},"constructor":{"type":"string"},"title":{"type":"string"}}}}}},
    "layout":[{"widget":"text","field":"constructor","label":"c"},{"widget":"text","field":"hasOwnProperty","label":"p","when":{"constructor":"go"}},
      {"widget":"markdown","bind":"data.constructor"},{"widget":"rank","field":"order","bind":"data.rows","titleKey":"constructor","metaKey":"title"},
      {"widget":"select","field":"pick","label":"pk","options":{"from":"data.rows","value":"id","label":"constructor"}},
      {"widget":"table","bind":"data.rows","columns":[{"key":"constructor","label":"K"},{"key":"toString","label":"T"}]}],
    "answer":{"type":"object","properties":{"constructor":{"type":"string"},"hasOwnProperty":{"type":"string","default":"x"},
      "order":{"type":"array","items":{"type":"string"}},"pick":{"type":"string"}}},
    "example":{"constructor":"body","rows":[{"id":"a","constructor":"ca"},{"id":"b","title":"tb"}]}}`);
  assert.ok(validateFormDef(def, { id: 'f' }).ok, 'gate 1 admits `constructor` as a name');
  const f = renderAskForm(askOf(def, def.example), { doc });
  assert.doesNotMatch(f.el.textContent, BAD_TEXT);
  assert.equal(f.el.querySelector('.af-rank li b').textContent, 'ca', 'an OWN `constructor` row value is text');
  assert.equal(f.el.querySelectorAll('.af-rank li b')[1].textContent, 'b', 'a row without one falls back to its id');
  assert.deepEqual([...f.el.querySelectorAll('.af-tbl td')].map((td) => td.textContent), ['ca', '—', '—', '—'],
    'a `toString` column reads nothing inherited');
  assert.equal(f.el.querySelector('[data-field="hasOwnProperty"]').hidden, true);
  f.setValue('constructor', 'go');
  f.setValue('hasOwnProperty', 'typed');
  assert.equal(f.el.querySelector('[data-field="hasOwnProperty"]').hidden, false, '`when` reads the OWN value');
  assert.deepEqual(f.snapshot(), { hasOwnProperty: 'typed', order: ['a', 'b'], constructor: 'go' });
  assert.deepEqual(f.collect().errors, []);
  assert.equal(({}).typed, undefined, 'nothing reached Object.prototype');
});
