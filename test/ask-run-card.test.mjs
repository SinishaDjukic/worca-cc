// test/ask-run-card.test.mjs — the run progress card module: snapshot, pill, route, DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { snapshotFromState, runPill, progressRoute, createRunProgressCard, PROGRESS_CARD_TYPE } from '../ui/public/ask-run-card.mjs';

const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over,
});
const END = { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } };
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: {
  nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', { color: 'green',
    ports: { inputs: [{ id: 'fix', type: 'md', loop: true }, { id: 'plan', type: 'md', loop: false }], outputs: [{ id: 'done', type: 'void', when: 'always' }], await: true } }), END],
  wires: [
    { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'plan' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' }, loop: false },
    { id: 'w3', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
  ] }, bookends: { preflight: true, done: true } };
const step = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1, status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const STATE = (over = {}) => ({ id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'running', stepper: MANIFEST,
  steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'running', runningSince: null, trigger: { wireIds: ['w1'] } })],
  active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], totalCostUsd: 0.42, totalActiveMs: 65_000, startedAt: '2026-09-07T10:00:00Z', ...over });
const IDENT = { cardId: 'card_00000001', pipelineId: 'abcd1234', runId: 'run-uuid-1', projectKey: 'proj-00000001', workspaceId: null, title: 'Fix login', label: 'proj' };
const dom = () => new JSDOM('<!doctype html><html><body></body></html>').window.document;

test('snapshotFromState: a REST row becomes a frozen snapshot with decor, progress and active nodes', () => {
  const s = snapshotFromState(STATE(), { now: 0 });
  assert.equal(s.source, 'rest');
  assert.equal(s.pipelineId, 'abcd1234');
  assert.equal(s.runId, null);
  assert.equal(s.projectKey, 'proj-00000001');
  assert.equal(s.terminal, false);
  assert.equal(s.elapsedMs, 65_000);
  assert.equal(s.costUsd, 0.42);
  assert.deepEqual(s.progress, { done: 1, total: 2 });
  assert.deepEqual(s.active.map((a) => a.nodeId), ['n_impl']);
  assert.equal(s.decor.status.n_plan, 'done');
  assert.equal(s.decor.status.n_impl, 'active');
  assert.deepEqual(s.decor.liveWireIds, ['w1'], 'a still-running row marches the ants of its in-flight trigger (live derives from the status)');
  assert.equal(s.live, true);
  assert.deepEqual(snapshotFromState(STATE({ status: 'paused' }), { now: 0 }).decor.liveWireIds, [], 'a paused row is resolved: no ants');
  assert.equal(snapshotFromState(STATE({ status: 'done' })).terminal, true);
  assert.equal(snapshotFromState(STATE({ target: 'workspace', workspaceId: 'wks-1', projects: [{ projectName: 'a' }, { projectName: 'b' }] })).workspaceId, 'wks-1');
  const v1 = snapshotFromState(STATE({ stepper: null }));
  assert.equal(v1.decor, null, 'a v1 row draws no graph');
  assert.deepEqual(v1.active, [], 'and names no active agent (decorFromState would still list state.active — guarded)');
  assert.equal(snapshotFromState(null), null);
});

test('runPill: the Running list table in branch order — paused reasons, the question, terminal states, the newest agent', () => {
  const base = snapshotFromState(STATE(), { now: 0 });
  assert.deepEqual(runPill({ ...base, active: [] }), { family: 'peach', text: 'Running' });
  assert.deepEqual(runPill(base), { family: 'green', text: 'Implementer' }, 'one active agent: its label in its colour');
  assert.deepEqual(runPill({ ...base, active: [base.active[0], base.active[0]] }), { family: 'peach', text: '2 agents running' });
  assert.deepEqual(runPill({ ...base, status: 'pausing' }), { family: 'amber', text: 'Pausing…' });
  assert.deepEqual(runPill({ ...base, status: 'paused', pauseReason: 'cost_total' }), { family: 'amber', text: 'Paused · total budget' });
  assert.deepEqual(runPill({ ...base, status: 'paused', pauseReason: null }), { family: 'amber', text: 'Paused' });
  assert.deepEqual(runPill({ ...base, status: 'interrupted' }), { family: 'amber', text: 'Interrupted' });
  assert.deepEqual(runPill({ ...base, pendingQuestion: { kind: 'questions', questions: [{}] } }), { family: 'amber', text: 'Waiting for your answer' });
  assert.deepEqual(runPill({ ...base, status: 'done', pendingQuestion: { kind: 'workflow' } }), { family: 'amber', text: 'Waiting · your decision' }, 'the question outranks a terminal status (hello can seed both)');
  assert.deepEqual(runPill({ ...base, status: 'starting' }), { family: 'peach', text: 'Starting' });
  assert.deepEqual(runPill({ ...base, status: 'done' }), { family: 'green', text: 'Done' });
  assert.deepEqual(runPill({ ...base, status: 'error' }), { family: 'red', text: 'Error' });
  assert.deepEqual(runPill({ ...base, status: 'stopped' }), { family: 'red', text: 'Stopped' });
  assert.deepEqual(runPill(null), { family: 'peach', text: 'Starting' });
});

test('progressRoute: live → #running/<runId>; rest → History by key; nothing known → the started link', () => {
  const live = { ...snapshotFromState(STATE()), source: 'live', runId: 'run-uuid-9' };
  assert.equal(progressRoute(IDENT, live), '#running/run-uuid-9');
  assert.equal(progressRoute(IDENT, snapshotFromState(STATE({ status: 'done' }))), '#history/proj-00000001/abcd1234');
  assert.equal(progressRoute({ ...IDENT, projectKey: null, workspaceId: 'wks-1' }, snapshotFromState(STATE({ status: 'done' }))), '#history/workspaces/wks-1/abcd1234');
  assert.equal(progressRoute({ ...IDENT, pipelineId: null }, null), '#running/run-uuid-1');
  assert.equal(progressRoute({ ...IDENT, runId: null }, null), '#history/proj-00000001/abcd1234');
  assert.equal(progressRoute({ ...IDENT, runId: null, pipelineId: null }, null), '#running/');
});

test('createRunProgressCard: renders the head, stats, chips and graph; update() patches in place and keeps the mount', () => {
  const doc = dom();
  const opened = [];
  const card = createRunProgressCard({ doc, ident: IDENT, onOpen: (href) => opened.push(href) });
  doc.body.appendChild(card.el);
  assert.ok(card.el.classList.contains('ask-card') && card.el.classList.contains('ask-rc'), 'keeps the .ask-card base class (the started-link pin selects through it)');
  assert.equal(card.el.querySelector('a.ask-rc-open').getAttribute('href'), '#running/run-uuid-1');
  assert.equal(card.el.querySelector('.ask-rc-pill').textContent, 'Starting');
  const snap = { ...snapshotFromState(STATE(), { now: 0 }), source: 'live', runId: 'run-uuid-1' };
  card.update(snap, 0);
  assert.equal(card.el.querySelector('.ask-rc-title').textContent, 'Fix login');
  assert.equal(card.el.querySelector('.ask-rc-pill').className, 'ask-rc-pill st-green');
  assert.equal(card.el.querySelector('.ask-rc-time').textContent, '1m 5s');
  assert.equal(card.el.querySelector('.ask-rc-cost').textContent, '$0.42');
  assert.equal(card.el.querySelector('.ask-rc-prog').textContent, '1/2 agents');
  const chips = [...card.el.querySelectorAll('.ask-rc-agent')];
  assert.deepEqual(chips.map((c) => c.textContent), ['Implementer']);
  assert.ok(chips[0].querySelector('.ask-rc-agent-dot'), 'the pulse is a real element, not a ::before (the dock reduced-motion blanket reaches it)');
  assert.equal(chips[0].style.getPropertyValue('--c'), 'var(--green)');
  assert.ok(card.el.classList.contains('is-live'));
  const host = card.el.querySelector('.ask-rc-graph');
  assert.equal(host.hidden, false);
  const stage = host.querySelector('.gv-stage');
  assert.ok(stage && stage.classList.contains('gv-flow'), 'flow layout, the chat renderer');
  assert.ok(host.querySelector('.node[data-node-id="n_impl"]').classList.contains('is-active'), 'decor applied (the view keys cards by data-node-id)');
  assert.ok(host.querySelector('.node[data-node-id="n_plan"]').classList.contains('is-done'));
  assert.equal(host.querySelector('.wbadge .wfired'), null, 'no delivery yet: no loop badge');
  assert.equal(host.querySelectorAll('.xfoot').length, 0, 'G1: no footer bands in a flow host');
  assert.equal(host.querySelectorAll('.nrun').length, 0, 'D19: no per-node total pips in the chat card');
  assert.ok(host.querySelector('.gv-wires path.wire-live'), 'ants on the trigger wire of the in-flight execution');
  // G2 for the ants: the panel's relayoutCards() path re-renders the wires (dropping wire-live) — the card puts them back
  card.relayout(400);
  assert.ok(host.querySelector('.gv-wires path.wire-live'), 'ants survive a relayout');
  assert.ok(host.querySelector('.node[data-node-id="n_impl"]').classList.contains('is-active'));
  // a later generation: same element, same stage, new statuses
  const snap2 = { ...snapshotFromState(STATE({ status: 'done', active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1 })], wireDeliveries: { w3: 2 }, endReached: true, result: null }), { now: 0 }), source: 'live', runId: 'run-uuid-1' };
  card.update(snap2, 0);
  assert.equal(host.querySelector('.gv-stage'), stage, 'the graph mount survives an update');
  assert.equal(card.el.querySelector('.ask-rc-pill').textContent, 'Done');
  assert.ok(card.el.classList.contains('is-terminal') && !card.el.classList.contains('is-live'));
  assert.equal(card.el.querySelectorAll('.ask-rc-agent').length, 0);
  assert.equal(host.querySelector('.wbadge .wfired').textContent, '2×', 'loop badge from wireDeliveries');
  // relayout re-applies the decor the re-render dropped (G2, the panel's relayoutCards path)
  card.relayout(400);
  assert.equal(host.querySelector('.wbadge .wfired').textContent, '2×');
  assert.ok(host.querySelector('.node[data-node-id="n_impl"]').classList.contains('is-done'));
  card.el.querySelector('a.ask-rc-open').click();
  assert.deepEqual(opened, ['#running/run-uuid-1']);
  card.destroy();
  assert.equal(host.style.height, '', 'destroy releases the flow height');
});

test('createRunProgressCard: the question banner, the error reason, a v1 run without a graph', () => {
  const doc = dom();
  const card = createRunProgressCard({ doc, ident: IDENT });
  doc.body.appendChild(card.el);
  card.update({ ...snapshotFromState(STATE(), { now: 0 }), source: 'live', runId: 'r', pendingQuestion: { kind: 'questions', questions: [{}, {}] } }, 0);
  const banner = card.el.querySelector('.ask-rc-banner');
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, 'Waiting for your answer — 2 questions');
  assert.equal(card.el.querySelector('.ask-rc-pill').textContent, 'Waiting for your answer');
  card.update({ ...snapshotFromState(STATE({ status: 'error', active: [] }), { now: 0 }) }, 0);
  assert.equal(banner.hidden, true);
  card.setReason('Run failed: Preflight failed');
  assert.equal(card.el.querySelector('.ask-rc-reason').textContent, 'Run failed: Preflight failed');
  card.update(snapshotFromState(STATE({ stepper: { steps: [] } })), 0);
  assert.equal(card.el.querySelector('.ask-rc-graph').hidden, true, 'a v1 stepper draws nothing');
  assert.equal(card.el.querySelector('.ask-rc-prog').textContent, '—');
  assert.equal(PROGRESS_CARD_TYPE, 'progress');
});
