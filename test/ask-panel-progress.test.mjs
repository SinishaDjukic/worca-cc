// test/ask-panel-progress.test.mjs — the live run progress card inside the sheet (D1 seam, D9 hydration, D12 route).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001', MID = 'askm_00000001', CARD_ID = 'card_00000001';
const PROJECT_CARD = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'Fix the login bug', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login', sourceBranchByKey: null, note: '', attachments: [] };
const agent = (id, key, color = 'violet') => ({ id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color,
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: { nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', 'green'),
  { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false }, { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] }, bookends: { preflight: true, done: true } };
const live = (over = {}) => ({ source: 'live', runId: 'run-uuid-1', pipelineId: 'abcd1234', kind: 'run', title: 'Fix login', projectKey: null, workspaceId: null, projectDir: '/repos/proj', projectNames: null,
  status: 'running', pauseReason: null, pendingQuestion: null, live: true, terminal: false, startedAt: 't', elapsedMs: 4000, costUsd: 0.1,
  progress: { done: 0, total: 2 }, active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1', label: 'Planner', color: 'violet' }], stepper: MANIFEST,
  decor: { version: 2, status: { n_plan: 'active', n_impl: 'pending', n_end: 'pending' }, colors: { n_plan: 'violet', n_impl: 'green', n_end: '' }, footers: {}, totals: {}, liveWireIds: [], loopBadges: {}, gate: null, endResult: null, progress: { done: 0, total: 2 }, nodeIds: ['n_plan', 'n_impl', 'n_end'], wireIds: ['w1', 'w2'], expanded: null }, ...over });
const REST_STATE = { id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'done', stepper: MANIFEST, steps: [], totalCostUsd: 1.5, totalActiveMs: 120000, startedAt: 't', endReached: true, result: null, active: [] };

function fakeStore(initial = {}) {
  const byRun = new Map(Object.entries(initial));
  const listeners = new Set();
  return {
    byRun, listeners,
    get: (id) => byRun.get(id) || null,
    byPipeline: (pid) => [...byRun.values()].find((s) => s.pipelineId === pid) || null,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    poke: (id, type = 'state') => { for (const fn of listeners) fn(id, type); },
  };
}
function threadSnap(blocks, runLinks = []) {
  return { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, createdAt: 't' },
      { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', blocks, status: 'done', createdAt: 't' }], attachments: [], runLinks, worktrees: [], inFlight: null };
}
async function openWith(blocks, { store = null, runLinks = [], fetchHandler = null } = {}) {
  const ctx = makePanel({ deps: store ? { runStore: store } : {}, fetchHandler: (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(url, opts); if (r) return r; }
    if (url.startsWith('/api/ask/threads/' + TID)) return { ok: true, status: 200, json: async () => threadSnap(blocks, runLinks) };
    if (url.startsWith('/api/ask/models')) return { ok: true, status: 200, json: async () => ({ models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['high'], custom: false }], efforts: ['high'] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  for (let i = 0; i < 6; i++) await ctx.tick();
  ctx.flush();
  return ctx;
}
const STARTED = { kind: 'card', id: CARD_ID, state: 'started', runId: 'run-uuid-1', card: PROJECT_CARD };
const TRACKED = { kind: 'card', id: 'card_00000002', state: 'tracked', card: { type: 'progress', pipelineId: 'abcd1234', runId: null, projectKey: 'proj-00000001', workspaceId: null, title: 'Fix login', label: 'proj', status: 'done' } };

test('started card without a store: the progress card keeps the pinned #running link and never fetches without a pipeline id', async () => {
  const ctx = await openWith([STARTED]);
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  assert.ok(el, 'the started state renders the progress card');
  assert.ok(ctx.doc.querySelector('.ask-card a[href="#running/run-uuid-1"]'));
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Starting');
  assert.ok(!ctx.fetchCalls.some((c) => c.url.startsWith('/api/ask/runs/')), 'no pipeline id → nothing to hydrate');
  ctx.panel.destroy();
});

test('started card with a live snapshot: paints from the store, repaints in place on a poke, freezes on done', async () => {
  const store = fakeStore({ 'run-uuid-1': live() });
  const ctx = await openWith([STARTED], { store });
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Planner');
  assert.equal(el.querySelector('.ask-rc-pill').className, 'ask-rc-pill st-violet');
  assert.equal(el.querySelector('.ask-rc-prog').textContent, '0/2 agents');
  assert.equal(el.querySelector('.ask-rc-sub').textContent, 'proj · #abcd1234');
  const stage = el.querySelector('.ask-rc-graph .gv-stage');
  assert.ok(stage, 'graph mounted');
  store.byRun.set('run-uuid-1', live({ status: 'done', terminal: true, live: false, active: [], progress: { done: 2, total: 2 }, costUsd: 0.9,
    decor: { ...live().decor, status: { n_plan: 'done', n_impl: 'done', n_end: 'done' }, progress: { done: 2, total: 2 } } }));
  store.poke('run-uuid-1', 'done');
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card.ask-rc'), el, 'same element');
  assert.equal(el.querySelector('.ask-rc-graph .gv-stage'), stage, 'same graph mount');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Done');
  assert.equal(el.querySelector('.ask-rc-cost').textContent, '$0.90');
  assert.equal(el.querySelector('.ask-rc-prog').textContent, '2/2 agents');
  assert.ok(ctx.doc.querySelector('.ask-card a[href="#running/run-uuid-1"]'), 'still in the live map → the Running detail');
  ctx.panel.destroy();
});

test('a log frame never repaints; a state frame does (poke gating)', async () => {
  const store = fakeStore({ 'run-uuid-1': live() });
  const ctx = await openWith([STARTED], { store });
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  store.byRun.set('run-uuid-1', live({ costUsd: 0.5 }));
  store.poke('run-uuid-1', 'log');
  ctx.flush();
  assert.equal(el.querySelector('.ask-rc-cost').textContent, '$0.10');
  store.poke('run-uuid-1', 'state');
  ctx.flush();
  assert.equal(el.querySelector('.ask-rc-cost').textContent, '$0.50');
  ctx.panel.destroy();
});

test('a follower notice (ask-message → full transcript rebuild) re-parents the SAME card element and mount', async () => {
  const store = fakeStore({ 'run-uuid-1': live() });
  const ctx = await openWith([STARTED], { store });
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  const stage = el.querySelector('.ask-rc-graph .gv-stage');
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: 'askm_s0000003', threadId: TID, seq: 3, role: 'system', text: 'Run started — "Fix login"', status: null, createdAt: 't',
    blocks: [{ kind: 'notice', text: 'Run started — "Fix login"', href: '#running/run-uuid-1' }] } });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card.ask-rc'), el, 'D10: cached across the structure rebuild');
  assert.equal(el.querySelector('.ask-rc-graph .gv-stage'), stage);
  assert.equal(ctx.doc.querySelectorAll('.ask-notice').length, 1);
  ctx.panel.destroy();
});

test('tracked card: hydrates over GET /api/ask/runs/:id, freezes on the final state, routes to History; junk envelopes are ignored', async () => {
  let junk = false;
  const ctx = await openWith([TRACKED], { store: fakeStore(), fetchHandler: (url) => {
    if (url === '/api/ask/runs/abcd1234') return junk ? { ok: true, status: 200, json: async () => ({ config: {} }) } : { ok: true, status: 200, json: async () => ({ state: REST_STATE, live: null }) };
    return null;
  } });
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/runs/abcd1234').length, 1, 'one hydration on build (the loadThread hook finds it already in flight)');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Done');
  assert.equal(el.querySelector('.ask-rc-time').textContent, '2m 0s');
  assert.equal(el.querySelector('.ask-rc-cost').textContent, '$1.50');
  assert.equal(el.querySelector('a.ask-rc-open').getAttribute('href'), '#history/proj-00000001/abcd1234');
  assert.ok(el.querySelector('.ask-rc-graph .gv-stage'), 'a finished run still draws its workflow');
  junk = true;
  ctx.panel.onHello([]);                      // reconnect → resync → loadThread → re-hydrate
  for (let i = 0; i < 6; i++) await ctx.tick();
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card.ask-rc'), el, 'the resync keeps the cached element');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Done', 'a non-state envelope never replaces the last paint');
  ctx.panel.destroy();
});

test('the started card learns its pipeline id from the thread run links and re-routes after a resume frame', async () => {
  const store = fakeStore();
  const ctx = await openWith([STARTED], { store, runLinks: [{ threadId: TID, runId: 'run-uuid-1', pipelineId: 'abcd1234', cardId: CARD_ID, status: 'paused', phase: null, commentIds: [], createdAt: 't' }],
    fetchHandler: (url) => (url === '/api/ask/runs/abcd1234' ? { ok: true, status: 200, json: async () => ({ state: { ...REST_STATE, status: 'paused' }, live: null }) } : null) });
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Paused');
  assert.equal(el.querySelector('a.ask-rc-open').getAttribute('href'), '#history/proj-00000001/abcd1234');
  // the run resumes elsewhere: a new runId lands in the live map and on the link
  store.byRun.set('run-uuid-2', live({ runId: 'run-uuid-2' }));
  ctx.panel.pushServerFrame({ type: 'ask-run-status', threadId: TID, runId: 'run-uuid-2', pipelineId: 'abcd1234', cardId: CARD_ID, status: 'running', phase: 'plan' });
  ctx.flush();
  assert.equal(el.querySelector('a.ask-rc-open').getAttribute('href'), '#running/run-uuid-2');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Planner');
  ctx.panel.destroy();
});

test('Open run closes the sheet and navigates; a started run that failed keeps the card with the reason', async () => {
  const store = fakeStore({ 'run-uuid-1': live() });
  const ctx = await openWith([STARTED], { store });
  ctx.doc.querySelector('a.ask-rc-open').click();
  assert.equal(ctx.panel.isOpen(), false);
  assert.equal(ctx.window.location.hash, '#running/run-uuid-1');
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: MID, threadId: TID, seq: 2, role: 'assistant', text: 'ok', status: 'done', createdAt: 't',
    blocks: [{ ...STARTED, state: 'failed', error: 'Preflight failed' }] } });
  ctx.panel.open();
  ctx.flush();
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  assert.ok(el, 'failed + runId is a run that errored, not a rejected proposal');
  assert.equal(el.querySelector('.ask-rc-reason').textContent, 'Run failed: Preflight failed');
  assert.equal(ctx.doc.querySelector('.ask-card-stub'), null);
  ctx.panel.destroy();
});

test('a hydrate that resolves nothing after the live entry vanished keeps the last paint (D24)', async () => {
  const store = fakeStore({ 'run-uuid-1': live() });
  const ctx = await openWith([STARTED], { store, fetchHandler: (url) => (url === '/api/ask/runs/abcd1234' ? { ok: true, status: 200, json: async () => ({ config: {} }) } : null) });
  const el = ctx.doc.querySelector('.ask-card.ask-rc');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Planner');
  const stage = el.querySelector('.ask-rc-graph .gv-stage');
  // the acting tab's resume evicts the superseded lineage: nothing live any more, and REST answers with a junk envelope
  store.byRun.delete('run-uuid-1');
  ctx.panel.close();
  ctx.panel.open();                                   // openSheet → repaintProgressCards({hydrate:true}) → the fetch
  for (let i = 0; i < 6; i++) await ctx.tick();
  ctx.flush();
  assert.equal(ctx.fetchCalls.filter((c) => c.url === '/api/ask/runs/abcd1234').length, 1, 'the card did hydrate');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Planner', 'the hydrate tail never regresses the card to "Starting"');
  assert.equal(el.querySelector('.ask-rc-graph .gv-stage'), stage, 'and never tears the graph down');
  ctx.panel.destroy();
});

test('destroy() drops the run tick and the store subscription', async () => {
  const store = fakeStore({ 'run-uuid-1': live() });
  const ctx = await openWith([STARTED], { store });
  assert.equal(store.listeners.size, 1);
  ctx.panel.destroy();
  assert.equal(store.listeners.size, 0);
});
