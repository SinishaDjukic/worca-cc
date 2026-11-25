// Small runs C2 (Step 7): the run panel's Agents section (ui/public/shape/run-agents.mjs), one `.srows` list under the
// Overview's section head, painted from the run's snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRunAgents } from '../ui/public/shape/run-agents.mjs';
import { runShortWord } from '../src/shared/shape/run-agents.mjs';
import { careRunPlan } from '../src/shared/shape/feature-record.mjs';
import { snapshotFromState } from '../ui/public/ask-run-card.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, ports: { inputs: [], outputs: [] } });
const manifest = (careRun) => ({ version: 2, template: { id: 'wf_shape_slice_req' },
  graph: { nodes: [['n_clarify', 'clarify'], ['n_plan', 'planner'], ['n_refine', 'refiner'], ['n_impl', 'implementer'], ['n_review', 'reviewer'],
    ['n_roles', 'planReviewer'], ['n_tests', 'testWriter']].map(([id, key]) => agent(id, key)), wires: [] }, ...(careRun ? { careRun } : {}) });
const row = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status, startedAt: '2026-11-21T10:00:00Z' });
const CARE = careRunPlan('balanced', { runRoles: ['product', 'architect'] });
const snapAt = (careRun = CARE) => snapshotFromState({ id: 'p2', status: 'running', stepper: manifest(careRun),
  steps: ['n_clarify', 'n_plan', 'n_roles', 'n_refine'].map((id) => row(id)).concat(row('n_tests', 'start')), active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:1' }] });

test('a .srows list under h3.shape-cl-title "Agents", with the head count and no model names', () => {
  const host = doc.createElement('div');
  mountRunAgents(host, snapAt());
  const box = host.querySelector(':scope > .plan-body.srows.run-agents');
  assert.ok(box);
  assert.equal(box.querySelector('h3.shape-cl-title').textContent, 'Agents');
  const rows = box.querySelectorAll('.plan-check-row');
  assert.equal(rows.length, 9);
  assert.equal(box.querySelector('p.shape-cl-caption').textContent, '9 · no agent approves its own work');
  assert.deepEqual([...rows].map((r) => r.querySelector('.plan-check-label').textContent).slice(0, 5),
    ['Planner', 'Plan review · Product', 'Plan review · Architect', 'Test writer', 'Implementer']);
  assert.doesNotMatch(box.textContent, /claude|sonnet|opus|haiku/i);
  // The name and its word share one .plan-check-text (the .srows wrapper), with no id column.
  for (const r of rows) {
    assert.ok(r.querySelector(':scope > .plan-check-text > .plan-check-label + .plan-check-detail'), r.textContent);
    assert.equal(r.querySelector('.plan-check-id'), null);
  }
});

test('the live row carries the running dot and runShortWord; aria-label is the word', () => {
  const host = doc.createElement('div');
  const snap = snapAt();
  mountRunAgents(host, snap);
  const live = [...host.querySelectorAll('.plan-check-row')].find((r) => r.querySelector('.plan-check-label').textContent === 'Test writer');
  const mark = live.querySelector('.plan-check-mark');
  assert.ok(mark.classList.contains('is-live'));
  assert.equal(mark.querySelector('.status-dot').dataset.state, 'working');
  assert.ok(mark.querySelector('.status-dot').classList.contains('is-pulse'));
  assert.equal(mark.getAttribute('aria-label'), runShortWord(snap));
  assert.equal(live.querySelector('.plan-check-detail').textContent, 'writing tests');
  const done = [...host.querySelectorAll('.plan-check-row')][0];
  assert.ok(done.classList.contains('ok'));
  assert.equal(done.querySelector('.plan-check-mark').getAttribute('aria-label'), 'done');
});

test('idempotent: a second paint replaces the list in place; absent without careRun or stepper', () => {
  const host = doc.createElement('div');
  mountRunAgents(host, snapAt());
  const first = host.querySelector('.run-agents');
  mountRunAgents(host, snapAt());
  assert.equal(host.querySelectorAll('.run-agents').length, 1);
  assert.equal(host.querySelector('.run-agents'), first, 'the same element is repainted');
  mountRunAgents(host, snapAt(null));
  assert.equal(host.querySelector('.run-agents'), null);
  mountRunAgents(host, snapAt());
  mountRunAgents(host, { status: 'running', stepper: null });
  assert.equal(host.querySelector('.run-agents'), null);
  mountRunAgents(host, null);
  assert.equal(host.children.length, 0);
});

// Item 11: the Agents section is part of the run card's Overview (inside .rd-sheet-nav), not a list under the card.
test('a live Care run\'s Agents section is inside the card\'s .rd-sheet-nav, not in .hd-ov-below; a dev run shows no Agents host', async () => {
  const ok = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const ctx = await bootApp({ fetchHandler: (u) => (u.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : ok({})) });
  const steps = ['n_clarify', 'n_plan', 'n_roles', 'n_refine'].map((id) => row(id)).concat(row('n_tests', 'start'));
  helloRun(ctx, { runId: 'r-care', pipelineId: 'p2', stepper: manifest(CARE), steps, active: [{ nodeId: 'n_tests', executionId: 'x:n_tests:1' }] });
  ctx.go('running/r-care');
  await ctx.settle(6);
  const d = ctx.window.document;
  const box = d.querySelector('#run-detail .run-agents');
  assert.ok(box, 'the Agents section painted');
  assert.ok(box.closest('.rd-sheet-nav'), 'inside the card');
  assert.equal(box.closest('.hd-ov-below'), null, 'not under the card');
  assert.equal(box.closest('.rd-run-agents').hidden, false);
  const dev = await bootApp({ fetchHandler: (u) => (u.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : ok({})) });
  helloRun(dev, { runId: 'r-dev', pipelineId: 'p3', stepper: manifest(null), steps, active: [] });
  dev.go('running/r-dev');
  await dev.settle(6);
  const host = dev.window.document.querySelector('#run-detail .rd-run-agents');
  assert.equal(dev.window.document.querySelector('#run-detail .run-agents'), null);
  assert.ok(!host || host.hidden, 'a dev run shows no Agents host');
});

test('D2 (D13): a done row shows its stored detail in place of "done"; without stored data it reads done; the count is on one row', () => {
  const lean = careRunPlan('lean', { runRoles: ['product'] });
  assert.equal(lean.testWriter, false);
  const doneSnap = (careRun) => snapshotFromState({ id: 'p2', status: 'done', stepper: manifest(careRun),
    steps: ['n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_impl', 'n_review'].map((id) => row(id)), active: [] });
  const stored = { planVersion: 2, planReviewed: true, tests: { passed: 12, total: 12 } };
  const detailOf = (host, label) => [...host.querySelectorAll('.plan-check-row')]
    .find((r) => r.querySelector('.plan-check-label').textContent === label).querySelector('.plan-check-detail').textContent;
  const host = doc.createElement('div');
  mountRunAgents(host, doneSnap(CARE), { stored });
  assert.equal(detailOf(host, 'Planner'), 'plan v2 · after the plan review');
  const plain = doc.createElement('div');
  mountRunAgents(plain, doneSnap(CARE));
  assert.equal(detailOf(plain, 'Planner'), 'done');
  const noWriter = doc.createElement('div');
  mountRunAgents(noWriter, doneSnap(lean), { stored });
  const counts = [...noWriter.querySelectorAll('.plan-check-detail')].filter((d) => d.textContent === '12 of 12 tests pass');
  assert.equal(counts.length, 1);
  assert.equal(counts[0].closest('.plan-check-row').querySelector('.plan-check-label').textContent, 'Implementer');
  assert.equal(detailOf(noWriter, 'Tests · the Implementer'), 'done');
});
