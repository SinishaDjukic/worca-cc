// test/stillhet-task-page-decisions-host.test.mjs — the live task page (#run/ID, Stillhet on) draws the run's own answered
// Q&A in Decisions (F-3-04), each step's own time, cost and rounds in Activity (F-3-07), and every document dev lists under
// its step's name (F-3-12). Live app host (jsdom): the page reads dev's saved-run detail as GET /api/history/:key/:id answers it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, withRun } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
function sources(src = clone(SOURCES)) { for (const p of src.history.pipelines) p.projectKey = 'web-1'; return src; }
const card = (d) => d.querySelector('#route-run:not([hidden]) #card') || d.querySelector('#card');
const node = (id, label, progressStage) => ({ id, kind: 'agent', key: id.slice(2), label, progressStage });
const NODES = [node('n_plan', 'Plan', 'plan'), node('n_impl', 'Implementation', 'build'), node('n_rev', 'Review implementation', 'review')];
const row = (nodeId, status, o = {}) => ({ key: `x:${nodeId}:${o.cycle || 1}`, executionId: `x:${nodeId}:${o.cycle || 1}`, nodeId, agentKey: nodeId.slice(2), status, ...o });
// Plan ran 45 s for $0.40; Implementation ran three rounds, 3 minutes and $1.20 in all; Review never ran
const STEPS = [row('n_plan', 'done', { activeMs: 45000, costUsd: 0.4 }), row('n_impl', 'done', { activeMs: 120000, costUsd: 1, cycle: 1 }),
  row('n_impl', 'done', { activeMs: 60000, costUsd: 0.2, cycle: 3 })];
const STATE = { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: null, stepper: { template: { id: 'wf_default' }, graph: { nodes: NODES } }, steps: STEPS };
const QA = {
  clarify: { questions: [{ id: 'q1', question: 'Keep the old invoices address working?' }, { id: 'q2', question: 'Which dates does the export use?' }],
    answers: [{ id: 'q1', choice: 'Redirect it to Billing' }, { id: 'q2', choice: 'The invoice date' }] },
  stepQuestions: [{ stepKey: '3:n_impl#2', round: 1, nodeId: 'n_impl', agentKey: 'impl', questions: [{ id: 's1', question: 'Use the shared pager?' }, { id: 's2', question: 'Asked, never answered?' }],
    answers: [{ id: 's1', choice: 'Yes, the shared one' }] }],
};
const AWAY = { stepKey: '4:n_rev#1', round: 1, nodeId: 'n_rev', agentKey: 'rev', questions: [{ id: 'a1', question: 'Split the PR?' }], answers: [{ id: 'a1', choice: 'No' }],
  answeredBy: 'night-mode', night: { questions: [{ id: 'a1', choice: 'No', rationale: 'A smaller scope is safer.' }] } };

// `pid`: the pipeline the page reads (a live run's id is its run id, its saved detail its pipeline's)
async function open(id, detail, { src = sources(), read = () => null, pid = id } = {}) {
  const h = await liveHost({ sources: src, read: (u) => (u === `/api/history/web-1/${pid}` ? [200, clone(detail)] : read(u)) });
  h.w.RailUI.prefs.setMode('expert');
  await go(h.w, `#run/${id}`, 200); await settle(300);
  return h;
}
async function part(d, id) {
  const t = card(d).querySelector(`[data-key="tab:${id}"]`);
  assert.ok(t, `the ${id} part is offered`);
  if (t.getAttribute('aria-expanded') !== 'true') { t.click(); await settle(80); }
  return card(d).querySelector('#rtab-panel');
}
const decisionRows = (p) => [...p.querySelectorAll('.dc-list > li')].map((li) => [...li.querySelectorAll('.rtab-q, .dc-a, .rtab-dim')].map((e) => e.textContent.trim()));
const stepRow = (p, name) => [...p.querySelectorAll('.sc-subs li')].find((li) => li.querySelector('.sc-name')?.textContent.trim() === name);
const cols = (li) => ['.sc-time', '.sc-loop', '.sc-cost'].map((s) => li.querySelector(s)?.textContent.trim() || '');

test('F-3-04: the Decisions tab reads "Decisions 3" and lists each question, its answer and its step, "Implementation · cycle 2 · You"', async () => {
  const { d } = await open('h2', { state: STATE, ...QA });
  const tab = card(d).querySelector('[data-key="tab:decisions"]');
  assert.match(tab.textContent.replace(/\s+/g, ' '), /Decisions\s*3/);
  const p = await part(d, 'decisions');
  assert.match(p.querySelector('.rtab-h').textContent, /^3 decisions$/);
  assert.deepEqual(decisionRows(p), [
    ['Keep the old invoices address working?', 'Redirect it to Billing', 'Clarify · You'],
    ['Which dates does the export use?', 'The invoice date', 'Clarify · You'],
    ['Use the shared pager?', 'Yes, the shared one', 'Implementation · cycle 2 · You']]);
});

test('F-3-04: a question Away mode answered reads "Answered for you · Away mode" with its reason', async () => {
  const { d } = await open('h2', { state: STATE, clarify: null, stepQuestions: [AWAY] });
  const p = await part(d, 'decisions');
  assert.deepEqual(decisionRows(p), [['Split the PR?', 'No', 'Review implementation · Answered for you · Away mode · A smaller scope is safer']]);
  assert.match(p.querySelector('.ch-head').textContent, /1 by Away mode/);
});

test('F-3-04: on a shared sign-in, a question another person answered names them, never "You"; the viewer\'s own answer reads "You"', async () => {
  const qa = { clarify: { ...QA.clarify, answeredBy: 'mara@acme.dev' }, stepQuestions: [{ ...QA.stepQuestions[0], answeredBy: 'Sam@acme.dev' }] };
  const { d } = await open('h2', { state: STATE, ...qa }, { read: (u) => (u === '/api/whoami' ? [200, { name: 'sam@acme.dev', shared: true, source: 'access' }] : null) });
  await settle(200);
  const p = await part(d, 'decisions');
  assert.deepEqual(decisionRows(p).map((r) => r[2]), ['Clarify · mara@acme.dev', 'Clarify · mara@acme.dev', 'Implementation · cycle 2 · You']);
  assert.match(p.querySelector('.ch-head').textContent, /1 by you · 2 by others/);
});

test('F-3-04: an unanswered question is not listed; a waiting question is listed once, as the waiting row', async () => {
  const q = { id: 'q-run', kind: 'clarify', questions: [{ id: 'w1', question: 'Which format?', options: ['CSV', 'JSON'] }] };
  const state = { ...TASK_DETAILS.plan.state, status: 'running', pendingQuestion: q };
  const { d } = await open('run-a', { state, ...QA }, { src: sources(withRun({ pendingQuestion: q })), pid: 'pa' });
  const p = await part(d, 'decisions');
  assert.doesNotMatch(p.textContent, /Asked, never answered/);
  assert.equal(p.querySelectorAll('.dc-list > li.is-ask').length, 1, 'one waiting row');
  assert.equal((p.textContent.match(/Which format\?/g) || []).length, 1, 'the waiting question is said once');
  assert.equal(p.querySelectorAll('.dc-list > li.is-done').length, 3);
});

test('F-3-04: a task with no Q&A shows no Decisions tab', async () => {
  const { d } = await open('h2', { state: STATE, clarify: { questions: [], answers: [] }, stepQuestions: [] });
  assert.equal(card(d).querySelector('[data-key="tab:decisions"]'), null);
});

test('F-3-07: a done step shows its own time, rounds and cost; a step that never ran shows none', async () => {
  const { d } = await open('h2', { state: STATE });
  const p = await part(d, 'activity');
  assert.deepEqual(cols(stepRow(p, 'Plan')), ['45s', '', '$0.40']);
  assert.deepEqual(cols(stepRow(p, 'Implementation')), ['3m', '3', '$1.20']);
  assert.deepEqual(cols(stepRow(p, 'Review implementation')), ['', '', '']);
  assert.doesNotMatch(p.textContent, /Sonnet|Opus/, 'dev\'s rows carry no model: never the design\'s');
});

test('F-3-07: a working step\'s cost reads "… so far"', async () => {
  const working = { ...STATE, status: 'running', steps: [STEPS[0], row('n_impl', 'start', { activeMs: 90000, costUsd: 0.75 })] };
  const src = sources(); src.history.pipelines.find((x) => x.id === 'h2').status = 'running';
  const { d } = await open('h2', { state: working }, { src });
  const p = await part(d, 'activity');
  assert.deepEqual(cols(stepRow(p, 'Implementation')), ['2m', '', '$0.75 so far']);
});

test('F-3-07: the graph\'s node meta is the step\'s own time', async () => {
  const { d } = await open('h2', { state: STATE });
  await part(d, 'activity');
  const btn = card(d).querySelector('[data-graph]');
  assert.ok(btn, 'Open the graph (Expert)');
  btn.click(); await settle(60);
  const meta = [...d.querySelectorAll('.wg-node')].map((n) => [n.querySelector('.wg-name')?.textContent, n.querySelector('.wg-meta')?.textContent || '']);
  assert.deepEqual(meta.filter(([n]) => /^(Plan|Implementation|Review implementation)$/.test(n)), [['Plan', '45s'], ['Implementation', '3m'], ['Review implementation', '']]);
});

test('F-3-12: Changes lists every document dev lists, each from its step\'s name', async () => {
  const PATCH = 'diff --git a/src/pager.mjs b/src/pager.mjs\n--- a/src/pager.mjs\n+++ b/src/pager.mjs\n@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n';
  const artifacts = [{ relPath: 'results/review.json', stepKey: '3:n_impl#2', kind: 'result' }, { relPath: 'plan.md', nodeId: 'n_plan', kind: 'plan' }];
  const src = sources(); Object.assign(src.history.pipelines.find((x) => x.id === 'h2'), { branch: 'feat/x', survived: true });
  const { d } = await open('h2', { state: { ...STATE, branch: { source: 'dev', feature: 'feat/x', branchKept: true } } }, { src, read: (u) => (u === '/api/history/web-1/h2/diff' ? [200, PATCH] : u === '/api/runs/h2/artifacts' ? [200, { artifacts }] : null) });
  const p = await part(d, 'changes');
  const docs = [...p.querySelectorAll('.ch-doc')].map((li) => [li.querySelector('[data-doc]').textContent.trim(), li.querySelector('.ch-path').textContent.trim()]);
  assert.deepEqual(docs, [['review.json', 'from Implementation'], ['plan.md', 'from Plan']]);
});
