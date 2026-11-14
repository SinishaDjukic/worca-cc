// test/stillhet-workflows-host-actions.test.mjs — Stillhet's Workflows actions on dev's routes in the live kind (slice 7):
// a draft sends nothing until Save, Save POSTs once, an agent saves through its .md frontmatter, Pin, refusals that keep the
// draft, Delete after the undo window, and no RailWould anywhere.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { workflowsHost, SEC, SEC_MD, WF_LISTS, settle, clone, saidText, closeHosts } from './helpers/stillhet-workflows-host.mjs';

afterEach(closeHosts);
const sent = (calls) => calls.filter((c) => c.method !== 'GET');
const pick = async (d, menu, value) => { d.querySelector(`[data-menu="${menu}"]`).click(); await settle(20); d.querySelector(`[data-menu-pick="${menu}|${value}"]`).click(); await settle(40); };
async function host(o = {}) {
  let would = 0; const phrases = [];
  const h = await workflowsHost({ ...o, beforeScripts: (win) => { o.beforeScripts?.(win); } });
  const real = h.w.RailWould; h.w.RailWould = (p) => { if (/^(ask for a file to import|export |run the )/.test(p)) { would += 1; phrases.push(p); } return real(p); };   // Workflows' own phrases (another place's render-time ones are its slice's)
  return { ...h, would: () => would, phrases };
}

test('a model change keeps a draft and sends nothing; Save POSTs /api/workflows with the row id; discard sends nothing', async () => {
  const first = await host({ hash: '#workflows/workflow:wf_mine' }), { d, calls, would } = first;
  await pick(d, 'wfm-1', 'Haiku 5.5');
  assert.deepEqual(sent(calls), [], 'a draft change sends zero requests');
  assert.ok(d.querySelector('[data-draft-save]'), 'the draft bar');
  d.querySelector('[data-draft-save]').click(); await settle(120);
  const w = sent(calls);
  assert.equal(w.length, 1); assert.equal(w[0].method, 'POST'); assert.equal(w[0].url, '/api/workflows');
  assert.equal(w[0].body.id, 'wf_mine');
  assert.equal(w[0].body.nodes.find((n) => n.id === 'n_plan').config.model, 'claude-haiku-5-5');
  assert.match(saidText(d), /^Saved Mine/);
  const again = await host({ hash: '#workflows/workflow:wf_mine' });
  await pick(again.d, 'wfm-1', 'Haiku 5.5');
  again.d.querySelector('[data-draft-discard]').click(); await settle(60);
  assert.deepEqual(sent(again.calls), [], 'discard sends nothing');
  assert.equal(would() + again.would(), 0, `RailWould is never called: ${[...again.phrases, ...first.phrases]}`);
});

test('discard leaves GET /api/workflows/:id byte-equal: nothing was written', async () => {
  const { d, calls } = await host({ hash: '#workflows/workflow:wf_mine' });
  await pick(d, 'wfl-0', '5');
  d.querySelector('[data-draft-discard]').click(); await settle(60);
  assert.deepEqual(sent(calls), []);
});

test('an agent saves through GET then PUT /api/agents/:key: asks and fan in meta, model only in the .md frontmatter', async () => {
  const { d, calls } = await host({ hash: '#workflows/agent:sec', read: (u) => (u === '/api/agents/sec' ? [200, { meta: clone(SEC), markdown: SEC_MD }] : null) });
  d.querySelector('[data-wf-sw="asks"]').click(); await settle(40);
  await pick(d, 'ag-model', 'Sonnet 5.5');
  assert.deepEqual(sent(calls), []);
  d.querySelector('[data-draft-save]').click(); await settle(120);
  const w = sent(calls);
  assert.equal(w.length, 1); assert.equal(w[0].method, 'PUT'); assert.equal(w[0].url, '/api/agents/sec');
  assert.equal(w[0].body.meta.asksQuestions, true); assert.equal(w[0].body.meta.fanOut, false);
  assert.ok(!('model' in w[0].body.meta) && !('effort' in w[0].body.meta) && !('frontmatter' in w[0].body.meta));
  assert.equal(w[0].body.markdown, SEC_MD.replace('model: claude-opus-5-5', 'model: claude-sonnet-5-5'));
});

test('Pin PUTs /api/chat-home/pins with the pin added', async () => {
  const { d, calls } = await host({ hash: '#workflows/workflow:wf_mine' });
  await pick(d, 'wf-more', 'pin');
  await settle(60);
  assert.deepEqual(sent(calls).map((c) => [c.method, c.url, c.body]), [['PUT', '/api/chat-home/pins', { pins: ['wf_shape', 'wf_mine'] }]]);
});

test('a 422 save answer toasts Could not save … : … and keeps the draft', async () => {
  const { d, calls } = await host({ hash: '#workflows/workflow:wf_mine', write: () => [422, { error: 'invalid graph', errors: [{ code: 'V8', message: 'md → json type mismatch' }] }] });
  await pick(d, 'wfm-1', 'Haiku 5.5');
  d.querySelector('[data-draft-save]').click(); await settle(120);
  assert.equal(sent(calls).length, 1);
  assert.equal(saidText(d).split(' | ')[0], 'Could not save Mine: md → json type mismatch');
  assert.ok(d.querySelector('[data-draft-save]'), 'the draft stays');
});

test('a stale base: the API changed the wires after the draft started; Save sends zero requests and keeps the draft', async () => {
  let changed = false;
  const { w, d, calls } = await host({ hash: '#workflows/workflow:wf_mine', read: (u) => {
    if (u !== '/api/workflows' || !changed) return null;
    const l = clone(WF_LISTS['/api/workflows']); l.workflows.find((x) => x.id === 'wf_mine').wires.at(-1).id = 'w_new'; return [200, l];
  } });
  await pick(d, 'wfm-1', 'Haiku 5.5');
  changed = true; await w.RailWorkflowLive.refresh('workflows'); await settle(60);
  const n = calls.length;
  d.querySelector('[data-draft-save]').click(); await settle(120);
  assert.equal(calls.length, n, 'zero requests');
  assert.match(saidText(d), /^Could not save Mine: it changed since you started/);
  assert.ok(d.querySelector('[data-draft-save]'));
});

test('a client-invalid draft (a removed step on the canvas) sends zero requests, toasts Could not save and stays', async () => {
  const { d, calls } = await host({ hash: '#workflows/edit:wf_mine' });
  // the inspector shows the picked step (Refine, the loop's step): pick Clarify through its node on the (stubbed) canvas
  const canvas = d.querySelector('#wf-canvas-g'); canvas.innerHTML = '<div data-node-id="n_clar"></div>'; canvas.firstChild.click(); await settle(40);
  d.querySelector('[data-ed-remove]').click(); await settle(40);   // Clarify gone: the task's words would go into Plan's answers
  const n = calls.length;
  d.querySelector('[data-draft-save]').click(); await settle(120);
  assert.equal(calls.length, n);
  assert.match(saidText(d), /^Could not save Mine: /);
  assert.ok(d.querySelector('[data-draft-save]'), 'the draft stays');
});

test('Delete waits for undo: no DELETE before the window, Undo sends none, a passed window sends exactly one', async () => {
  const held = [];
  const fake = (win) => { const real = win.setTimeout.bind(win); win.setTimeout = (fn, ms, ...a) => (ms === 5000 ? (held.push(fn), 1e6 + held.length) : real(fn, ms, ...a)); const rc = win.clearTimeout.bind(win); win.clearTimeout = (t) => { if (t > 1e6) held[t - 1e6 - 1] = null; else rc(t); }; };
  const a = await host({ hash: '#workflows/workflow:wf_mine', beforeScripts: fake });
  await pick(a.d, 'wf-more', 'delete');
  a.d.querySelector('[data-confirm="yes"]').click(); await settle(40);
  assert.deepEqual(sent(a.calls), [], 'no DELETE before the window closes');
  a.d.querySelector('body > .rc-toast button').click(); await settle(20);
  for (const f of held.splice(0)) f?.();
  await settle(60);
  assert.deepEqual(sent(a.calls).filter((c) => c.method === 'DELETE'), [], 'Undo sends none');
  const b = await host({ hash: '#workflows/workflow:wf_mine', beforeScripts: fake });
  await pick(b.d, 'wf-more', 'delete');
  b.d.querySelector('[data-confirm="yes"]').click(); await settle(40);
  for (const f of held.splice(0)) f?.();
  await settle(80);
  assert.deepEqual(sent(b.calls).map((c) => [c.method, c.url]), [['DELETE', '/api/workflows/wf_mine']]);
});

test('Undo after the window fired says it is too late and the DELETE still lands once', async () => {
  const held = [];
  const fake = (win) => { const real = win.setTimeout.bind(win); win.setTimeout = (fn, ms, ...a) => (ms === 5000 ? (held.push(fn), 1e6 + held.length) : real(fn, ms, ...a)); win.clearTimeout = () => {}; };
  const { d, calls } = await host({ hash: '#workflows/workflow:wf_mine', beforeScripts: fake });
  await pick(d, 'wf-more', 'delete');
  d.querySelector('[data-confirm="yes"]').click(); await settle(40);
  held[0]();   // the delete's window closes (the toast's own 5 s timer, held[1], stays held so its Undo is still on screen)
  d.querySelector('body > .rc-toast button').click(); await settle(80);
  assert.match(saidText(d), /^Too late to undo: Mine is being deleted/);
  assert.deepEqual(sent(calls).map((c) => [c.method, c.url]), [['DELETE', '/api/workflows/wf_mine']]);
});

test('canvas Import: the input the picker opened on survives the redraw; its change runs the dry run and the import', async () => {
  const clicked = [];
  const { w, d, calls } = await host({ hash: '#workflows/edit:wf_mine', write: (u, b) => (u === '/api/workflows/import-json' ? (b.dryRun ? [200, { scriptNodes: [] }] : [201, { workflow: { id: 'wf_rel', name: 'Release' } }]) : [200, { ok: true }]),
    beforeScripts: (win) => { win.HTMLInputElement.prototype.click = function () { clicked.push(this); }; } });
  await pick(d, 'ed-io', 'import');
  assert.equal(clicked.length, 1, 'the picker opened');
  const input = clicked[0];
  assert.ok(input.isConnected, 'still in the document after the redraw');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'release.json', text: async () => JSON.stringify(clone(WF_LISTS['/api/workflows'].workflows[1])) }] });
  input.dispatchEvent(new w.Event('change', { bubbles: true })); await settle(120);
  assert.deepEqual(sent(calls).map((c) => [c.url, !!c.body.dryRun]), [['/api/workflows/import-json', true], ['/api/workflows/import-json', false]]);
  assert.match(saidText(d), /Imported Release/);
});

test('Delete in the live kind: a refresh in the undo window keeps it gone; Undo brings it back', async () => {
  const held = [];
  const fake = (win) => { const real = win.setTimeout.bind(win); win.setTimeout = (fn, ms, ...a) => (ms === 5000 ? (held.push(fn), 1e6 + held.length) : real(fn, ms, ...a)); win.clearTimeout = () => {}; };
  const { w, d } = await host({ hash: '#workflows/workflow:wf_mine', beforeScripts: fake });
  await pick(d, 'wf-more', 'delete');
  d.querySelector('[data-confirm="yes"]').click(); await settle(40);
  await w.RailWorkflowLive.refresh('workflows'); await settle(40);
  assert.ok(!w.RailWorkflowLive.data().workflow.some((x) => x.id === 'wf_mine'), 'still gone after a refresh');
  d.querySelector('body > .rc-toast button').click(); await settle(40);
  assert.ok(w.RailWorkflowLive.data().workflow.some((x) => x.id === 'wf_mine'), 'back after Undo');
});
