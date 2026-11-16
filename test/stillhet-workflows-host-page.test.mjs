// test/stillhet-workflows-host-page.test.mjs — Stillhet's Workflows drawn from dev's answers in the live kind (slice 7):
// the bar's ways and the cards, a workflow's graph from dev's template, the canvas in Expert, built-ins read-only, the
// failed list look, the place's `has`, and a task's Workflow dialog that opens its workflow.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { workflowsHost, WF_LISTS, go, settle, closeHosts } from './helpers/stillhet-workflows-host.mjs';

afterEach(closeHosts);
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const page = (d) => d.querySelector('#route-place') || d.body;

test('#workflows lists the API\'s workflows, agents and scripts in the bar and as cards', async () => {
  const { w, d } = await workflowsHost();
  assert.equal(w.RailWorkflowLive.status(), 'ready');
  const bar = text(d.querySelector('#rail-bar, .rail-bar, nav')) + text(d.body);
  assert.match(bar, /All workflows/); assert.match(bar, /Agents/); assert.match(bar, /Scripts/);
  const cards = [...page(d).querySelectorAll('[data-wf-open]')].map((c) => c.dataset.wfOpen);
  for (const id of ['workflow:wf_default', 'workflow:wf_mine', 'workflow:wf_full']) assert.ok(cards.includes(id), `${id} in ${cards}`);
  await go(w, '#workflows/~agents', 120);
  const agents = [...page(d).querySelectorAll('[data-wf-open]')].map((c) => c.dataset.wfOpen);
  assert.ok(agents.includes('agent:planner') && agents.includes('agent:sec'), agents.join(' '));
  await go(w, '#workflows/~scripts', 120);
  assert.ok([...page(d).querySelectorAll('[data-wf-open]')].some((c) => c.dataset.wfOpen === 'script:diffGate'));
  assert.match(text(page(d)), /Diff gate/);
});

test('#workflows/workflow:wf_full mounts RailGraph with dev\'s template (11 nodes) and the agents it uses', async () => {
  const { w, mounts } = await workflowsHost({ hash: '#workflows/workflow:wf_full'});
  const m = mounts.filter((x) => x.wf.id === 'wf_full').at(-1);
  assert.ok(m, 'the graph is mounted');
  assert.equal(m.wf.tpl.nodes.length, WF_LISTS['/api/workflows'].workflows.find((x) => x.id === 'wf_full').nodes.length);
  assert.equal(m.wf.tpl.nodes.length, 11);
  const used = new Set(m.wf.tpl.nodes.filter((n) => n.kind === 'agent').map((n) => n.key));
  assert.deepEqual(Object.keys(m.wf.agentsByKey).filter((k) => used.has(k)).sort(), [...used].sort());
  assert.ok(w.document.querySelector('#wf-graph'));
});

test('#workflows/edit:wf_mine shows the canvas in Expert, drawn from dev\'s template', async () => {
  const { d, mounts } = await workflowsHost({ hash: '#workflows/edit:wf_mine'});
  assert.ok(d.querySelector('#wf-canvas-g'), 'the canvas');
  const m = mounts.at(-1);
  assert.equal(m.o.mode, 'edit');
  assert.deepEqual(m.wf.tpl.nodes.map((n) => n.id), WF_LISTS['/api/workflows'].workflows.find((x) => x.id === 'wf_mine').nodes.map((n) => n.id));
});

test('a built-in reads as it is: no pickers, no Save; its menu offers Use as a template', async () => {
  const { d } = await workflowsHost({ hash: '#workflows/workflow:wf_full'});
  assert.equal(page(d).querySelectorAll('[data-menu^="wfm-"], [data-menu^="wfe-"]').length, 0);
  assert.equal(page(d).querySelectorAll('[data-draft-save]').length, 0);
  const own = await workflowsHost({ hash: '#workflows/workflow:wf_mine'});
  assert.ok(page(own.d).querySelectorAll('[data-menu^="wfm-"]').length > 0, 'an own workflow has its pickers');
  const agent = await workflowsHost({ hash: '#workflows/agent:planner'});
  assert.equal(page(agent.d).querySelectorAll('[data-wf-sw], [data-menu="ag-model"]').length, 0);
});

test('a failed list read shows the failed look, with Try again', async () => {
  const { d } = await workflowsHost({ read: (u) => (u === '/api/agents' ? [500, { error: 'boom' }] : null) });
  assert.match(text(page(d)), /Could not load the workflows/);
  assert.ok(page(d).querySelector('[data-wf-retry]'));
});

test('RailPlaces.workflows.has answers on the live data', async () => {
  const { w } = await workflowsHost();
  const has = w.RailPlaces.workflows.has;
  assert.equal(has('workflow:wf_full'), true);
  assert.equal(has('agent:planner'), true);
  assert.equal(has('~scripts'), true);
  assert.equal(has('workflow:nope'), false);
});

test('the task Workflow dialog\'s "Open in Workflows" goes to #workflows/workflow:wf_full', async () => {
  const { TASK_DETAILS } = await import('./helpers/stillhet-live-fixture.mjs');
  const { liveHost, SOURCES, LISTS } = await import('./helpers/stillhet-chat-live-host.mjs');
  const src = JSON.parse(JSON.stringify(SOURCES));
  for (const p of src.history.pipelines) p.projectKey = 'web-1';
  const state = { ...TASK_DETAILS.approved.state, stepper: { ...(TASK_DETAILS.approved.state.stepper || {}), template: { id: 'wf_full', name: 'Full' } } };
  const { w, d } = await liveHost({ sources: src, lists: { ...LISTS, ...WF_LISTS }, read: (u) => (u === '/api/history/web-1/h2' ? [200, { state }] : null) });
  await go(w, '#run/h2', 150); await settle(400);
  d.querySelector('[data-tab="activity"]')?.click(); await settle(60);   // the graph opens from Activity
  const btn = d.querySelector('[data-graph]'); assert.ok(btn, 'Open the graph'); btn.click(); await settle(40);
  const open = d.querySelector('[data-open-wf]');
  assert.ok(open, 'Open in Workflows');
  assert.equal(open.dataset.openWf, 'wf_full');
  open.click(); await settle(120);
  assert.equal(w.location.hash, '#workflows/workflow:wf_full');
});

// gate G F-G-fid-06: dev's Default has two loops, Refine Plan on itself (at most once) and Review → Implementation (3 times).
// The story draws the one between two steps as the arc, rings Review, and says Refine Plan's in its own panel.
test('F-G-fid-06: the story draws Review → Implementation as the arc and says Refine Plan\'s self-loop in its panel', async () => {
  const { d } = await workflowsHost({ hash: '#workflows/workflow:wf_default' });
  const arcs = [...page(d).querySelectorAll('.ws-loop')];
  assert.equal(arcs.length, 1, 'one arc: the self-loop is no arc');
  assert.match(text(arcs[0]), /back to Implementation, at most 3 times/);
  const panels = [...page(d).querySelectorAll('.ws-p')], named = (n) => panels.find((p) => text(p.querySelector('.ws-name')) === n);
  assert.ok(named('Review Implementation').classList.contains('is-check'), 'Review is ringed');
  assert.ok(!named('Refine Plan').classList.contains('is-check'), 'Refine Plan is not ringed');
  assert.match(text(named('Refine Plan').querySelector('.ws-again')), /at most once/);
  page(d).querySelector('[data-wf-ways][aria-expanded="false"]')?.click(); await settle(40);   // Expert folds the ways
  assert.match(text(page(d)), /Review Implementation finds something/);
});

// F-G-fid-10: a one-step workflow reads "1 step"
test('F-G-fid-10: a workflow with one step reads "1 step", not "1 steps"', async () => {
  const one = { id: 'wf_one', name: 'One', version: 1, domain: 'coding', origin: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', archivedAt: null,
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'task' } }, { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }] };
  const { d } = await workflowsHost({ lists: { ...WF_LISTS, '/api/workflows': { workflows: [...WF_LISTS['/api/workflows'].workflows, one] } } });
  const card = page(d).querySelector('[data-wf-open="workflow:wf_one"]')?.closest('.pc, article, li, section') || page(d);
  assert.match(text(card), /\b1 step\b/); assert.doesNotMatch(text(page(d)), /\b1 steps\b/);
});

// F-FM2-03: a workflow no task has run has no measured figure: no "$0.00 a task", no "about 0 min"
test('F-FM2-03: a never-run live workflow shows no zero figures; one with tasks shows its own', async () => {
  const { d } = await workflowsHost({ hash: '#workflows/workflow:wf_mine' });
  const t = text(page(d));
  assert.doesNotMatch(t, /\$0\.00|about 0 min/, t.slice(0, 300));
  assert.match(t, /No tasks yet/);
  const full = await workflowsHost({ hash: '#workflows/workflow:wf_full' });
  assert.match(text(page(full.d)), /a task/, 'measured: its cost a task');
});
