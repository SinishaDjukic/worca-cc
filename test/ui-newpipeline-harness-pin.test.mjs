// test/ui-newpipeline-harness-pin.test.mjs — New run's agent row for a step pinned to another harness (spec
// 2026-11-26 "The surfaces"): the REAL app.js against a fetch stub. The row's model is the columns picker's trigger: a
// project pick or the workflow's own pick that names `engine` stays editable and names its harness, a pick in the
// picker saves the model with its harness (inherit clears both), a model the catalog lost shows as such, a disabled
// trigger (Settings › Memory, no project) opens nothing, and a save of another tunable sends a pinned pick back with
// its harness. One boot of the app for the file (test/helpers/shared-app-boot.mjs); each test opens New run on its own
// server (openNew). The server is test/ui-newpipeline-defrag-pin.test.mjs's.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRAPH_MEMORY_DEFRAG_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { defragWorkflowView, resolveDefragModel } from '../src/core/memory-defrag-model.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const PROJECT = '/tmp/proj';
const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];
const DEFRAG_META = JSON.parse(readFileSync(fileURLToPath(new URL('../agents/memoryDefragmenter.meta.json', import.meta.url)), 'utf8'));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 16) => { for (let i = 0; i < n; i++) await tick(); };
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

/** config.mjs's catalog rule for a node write naming a model MODELS does not hold: `unknown model "<id>"`, unless it is
 *  the stored model sent back with its stored effort or none and its stored harness or none (kept unchecked). */
function catalogRefusal(stored, sel) {
  if (!sel.model || MODELS.some((m) => m.id === sel.model)) return null;
  const kept = sel.model === stored.model && (!sel.effort || sel.effort === stored.effort)
    && (sel.engine === undefined || sel.engine === null || sel.engine === '' || sel.engine === stored.engine);
  return kept ? null : `unknown model "${sel.model}"`;
}

/** A tiny server: the stored Settings › Memory pair, the project's run-config (PATCH applied with
 *  the setters' replace semantics for model/effort, and plan 1's absent rule for engine; a write the
 *  catalog rule refuses is a 400 that writes nothing, kept in `refused`), and the
 *  workflow view with `template`'s keys laid into n_defrag's config. */
function makeServer({ stored, pick = null, template = null }) {
  const srv = { stored, writes: [], refused: [], nodes: pick ? { n_defrag: { ...pick } } : {} };
  srv.handle = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (url.includes('/api/workflows/wf_memory_defrag')) {
      const pair = srv.stored ? resolveDefragModel({ stored: srv.stored, models: MODELS }) : null;
      const tpl = JSON.parse(JSON.stringify(GRAPH_MEMORY_DEFRAG_WORKFLOW));
      if (template) for (const n of tpl.nodes) if (n.id === 'n_defrag') n.config = { ...(n.config || {}), ...template };
      return ok(defragWorkflowView(tpl, pair));
    }
    if (url.includes('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_memory_defrag', name: 'Memory defragment' }] });
    if (url.includes('/api/agents')) return ok({ agents: [DEFRAG_META] });
    if (url.includes('/api/scripts')) return ok({ scripts: [] });
    if (url.includes('/api/config')) {
      if (method === 'PATCH' && body && body.nodes) {
        srv.writes.push(body);
        for (const [id, sel] of Object.entries(body.nodes)) {
          const error = catalogRefusal(srv.nodes[id] || {}, sel);
          if (error) { srv.refused.push(error); return Promise.resolve({ ok: false, status: 400, json: async () => ({ error }) }); }
        }
        for (const [id, sel] of Object.entries(body.nodes)) {
          const next = { ...srv.nodes[id] };
          const before = next.model;
          if (typeof sel.engine === 'string' && sel.engine) next.engine = sel.engine;
          else if (sel.engine === '' || sel.engine === null || (sel.engine === undefined && sel.model !== before)) delete next.engine;
          if (sel.model) next.model = sel.model; else delete next.model;         // model/effort are REPLACED
          if (sel.effort) next.effort = sel.effort; else delete next.effort;
          if (typeof sel.fanOut === 'boolean') next.fanOut = sel.fanOut; else if (sel.fanOut === null) delete next.fanOut;
          if (Object.keys(next).length) srv.nodes[id] = next; else delete srv.nodes[id];
        }
      }
      const config = { steps: {}, customModels: [], workflows: { wf_memory_defrag: { nodes: JSON.parse(JSON.stringify(srv.nodes)), feedbacks: {} } } };
      return ok({ config, models: MODELS, efforts: ['medium', 'high', 'xhigh', 'max'], subagentModels: ['sonnet', 'opus', 'auto', 'inherit'] });
    }
    return null;
  };
  return srv;
}

// What app.js asks for as it loads (the project list, the catalog, the agents) is answered by a server with nothing
// stored; after that each test's own server answers first.
const app = useSharedApp({ before, beforeEach, after }, {
  level: 'expert',
  fetchHandler: makeServer({ stored: null }).handle,
  setup: (window) => {
    window.requestAnimationFrame = globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    // app.js's agent-row listeners read HTMLInputElement and HTMLSelectElement by their bare names.
    for (const k of ['HTMLInputElement', 'HTMLSelectElement']) {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    }
  },
});

/** New run on `srv`. The reset leaves the form, and entering it again drops the app's memo of the workflow view (each
 *  server lays its own picks into it); then the project and the workflow are picked. The row starts collapsed: the
 *  open rows are the app's own state and would outlive the reset. */
async function openNew(srv) {
  const { window } = await app.fresh({ fetchHandler: (url, opts) => srv.handle(url, opts) });
  const doc = window.document;
  window.__np.openAgentRows.clear();
  app.go('new');
  await settle();
  const pick = async (sel, value) => { const s = doc.querySelector(sel); s.value = value; s.dispatchEvent(new window.Event('change', { bubbles: true })); await settle(); };
  await pick('#projectSelect', PROJECT);
  await pick('#workflowSelect', 'wf_memory_defrag');
  const row = () => ({
    model: doc.querySelector('.step-model[data-node-id="n_defrag"]'),
    effort: doc.querySelector('.step-effort[data-node-id="n_defrag"]'),
    fan: doc.querySelector('.step-fanout[data-node-id="n_defrag"]'),
    sub: doc.querySelector('.step-subagent[data-node-id="n_defrag"]'),
  });
  return { window, doc, row };
}

const PIN = { model: 'gpt-5.5', effort: 'low', engine: 'codex' };
const opt = (doc, col, key) => [...doc.querySelectorAll(`.mdl-cols-pop [data-col="${col}"] [role="option"]`)].find((b) => b.dataset.key === key);

test('a row pinned to another harness is editable: its trigger names the harness, its efforts are that harness\'s, its Sub-agents hide', async () => {
  const { doc, row } = await openNew(makeServer({ stored: null, pick: PIN }));
  const m = row().model;
  assert.deepEqual([m.tagName, m.classList.contains('mdl-pick'), m.value, m.dataset.engine, m.disabled, row().effort.value, row().effort.disabled],
    ['BUTTON', true, 'gpt-5.5', 'codex', false, 'low', false]);
  assert.ok(m.querySelector('.mdl-mark'), 'the harness mark');
  assert.deepEqual([...row().effort.options].map((o) => o.value), ['', 'minimal', 'low', 'medium', 'high']);
  assert.doesNotMatch(doc.querySelector('#agents-rows .agent-origin').textContent, /Change it/);
  assert.match(doc.querySelector('#agents-rows .agent-sum').textContent, /GPT-5\.5 · low · on OpenAI Codex/);
  assert.equal(row().sub.closest('.select-wrap').hidden, true);
});
test('the workflow\'s own pin is editable, and the origin line names its harness', async () => {
  const { doc, row } = await openNew(makeServer({ stored: null, template: PIN }));
  assert.deepEqual([row().model.value, row().model.dataset.engine, row().model.disabled], ['gpt-5.5', 'codex', false]);
  assert.equal(doc.querySelector('#agents-rows .agent-origin').textContent, 'This workflow’s default: GPT-5.5 · low on OpenAI Codex.');
});
test('a pick in the picker saves the model with its harness and resets the effort, and the focus stays on the row; inherit clears both', async () => {
  const srv = makeServer({ stored: null });
  const { doc, row } = await openNew(srv);
  doc.querySelector('.agent-row-head[data-node-id="n_defrag"]').click();   // open the row: a collapsed body holds no focus
  row().model.click();
  assert.equal(doc.querySelector('.mdl-cols-pop .mdl-cols-hint').textContent, 'workflow default');
  opt(doc, 'harness', 'codex').click();
  opt(doc, 'model', 'gpt-5.5').click();
  await settle(24);
  const sent = srv.writes.at(-1).nodes.n_defrag;
  assert.deepEqual([sent.model, sent.effort, sent.engine], ['gpt-5.5', '', 'codex']);
  assert.deepEqual([row().model.value, row().model.dataset.engine, doc.activeElement === row().model], ['gpt-5.5', 'codex', true]);
  row().model.click();
  doc.querySelector('.mdl-cols-pop .mdl-cols-inherit').click();
  await settle(24);
  const cleared = srv.writes.at(-1).nodes.n_defrag;
  assert.deepEqual([cleared.model, cleared.effort, cleared.engine], ['', '', '']);
});
test('Review Focus 1: a stored model the catalog lost is shown as such and survives a save of another tunable', async () => {
  const srv = makeServer({ stored: null, pick: { model: 'gone-9' } });
  const { window, row } = await openNew(srv);
  assert.deepEqual([row().model.value, row().model.querySelector('.mdl-pick-text').textContent, row().effort.disabled], ['gone-9', 'gone-9 (not in the catalog)', true]);
  row().fan.checked = true;
  row().fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(24);
  assert.equal(srv.writes.at(-1).nodes.n_defrag.model, 'gone-9');
  assert.deepEqual([srv.refused, srv.nodes.n_defrag, row().fan.checked], [[], { model: 'gone-9', fanOut: true }, true],
    'the server keeps the pick and saves the toggle');
});
test('Review Focus 1: a stored model the catalog lost keeps its stored effort, shown and sent back on a save of another tunable', async () => {
  const srv = makeServer({ stored: null, pick: { model: 'gone-9', effort: 'high' } });
  const { window, row } = await openNew(srv);
  const effort = () => [[...row().effort.options].map((o) => o.value), row().effort.value, row().effort.disabled];
  assert.deepEqual(effort(), [['high'], 'high', true]);
  row().fan.checked = true;
  row().fan.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(24);
  const sent = srv.writes.at(-1).nodes.n_defrag;
  assert.deepEqual([sent.model, sent.effort], ['gone-9', 'high']);
  assert.deepEqual([srv.refused, srv.nodes.n_defrag, row().fan.checked], [[], { model: 'gone-9', effort: 'high', fanOut: true }, true]);
  assert.deepEqual(effort(), [['high'], 'high', true], 'the save\'s re-render shows it still');
});
// A dispatched click, not .click(): .click() on a disabled button never reaches a listener, so only a dispatched one
// shows the trigger's own guard.
test('Review Focus 5: a disabled trigger opens nothing: a model Settings › Memory owns, and a row with no project selected', async () => {
  const press = (window, b) => b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const locked = await openNew(makeServer({ stored: { model: 'claude-haiku-4-5', effort: 'high' } }));
  locked.doc.querySelector('.agent-row-head[data-node-id="n_defrag"]').click();
  const m = locked.row().model;
  assert.deepEqual([m.value, m.disabled, m.title], ['claude-haiku-4-5', true, 'Set in Settings › Memory']);
  press(locked.window, m);
  assert.equal(locked.doc.querySelector('.mdl-cols-pop'), null, 'the Memory-owned model opens nothing');

  const { window, doc, row } = await openNew(makeServer({ stored: null }));
  doc.querySelector('.agent-row-head[data-node-id="n_defrag"]').click();
  const project = doc.querySelector('#projectSelect');
  project.value = '';
  project.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual([doc.querySelector('#agentsSummary').textContent, row().model.disabled], ['select a project to change these', true]);
  press(window, row().model);
  assert.equal(doc.querySelector('.mdl-cols-pop'), null, 'with no project the trigger opens nothing');
});
test('a save of another tunable sends the pinned pick back untouched, with its harness; so does a stale pin', async () => {
  for (const pick of [PIN, { model: 'claude-haiku-4-5', effort: 'medium', engine: 'codex' }]) {
    const srv = makeServer({ stored: null, pick });
    const { window, row } = await openNew(srv);
    row().fan.checked = true;
    row().fan.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(24);
    const sent = srv.writes.at(-1).nodes.n_defrag;
    assert.deepEqual([sent.model, sent.effort, sent.engine, sent.fanOut], [pick.model, pick.effort, 'codex', true], pick.model);
  }
});
test('Save as workflow defaults sends a row\'s harness beside its model', async () => {
  const { window } = await openNew(makeServer({ stored: null }));
  const of = (row) => window.__np.effectiveDefaultsOf({ fanOut: false, askQuestions: null, subagentModel: '', ...row });
  assert.deepEqual(of({ model: 'gpt-5.5', effort: 'low', engine: 'codex' }), { model: 'gpt-5.5', effort: 'low', engine: 'codex', fanOut: false });
  assert.deepEqual(of({ model: 'claude-haiku-4-5', effort: 'high' }), { model: 'claude-haiku-4-5', effort: 'high', fanOut: false });
});
