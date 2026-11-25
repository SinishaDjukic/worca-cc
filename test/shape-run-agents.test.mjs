// Small runs C2 (Step 6): one word source for a marked run's card row and its Agents rows, read from the snapshot shape
// of snapshotFromState (ui/public/ask-run-card.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runShortWord, runAgentRows, agentDetail, cardShortWord, memberShortWord } from '../src/shared/shape/run-agents.mjs';
import { careRunPlan } from '../src/shared/shape/feature-record.mjs';
import { snapshotFromState } from '../ui/public/ask-run-card.mjs';

const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, color: '',
  ports: { inputs: [{ id: 'plan', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const NODES = [['n_clarify', 'clarify'], ['n_plan', 'planner'], ['n_refine', 'refiner'], ['n_impl', 'implementer'], ['n_review', 'reviewer'],
  ['n_roles', 'planReviewer'], ['n_tests', 'testWriter']];
const manifest = (careRun, { tests = true } = {}) => ({
  version: 2, template: { id: 'wf_shape_slice_req', name: 'Shaper' },
  graph: { nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, label: 'Task', ports: { inputs: [], outputs: [] } },
    ...NODES.filter(([id]) => tests || id !== 'n_tests').map(([id, key]) => agent(id, key)),
    { id: 'n_end', kind: 'end', x: 0, y: 0, label: 'End', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [] } }], wires: [] },
  ...(careRun ? { careRun } : {}),
});
const row = (nodeId, status = 'done', n = 1) => ({ key: `x:${nodeId}:${n}`, executionId: `x:${nodeId}:${n}`, nodeId, ordinal: n, cycle: n, status,
  startedAt: `2026-11-21T10:00:0${n}Z`, activeMs: 10 });
const FLOW = ['n_clarify', 'n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
/** A live state: every flow node before `at` done, `at` active (its row in flight). */
function liveAt(at, careRun = careRunPlan('balanced', { runRoles: ['product', 'architect'] }), over = {}) {
  const before = FLOW.slice(0, FLOW.indexOf(at)).filter((id) => careRun.testWriter || id !== 'n_tests');
  return snapshotFromState({ id: 'p2', status: 'running', stepper: manifest(careRun, { tests: careRun.testWriter }),
    steps: [...before.map((id) => row(id)), row(at, 'start')], active: [{ nodeId: at, executionId: `x:${at}:1` }], ...over });
}

test('runShortWord: one word per agent node, with every row of the active node live with that word', () => {
  const WORD = { n_clarify: 'planning', n_plan: 'planning', n_roles: 'reviewing plan', n_refine: 'planning', n_tests: 'writing tests', n_impl: 'building', n_review: 'reviewing' };
  for (const [id, word] of Object.entries(WORD)) {
    const snap = liveAt(id);
    assert.equal(runShortWord(snap), word, id);
    const live = runAgentRows(snap).filter((r) => r.mark === 'live');
    assert.ok(live.length >= 1, `${id} drives a row`);
    for (const r of live) assert.equal(r.word, word, `${id}: ${r.name}`);
  }
});

test('runShortWord: a handoff (active: []) keeps the last finished agent node\'s word; planning before any', () => {
  const careRun = careRunPlan('balanced', { runRoles: ['product'] });
  const st = (steps) => snapshotFromState({ id: 'p2', status: 'running', stepper: manifest(careRun), steps, active: [] });
  assert.equal(runShortWord(st([])), 'planning');
  assert.equal(runShortWord(st([row('n_clarify'), row('n_plan'), row('n_roles'), row('n_refine'), row('n_tests')])), 'writing tests');
  assert.equal(runShortWord(st([row('n_clarify'), row('n_plan'), row('n_roles'), row('n_refine'), row('n_tests'), row('n_impl'), row('n_review')])), 'reviewing');
  assert.equal(runAgentRows(st([row('n_clarify'), row('n_plan')])).filter((r) => r.mark === 'live').length, 0);
});

test('runShortWord: null without careRun, and for paused, ask, error and stopped; done reads done', () => {
  assert.equal(runShortWord(snapshotFromState({ id: 'p', status: 'running', stepper: manifest(null), steps: [row('n_plan', 'start')], active: [{ nodeId: 'n_plan' }] })), null);
  assert.equal(runShortWord(null), null);
  for (const status of ['paused', 'error', 'stopped']) assert.equal(runShortWord(liveAt('n_impl', undefined, { status })), null, status);
  assert.equal(runShortWord({ ...liveAt('n_impl'), pendingQuestion: { id: 'q', kind: 'plan' } }), null, 'ask');
  assert.equal(runShortWord(liveAt('n_review', undefined, { status: 'done', active: [] })), 'done');
});

test('held: the last active node\'s rows read paused with the paused mark; finished rows check, later rows wait', () => {
  const careRun = careRunPlan('balanced', { runRoles: ['product', 'architect'] });
  const snap = snapshotFromState({ id: 'p2', status: 'paused', stepper: manifest(careRun),
    steps: ['n_clarify', 'n_plan', 'n_roles', 'n_refine'].map((id) => row(id)).concat(row('n_tests', 'paused')), active: [] });
  const rows = runAgentRows(snap);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.deepEqual([by['Test writer'].mark, by['Test writer'].word], ['paused', 'paused']);
  assert.deepEqual([by.Planner.mark, by.Planner.word], ['check', 'done']);
  assert.deepEqual([by['Plan review · Architect'].mark, by['Plan review · Architect'].word], ['check', 'done']);
  assert.deepEqual([by.Implementer.mark, by.Implementer.word], ['wait', 'waits']);
  // Only a paused run reads paused; an asking, failed or stopped run keeps the wait mark on those rows (C3 words them).
  const asking = runAgentRows({ ...liveAt('n_impl'), pendingQuestion: { id: 'q' } });
  assert.deepEqual(['mark', 'word'].map((k) => asking.find((r) => r.name === 'Implementer')[k]), ['wait', 'waits']);
  for (const status of ['error', 'stopped']) {
    const rows2 = runAgentRows(liveAt('n_impl', undefined, { status }));
    assert.equal(rows2.find((r) => r.name === 'Implementer').mark, 'wait', status);
  }
});

test('rows: Lean names "Tests · the Implementer" (it follows n_impl); Thorough lists the Challenger; order and code reviewers', () => {
  const lean = runAgentRows(liveAt('n_impl', careRunPlan('lean', { runRoles: ['product', 'security'] })));
  assert.deepEqual(lean.map((r) => r.name), ['Planner', 'Plan review · Product', 'Plan review · Security', 'Tests · the Implementer', 'Implementer',
    'Code review · Correctness', 'Code review · Security', 'Code review · Project fit', 'Code review · Requirements']);
  assert.equal(lean.find((r) => r.name === 'Tests · the Implementer').mark, 'live');
  assert.equal(lean.find((r) => r.name === 'Tests · the Implementer').word, 'building');
  const thorough = runAgentRows(liveAt('n_tests', careRunPlan('thorough', { runRoles: ['product', 'ux'] })));
  assert.deepEqual(thorough.slice(0, 6).map((r) => r.name), ['Planner', 'Plan review · Product', 'Plan review · UX', 'Plan review · Challenger', 'Test writer', 'Implementer']);
  assert.equal(new Set(thorough.map((r) => r.key)).size, thorough.length, 'keys are unique');
  assert.deepEqual(runAgentRows(liveAt('n_plan', undefined, { stepper: manifest(null) })), [], 'no careRun, no rows');
});

test('the shared module imports nothing from src/core and nothing from ui', () => {
  const src = readFileSync(new URL('../src/shared/shape/run-agents.mjs', import.meta.url), 'utf8');
  const froms = [...src.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]);
  assert.ok(froms.length > 0);
  for (const f of froms) assert.ok(!/core\/|ui\//.test(f), f);
});

// Small runs C3 (D12): the reviewer a stop names reads `objects` with the paused mark and no count; the rest keep C2.
test('C3: runAgentRows words the stopped reviewer objects (mark paused, no count); runShortWord reads waiting for you', () => {
  const base = liveAt('n_review');
  const snap = { ...base, pendingQuestion: { id: 'gate-w9-3', kind: 'gate', stop: { reason: 'objection', run: 2, node: 'n_review', head: 'Run 2 · Security objects' } } };
  const rows = runAgentRows(snap);
  const obj = rows.filter((r) => r.word === 'objects');
  assert.deepEqual(obj.map((r) => [r.name, r.mark]), [['Code review · Security', 'paused']]);
  assert.ok(rows.every((r) => !/\d/.test(r.word)), 'no count in any row word');
  assert.equal(runShortWord(snap), 'waiting for you');
  const any = runAgentRows({ ...snap, pendingQuestion: { ...snap.pendingQuestion, stop: { ...snap.pendingQuestion.stop, head: 'Run 2 · Code review objects' } } });
  assert.ok(any.filter((r) => r.word === 'objects').length >= 2, 'no role named: every code reviewer of the node objects');
  assert.equal(runAgentRows(base).some((r) => r.word === 'objects'), false);
});

// ── Shaper small runs D2 (D13): a done row's detail, from stored records only ──
test('D2 agentDetail: plan vN (· after the plan review from v2), T of T tests pass on the Implementer only, else null', () => {
  const done = (key) => ({ key, name: key, word: 'done', mark: 'check' });
  const stored = { planVersion: 2, planReviewed: true, tests: { passed: 12, total: 12 } };
  assert.equal(agentDetail(done('planner'), stored), 'plan v2 · after the plan review');
  assert.equal(agentDetail(done('planner'), { planVersion: 1, planReviewed: true }), 'plan v1');
  assert.equal(agentDetail(done('planner'), { planVersion: 2, planReviewed: false }), 'plan v2');
  assert.equal(agentDetail({ key: 'planner', name: 'Planner', word: 'planning', mark: 'live' }, stored), null, 'a live row has no detail');
  assert.equal(agentDetail(done('planner'), { planVersion: null, planReviewed: true }), null);
  assert.equal(agentDetail(done('implementer'), stored), '12 of 12 tests pass');
  assert.equal(agentDetail(done('tests-implementer'), stored), null, 'the count shows once, on the Implementer');
  assert.equal(agentDetail(done('implementer'), { tests: { passed: 11, total: 12 } }), null);
  assert.equal(agentDetail(done('code-review-correctness'), stored), null);
  for (const key of ['planner', 'implementer', 'test-writer']) {
    assert.equal(agentDetail(done(key), null), null);
    assert.equal(agentDetail(done(key), undefined), null);
  }
});

test('memberShortWord is cardShortWord of a member with the snapshot and slice it carries', () => {
  const stop = { status: 'running', pendingQuestion: { stop: { reason: 'check' } } };
  for (const mb of [
    { model: { state: 'needs-you' }, run: {}, snap: stop },
    { model: { state: 'working' }, run: {}, snap: { status: 'running', stepper: { careRun: {} }, active: [{ nodeId: 'n_impl' }] } },
    { model: { state: 'working' }, run: {}, snap: stop, slice: { stop: { held: true, after: 9 } } },
    { model: { state: 'waiting' }, run: { ticket: {} }, slice: { waitsFor: 8 } },
    { model: { state: 'ready' }, run: {} }, { model: { state: 'needs-you' }, run: {} }]) {
    assert.equal(memberShortWord(mb), cardShortWord(mb, mb.snap || null, mb.slice || null));
  }
  assert.deepEqual([memberShortWord({ model: { state: 'needs-you' }, run: {}, snap: stop }), memberShortWord({ model: { state: 'working' }, run: {}, slice: { stop: { held: true, after: 9 } } }),
    memberShortWord({ model: { state: 'waiting' }, run: {}, slice: { waitsFor: 8 } }), memberShortWord({ model: { state: 'ready' }, run: {} })],
  ['waiting for you', 'after run 9', 'waits for run 8', 'done']);
});
