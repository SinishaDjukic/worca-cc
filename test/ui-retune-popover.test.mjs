// test/ui-retune-popover.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createRetunePopover } from '../ui/public/graph/retune-popover.mjs';

const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-gone', label: 'Hidden', efforts: ['high'], hidden: true },
];
const AGENT = { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', model: '', effort: '' };
/** A run state for syncNode: it asks retuneArm, which needs the run-level answer
 *  (has anything left to dispatch?) as well as the per-node one. */
const RUN = (over = {}) => ({ status: 'running', steps: [], ...over });
const BUSY = RUN({ steps: [{ nodeId: 'n_impl', status: 'start' }] });

/** A hand-driven animation clock. jsdom without `pretendToBeVisual` defines no
 *  requestAnimationFrame, so the popover's follow loop would never run — and never
 *  be covered — unless one is injected. */
function clock() {
  const q = new Map();
  let id = 0;
  return {
    raf: (fn) => { q.set(++id, fn); return id; },
    caf: (i) => { q.delete(i); },
    tick() { const due = [...q.entries()]; q.clear(); for (const [, fn] of due) fn(); },
    pending: () => q.size,
  };
}

function make({ fetchHandler, clk = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div class="node" data-node-id="n_impl" tabindex="0">card</div></body></html>',
    { url: 'http://localhost:4317/' });
  const { window } = dom;
  const calls = [];
  const pop = createRetunePopover({
    doc: window.document,
    raf: clk ? clk.raf : null,
    caf: clk ? clk.caf : null,
    onClose: () => calls.push({ closed: true }),
    fetchFn: (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse((opts && opts.body) || '{}') });
      return Promise.resolve(fetchHandler ? fetchHandler() : { ok: true, status: 200, json: async () => ({ ok: true, nodeId: 'n_impl', model: 'claude-opus-5', effort: 'high' }) });
    },
    onApplied: (d) => calls.push({ applied: d }),
  });
  return { window, doc: window.document, card: window.document.querySelector('.node'), pop, calls };
}
const sel = (doc, field) => doc.querySelector(`.rt-pop [data-field="${field}"]`);
const values = (s) => [...s.options].map((o) => o.value);

test('the pair offers inherit + every model, and effort is filtered to the picked model', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  const e = sel(doc, 'effort');
  assert.deepEqual(values(m), ['', 'claude-opus-5', 'claude-haiku-4-5'], 'a hidden built-in is dropped unless it is the pick');
  assert.equal(m.value, '', "no stored model -> 'inherit'");
  assert.equal(e.disabled, true, 'no model, no effort list to offer');

  m.value = 'claude-haiku-4-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(values(sel(doc, 'effort')), ['', 'medium', 'high'], "Haiku's own efforts, not the global four");
  assert.equal(sel(doc, 'effort').disabled, false);
});

test("a hidden built-in stays visible when it IS the node's stored pick", () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-gone', effort: 'high' }, models: MODELS });
  assert.ok(values(sel(doc, 'model')).includes('claude-gone'));
  assert.equal(sel(doc, 'model').value, 'claude-gone');
  assert.equal(sel(doc, 'effort').value, 'high');
});

test("the stored hidden pick stays offered after the user moves off it, so it can be re-picked", () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-gone', effort: 'high' }, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-opus-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  // The repaint filters on the node's STORED pick, not on the live value: a user
  // who tries another model and changes their mind can still go back without
  // reopening the popover.
  assert.ok(values(sel(doc, 'model')).includes('claude-gone'),
    'moving off a hidden stored pick must not delete it from the list');
  assert.equal(sel(doc, 'model').value, 'claude-opus-5', 'and the new pick is kept selected');
});

test('Apply POSTs /api/retune with the selection and closes on 200', async () => {
  const { doc, card, pop, calls } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  sel(doc, 'model').value = 'claude-opus-5';
  sel(doc, 'model').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  sel(doc, 'effort').value = 'high';
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls[0].url, '/api/retune');
  assert.deepEqual(calls[0].body, { runId: 'r1', nodeId: 'n_impl', model: 'claude-opus-5', effort: 'high' });
  assert.ok(calls.some((c) => c.applied), 'onApplied fired');
  assert.equal(pop.isOpen(), false);
});

test('clearing both fields posts empty strings (answer: clear-to-inherit)', async () => {
  const { doc, card, pop, calls } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5', effort: 'high' }, models: MODELS });
  sel(doc, 'model').value = '';
  sel(doc, 'model').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls[0].body, { runId: 'r1', nodeId: 'n_impl', model: '', effort: '' });
});

test('a 400 shows the server message inline, re-enables Apply and stays open', async () => {
  const { doc, card, pop } = make({
    fetchHandler: () => ({ ok: false, status: 400, json: async () => ({ error: 'node "n_impl" has an execution in flight' }) }),
  });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const err = doc.querySelector('.rt-err');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /execution in flight/);
  assert.equal(doc.querySelector('.rt-apply').disabled, false);
  assert.equal(pop.isOpen(), true);
});

test('a busy node and a flow card explain themselves instead of offering selects', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS, busy: true });
  assert.equal(sel(doc, 'model'), null);
  assert.match(doc.querySelector('.rt-note').textContent, /execution in flight/);
  pop.close();
  pop.open(card, { runId: 'r1', node: { id: 'n_end', kind: 'end', label: 'End' }, models: MODELS });
  assert.equal(sel(doc, 'model'), null);
  assert.match(doc.querySelector('.rt-note').textContent, /Flow cards spawn nothing/);
});

test('Escape, an outside pointerdown and a re-click all close it; listeners are removed', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(pop.isOpen(), false);

  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.body.dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(pop.isOpen(), false);

  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });   // same anchor toggles
  assert.equal(pop.isOpen(), false);
  assert.equal(doc.querySelectorAll('.rt-pop').length, 0, 'no orphan panel is left on body');
});

test('a model id missing from the catalog is listed, not silently shown as inherit', () => {
  const { doc, card, pop } = make();
  // A custom/plugin model deleted mid-run, or the boot race where /api/config has
  // not resolved yet and `models` is still empty. Assigning an id with no matching
  // <option> forces select.value to '' — the popover would present the node as
  // "inherit" and Apply would post '' and WIPE the live override.
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'model-that-left', effort: 'high' }, models: MODELS });
  const m = sel(doc, 'model');
  assert.ok(values(m).includes('model-that-left'), 'the stored id is listed');
  assert.equal(m.value, 'model-that-left', 'and stays selected, so Apply cannot clear it by accident');
  assert.match([...m.options].find((o) => o.value === 'model-that-left').textContent, /not in this catalog/);
  // Its effort levels are unknown, not empty: the stored value round-trips too.
  assert.equal(sel(doc, 'effort').value, 'high');
  assert.equal(sel(doc, 'effort').disabled, false);
});

test('an empty catalog keeps the stored pick instead of reading as inherit', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5', effort: 'high' }, models: [] });
  assert.equal(sel(doc, 'model').value, 'claude-opus-5');
});

test('a response that lands after the popover moved on is ignored', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { doc, card, pop } = make({ fetchHandler: () => gate });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  // The user gives up on it and presses Escape while the POST is still in flight.
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(pop.isOpen(), false);
  // ...then opens the SAME card again and starts editing.
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const reopened = doc.querySelector('.rt-pop');

  release({ ok: false, status: 400, json: async () => ({ error: 'stale' }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pop.isOpen(), true, 'the stale 400 must not tear down the new popover');
  assert.equal(doc.querySelector('.rt-pop'), reopened, 'and it is still the SAME panel');
  assert.equal(doc.querySelector('.rt-err').hidden, true, "the dismissed panel's error is not shown on this one");
});

test('a 200 that lands after the popover was dismissed still reports, but closes nothing new', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { doc, card, pop, calls } = make({ fetchHandler: () => gate });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });

  release({ ok: true, status: 200, json: async () => ({ ok: true, nodeId: 'n_impl', model: 'claude-opus-5', effort: '' }) });
  await new Promise((r) => setTimeout(r, 0));
  // The run WAS retuned, so the caller hears about it either way...
  assert.ok(calls.some((c) => c.applied), 'onApplied still fires — the server did the work');
  // ...but the panel the user is editing now is not torn down under them.
  assert.equal(pop.isOpen(), true);
});

test('refresh() swaps a catalog that arrived after the popover opened', () => {
  const { doc, card, pop } = make();
  // The boot race: the graph painted, the user clicked, and /api/config had not
  // resolved — so the panel holds an EMPTY catalog and offers nothing but the
  // stored id. Without a refresh the user is stuck with a dead dropdown and no
  // signal that closing and reopening would help.
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5', effort: 'high' }, models: [] });
  assert.deepEqual(values(sel(doc, 'model')), ['', 'claude-opus-5']);

  pop.refresh(MODELS);
  assert.deepEqual(values(sel(doc, 'model')), ['', 'claude-opus-5', 'claude-haiku-4-5']);
  assert.equal(sel(doc, 'model').value, 'claude-opus-5', 'the stored pick survives the swap');
  assert.deepEqual(values(sel(doc, 'effort')), ['', 'medium', 'high', 'xhigh', 'max'],
    "and the effort list is now the model's own");
  assert.equal(sel(doc, 'effort').value, 'high');
});

test('refresh() keeps a selection the user was in the middle of making', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-haiku-4-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  pop.refresh([...MODELS, { id: 'new-one', label: 'New One', efforts: ['high'] }]);
  assert.equal(sel(doc, 'model').value, 'claude-haiku-4-5', 'the live pick, not the stored one');
  assert.ok(values(sel(doc, 'model')).includes('new-one'));
});

test('refresh() is a no-op with nothing open and on the note-only arms', () => {
  const { doc, card, pop } = make();
  pop.refresh(MODELS);                       // nothing open
  assert.equal(pop.isOpen(), false);
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS, busy: true });
  pop.refresh(MODELS);                       // a busy node has no pair to repaint
  assert.equal(sel(doc, 'model'), null);
  assert.equal(pop.isOpen(), true);
});

test('anchorEl() names the card the popover is anchored to, so a teardown can scope itself', () => {
  const { doc, card, pop } = make();
  assert.equal(pop.anchorEl(), null, 'nothing open, nothing anchored');
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  assert.equal(pop.anchorEl(), card);
  // destroyGraphMounts closes only when the anchor is under the root it is
  // tearing down — closing the History host must not discard an edit in progress
  // on the live detail behind it.
  assert.equal(doc.body.contains(pop.anchorEl()), true);
  pop.close();
  assert.equal(pop.anchorEl(), null);
});

test('the panel follows its card: a card that moves drags the panel with it', () => {
  const clk = clock();
  const { doc, card, pop } = make({ clk });
  // The card moves for four reasons the panel cannot see: the detail body scrolls,
  // the window resizes, and the monitor host wheel-pans and zooms `.gv-world` —
  // the last two being a CSS transform, which fires no event at all.
  let box = { left: 100, top: 40, bottom: 80, width: 220 };
  card.getBoundingClientRect = () => box;
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const panel = doc.querySelector('.rt-pop');
  assert.equal(panel.style.left, '100px');

  box = { left: 300, top: 140, bottom: 180, width: 220 };
  clk.tick();
  assert.equal(panel.style.left, '300px', 'the panel tracked the card');
  assert.equal(panel.style.top, '188px', 'card bottom + the 8px gap');
});

test('the follow loop closes the panel when its card leaves the document', () => {
  const clk = clock();
  const { doc, card, pop } = make({ clk });
  card.getBoundingClientRect = () => ({ left: 10, top: 10, bottom: 40, width: 220 });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  assert.equal(pop.isOpen(), true);
  // A structural repaint replaces the cards outright; a panel anchored to a
  // detached one has nothing left to point at.
  card.remove();
  clk.tick();
  assert.equal(pop.isOpen(), false);
  assert.equal(doc.querySelector('.rt-pop'), null);
});

test('the follow loop stops when the panel closes', () => {
  const clk = clock();
  const { card, pop } = make({ clk });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  assert.equal(clk.pending(), 1, 'armed while open');
  pop.close();
  assert.equal(clk.pending(), 0, 'and cancelled on close — no loop outlives the panel');
});

test('onClose fires on every close, so the app can drop its run reference', () => {
  const { card, pop, calls } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  pop.close();
  assert.equal(calls.filter((c) => c.closed).length, 1);
  pop.close();
  assert.equal(calls.filter((c) => c.closed).length, 1, 'closing nothing notifies nothing');
});

test('syncNode adopts a retune that landed elsewhere while the panel sat untouched', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  assert.equal(sel(doc, 'model').value, '', 'opened on inherit');
  // A `/retune n_impl claude-opus-5 high` from chat, or from a second tab. It
  // arrives as an ordinary state frame: the card's pill repaints, but no node id
  // moves, so this panel and its anchor card survive untouched.
  pop.syncNode({ ...AGENT, model: 'claude-opus-5', effort: 'high' }, RUN());
  assert.equal(sel(doc, 'model').value, 'claude-opus-5', 'the fresher value wins on an untouched panel');
  assert.equal(sel(doc, 'effort').value, 'high');
  assert.equal(doc.querySelector('.rt-stale').hidden, true, 'nothing to warn about');
});

test('syncNode keeps an edit in progress but says what Apply will overwrite', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-haiku-4-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));

  pop.syncNode({ ...AGENT, model: 'claude-opus-5', effort: 'high' }, RUN());
  assert.equal(sel(doc, 'model').value, 'claude-haiku-4-5', "the user's edit is theirs to keep");
  const stale = doc.querySelector('.rt-stale');
  assert.equal(stale.hidden, false);
  assert.match(stale.textContent, /Changed elsewhere to claude-opus-5 · high/);
  assert.match(stale.textContent, /Apply will overwrite/);
});

test('syncNode ignores another node, and a cell that did not actually move', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5' }, models: MODELS });
  pop.syncNode({ ...AGENT, id: 'n_other', model: 'claude-haiku-4-5' }, RUN());
  assert.equal(sel(doc, 'model').value, 'claude-opus-5');
  pop.syncNode({ ...AGENT, model: 'claude-opus-5' }, RUN());
  assert.equal(doc.querySelector('.rt-stale').hidden, true);
});

test('an unresolvable model does not claim that no model is picked', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'model-that-left', effort: 'high' }, models: [] });
  const e = sel(doc, 'effort');
  // The model select plainly HAS a pick; an effort placeholder reading "pick a
  // model first" next to it makes the control contradict itself.
  assert.match(e.options[0].textContent, /levels unknown/);
  assert.doesNotMatch(e.options[0].textContent, /pick a model first/);
  assert.equal(e.disabled, false);
});

test('a pick that leaves the OFFERED list is kept, not wiped', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-opus-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  // "Hide built-in models" is flipped in Settings while this panel sits open. The
  // id is still in the CATALOG, so a catalog-membership test would skip the
  // fallback option — but offeredModels drops it from the LIST, and assigning an
  // unlisted value coerces the select to '' and Apply would post the wipe.
  pop.refresh([{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['high'], hidden: true }]);
  assert.equal(sel(doc, 'model').value, 'claude-opus-5', 'still selected');
  assert.match([...sel(doc, 'model').options].find((o) => o.value === 'claude-opus-5').textContent, /hidden/);
});

test("a node that settles turns its busy note into the editable pair", () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS, busy: true });
  assert.equal(sel(doc, 'model'), null, 'a note, not a pair');
  assert.match(doc.querySelector('.rt-note').textContent, /execution in flight/);
  // Seconds later the execution finishes. Leaving a dead note up until the user
  // closes and reopens is the opposite of explaining the refusal.
  pop.syncNode(AGENT, RUN());
  assert.ok(sel(doc, 'model'), 'the pair replaced the note');
  assert.ok(doc.querySelector('.rt-apply'));
});

test('a node going busy does NOT tear an edit in progress out from under the user', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-opus-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  pop.syncNode(AGENT, BUSY);
  // Apply will come back with the engine's own "execution in flight", which the
  // panel renders inline — better than silently discarding what they typed.
  assert.equal(sel(doc, 'model').value, 'claude-opus-5');
});

test('the "changed elsewhere" banner goes away when there is nothing left to overwrite', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-opus-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));

  pop.syncNode({ ...AGENT, model: 'claude-haiku-4-5' }, RUN());
  assert.equal(doc.querySelector('.rt-stale').hidden, false, 'it differs from the edit');
  // The node then moves to exactly what the panel is showing. An amber
  // "Apply will overwrite it" still on screen would be a lie.
  pop.syncNode({ ...AGENT, model: 'claude-opus-5' }, RUN());
  assert.equal(doc.querySelector('.rt-stale').hidden, true);
});

test("the hidden-model exemption follows the node's CURRENT value, not the open-time one", () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });   // opens on inherit
  // Chat retunes it to a HIDDEN built-in; the untouched panel adopts it.
  pop.syncNode({ ...AGENT, model: 'claude-gone', effort: 'high' }, RUN());
  assert.equal(sel(doc, 'model').value, 'claude-gone');
  // The user tries something else and changes their mind. keepId must be the
  // node's current value, or the hidden model vanishes from the list and they
  // cannot go back without reopening.
  const m = sel(doc, 'model');
  m.value = 'claude-opus-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.ok(values(sel(doc, 'model')).includes('claude-gone'));
});

test('an effort a RESOLVABLE model no longer offers is kept, not wiped', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5', effort: 'max' }, models: MODELS });
  assert.equal(sel(doc, 'effort').value, 'max');
  // The model is edited in Settings and `max` is dropped from its subset. The model
  // still RESOLVES, so an unresolved-only guard would skip the fallback option, the
  // select would coerce to '' — reading "default effort" for a node that is on max —
  // and Apply would post the clear without the user touching anything.
  pop.refresh([{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high'] }]);
  const e = sel(doc, 'effort');
  assert.equal(e.value, 'max', 'still selected, so Apply cannot clear it by accident');
  assert.match([...e.options].find((o) => o.value === 'max').textContent, /no longer offered/);
});

test('the inline error and the stale warning are live regions', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  // Both appear WITHOUT the user acting, and the amber one is the only signal that
  // Apply is about to clobber someone else's retune.
  assert.equal(doc.querySelector('.rt-err').getAttribute('role'), 'alert');
  assert.equal(doc.querySelector('.rt-stale').getAttribute('role'), 'status');
});

test('an ordinary state frame on an EDITED panel raises no false warning', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-haiku-4-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  // A live run delivers state frames constantly. Comparing the cell against the
  // LIVE select values raised the amber warning on every one of them the moment
  // anyone touched a dropdown — which made the one signal that Apply will clobber
  // a concurrent retune worthless. The question is whether the CELL moved.
  for (let i = 0; i < 3; i++) pop.syncNode(AGENT, RUN());
  assert.equal(doc.querySelector('.rt-stale').hidden, true);
  assert.equal(sel(doc, 'model').value, 'claude-haiku-4-5', 'and the edit is untouched');
});

test('a run that FINISHES under an open panel replaces it with a note', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  assert.ok(sel(doc, 'model'), 'editable while the run is live');
  // Nothing will dispatch again, so an editable panel with a live Apply over it
  // just earns a 400 from the engine.
  pop.syncNode(AGENT, RUN({ status: 'done' }));
  assert.equal(sel(doc, 'model'), null);
  assert.equal(doc.querySelector('.rt-apply'), null);
  assert.match(doc.querySelector('.rt-note').textContent, /nothing will dispatch again/);
});

test('a failed catalog fetch is not memoised as the wrong project\'s answer', async () => {
  // Exercised through modelsForProject in app.js, but the rule it protects lives
  // here: refresh() is what a late catalog reaches, and being handed project A's
  // models for a project B run offers ids the engine answers 400 to.
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'b-only' }, models: [] });
  assert.equal(sel(doc, 'model').value, 'b-only', 'the stored id holds while nothing is known');
  pop.refresh([{ id: 'b-only', label: 'B Only', efforts: ['high'] }]);
  assert.deepEqual(values(sel(doc, 'model')), ['', 'b-only']);
});

test('an effort with NO model stays clearable instead of trapping the panel', () => {
  const { doc, card, pop } = make();
  // buildGraphManifest fills `effort` and `model` independently, so this is a real
  // cell state. The engine refuses the pair — greying the control out while its
  // stored value sits selected left an Apply that always 400s and no way to reach
  // '' and clear it.
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: '', effort: 'high' }, models: MODELS });
  const e = sel(doc, 'effort');
  assert.equal(e.value, 'high');
  assert.equal(e.disabled, false, 'clearable');
  assert.match(e.title, /clear the effort/);
  // With nothing to clear, it goes back to being inert.
  pop.close();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  assert.equal(sel(doc, 'effort').disabled, true);
  assert.match(sel(doc, 'effort').title, /Pick a model first/);
});

test('an arm swap under an in-flight Apply does not write onto detached nodes', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { doc, card, pop } = make({ fetchHandler: () => gate });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  // The run ENDS while the request is in flight; renderBody removes the whole body
  // — err, stale and the Apply button with it. (A node merely going busy is the one
  // transition deliberately exempt from re-rendering: an edit in progress is worth
  // more than the note.)
  pop.syncNode(AGENT, RUN({ status: 'done' }));
  assert.equal(doc.querySelector('.rt-apply'), null);

  release({ ok: false, status: 400, json: async () => ({ error: 'stale' }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pop.isOpen(), true, 'the run-is-over note is still up');
  assert.equal(doc.querySelector('.rt-err'), null, 'and nothing was written onto a removed node');
  assert.match(doc.querySelector('.rt-note').textContent, /nothing will dispatch again/);
});

test('a 200 the server could not SAVE keeps the panel up and says so', async () => {
  const { doc, card, pop, calls } = make({
    fetchHandler: () => ({ ok: true, status: 200,
      json: async () => ({ ok: true, nodeId: 'n_impl', model: 'claude-opus-5', effort: '', persisted: false }) }),
  });
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  doc.querySelector('.rt-apply').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  // The change IS live in the server process, so the caller still hears about it —
  // but it reverts on resume, and closing on that would be a success the user
  // cannot rely on.
  assert.ok(calls.some((c) => c.applied));
  assert.equal(pop.isOpen(), true);
  assert.match(doc.querySelector('.rt-err').textContent, /could not be saved/);
  assert.equal(doc.querySelector('.rt-apply').disabled, false);
});

test('a null in the catalog does not take the whole panel down', () => {
  const { doc, card, pop } = make();
  // A malformed /api/config payload, or a fetch that half-parsed. offeredModels
  // filters nulls out of its OWN output, not out of the array the finds walk.
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5' }, models: [null, ...MODELS, undefined] });
  assert.ok(sel(doc, 'model'), 'the body rendered');
  assert.equal(sel(doc, 'model').value, 'claude-opus-5');
});

test('a RETUNED cell is marked, so a frozen run does not claim one model for two', () => {
  const { doc, card, pop } = make();
  // patchManifestNodeTune stamps `retuned` on the cell it patches. It is the only
  // durable record that the run did not start on this model — steps[].modelUsed is
  // the CLI's wire id, which differs from worca's catalog handle by construction
  // for endpoint-routed and 1M entries, so the two cannot be compared.
  pop.open(card, { runId: 'r1', node: { ...AGENT, model: 'claude-opus-5', retuned: true }, models: MODELS });
  assert.equal(sel(doc, 'model').value, 'claude-opus-5', 'the panel is unaffected by the marker');
});

test('editing to match a concurrent change clears the warning', () => {
  const { doc, card, pop } = make();
  pop.open(card, { runId: 'r1', node: AGENT, models: MODELS });
  const m = sel(doc, 'model');
  m.value = 'claude-haiku-4-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  pop.syncNode({ ...AGENT, model: 'claude-opus-5' }, RUN());
  assert.equal(doc.querySelector('.rt-stale').hidden, false, 'Apply would overwrite it');

  // The user reads the warning and picks the value it named. Re-evaluating only
  // when the CELL moves left an amber "Apply will overwrite it" over a selection
  // that would overwrite nothing.
  m.value = 'claude-opus-5';
  m.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('.rt-stale').hidden, true);
  // And it stays settled across the state frames that keep arriving.
  pop.syncNode({ ...AGENT, model: 'claude-opus-5' }, RUN());
  assert.equal(doc.querySelector('.rt-stale').hidden, true);
});

test('the ask sheet does not close when the retune popover is clicked', () => {
  const src = readFileSync(fileURLToPath(new URL('../ui/public/ask-panel.mjs', import.meta.url)), 'utf8');
  assert.match(src, /\.mention-popup[^)]*\.rt-pop/, '.rt-pop joined the outside-pointerdown allowlist');
});
