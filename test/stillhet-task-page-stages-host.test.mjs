// test/stillhet-task-page-stages-host.test.mjs — the live task page's stages and focus on dev's data (feature 1 audit fix
// pass, D9, D10): a failure's bold title and its rows, a stopped task's subtitle and its stages, a plan waiting for
// approval with the run's own findings (none without a review, never the design's sample), the cap line, the PR lines.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, withRun, posts } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const sources = (src = clone(SOURCES)) => { for (const p of src.history.pipelines) p.projectKey = 'web-1'; return src; };
const card = (d) => d.querySelector('#route-run:not([hidden]) #card');
const detail = (id, state) => (u) => (u === `/api/history/web-1/${id}` ? [200, { state }] : null);
const page = async (id, src, read) => { const h = await liveHost({ sources: src, read }); await go(h.w, `#run/${id}`, 200); await settle(200); return h; };

test('a failure: the bold title, one row per failure, and the head does not repeat it', async () => {
  const { d } = await page('h3', sources(), detail('h3', TASK_DETAILS.failed.state));
  const broke = card(d).querySelector('#ov-focus');
  assert.equal(broke.querySelector('.rtab-ev-t').textContent, 'Build · 3 tests failed');
  assert.deepEqual([...broke.querySelectorAll('.rtab-ev-l')].map((e) => e.textContent), ['test/a.test.mjs: timeout', 'test/b.test.mjs: expected 2', 'test/c.test.mjs: ENOENT']);
  const head = card(d).querySelector('.rc-head, .pd-head, header') || card(d);
  const why = head.querySelector('.tp-why, [data-detail]');
  assert.ok(!why || !/tests failed/.test(why.textContent), 'the head keeps no failure text');
});

test('a stopped task: the subtitle says what stays, and every stage it ran is drawn, Plan included', async () => {
  const src = sources(); src.history.pipelines.push({ id: 'h6', title: 'Halted', status: 'stopped', projectName: 'web', projectKey: 'web-1', startedAt: '2026-11-14T06:00:00Z', mtime: Date.parse('2026-11-14T06:10:00Z') });
  const { d } = await page('h6', src, detail('h6', TASK_DETAILS.stopped.state));
  assert.match(card(d).textContent, /Stopped by you · the branch and changes stay/);
  assert.match(card(d).textContent, /Plan/);
  assert.match(card(d).textContent, /Stopped by you/);
});

test('a plan waiting for approval: Needs approval with the pencil, Plan opens on a step waiting for you, the run\'s own finding', async () => {
  const roleReviews = { rounds: [{ pass: 1, round: 1, target: 'plan', roles: [{ key: 'product', label: 'Product', findings: [] }, { key: 'qa', label: 'QA', findings: [{ id: 'qa-1-1', severity: 'minor', title: 'qa: mock finding', status: 'open' }] }] }] };
  const q = { id: 'q-plan', kind: 'plan', plan: { title: 'Ask me', roleReviews } };
  const state = { ...TASK_DETAILS.plan.state, pendingQuestion: q, roleReviews };
  const { d } = await page('run-a', sources(withRun({ pendingQuestion: q })), detail('pa', state));
  const c = card(d);
  assert.match(c.textContent, /Needs approval/);
  assert.match(c.textContent, /Waiting for your approval/);
  assert.ok(c.querySelector('.sc-answer'), 'the findings sit under the waiting step');
  const rows = [...c.querySelectorAll('.sc-answer [data-line]')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(rows.some((t) => /QA · 1 finding/.test(t)), `a finding row from the run's own review: ${rows.join(' | ')}`);
});

test('a plan with no review lists no finding, and never the design\'s sample roles', async () => {
  const q = { id: 'q-plan', kind: 'plan', plan: { title: 'Ask me' } };
  const { d } = await page('run-a', sources(withRun({ pendingQuestion: q })), detail('pa', { ...TASK_DETAILS.plan.state, pendingQuestion: q }));
  const c = card(d);
  assert.equal(c.querySelectorAll('.sc-answer [data-line], .sc-answer .ov-issues li').length, 0);
  assert.doesNotMatch(c.textContent, /Security · Passed|The trail wraps|Group pages keep an unused Back/);
});

test('a capped task: its paused step reads Paused at its cap', async () => {
  const src = sources(); src.history.pipelines = src.history.pipelines.map((p) => (p.id === 'h1' ? { ...p, pauseReason: 'cost_pipeline' } : p));
  const { d } = await page('h1', src, detail('h1', TASK_DETAILS.capped.state));
  assert.match(card(d).textContent, /Paused at its cap/);
});

test('the PR lines: Create PR reads Opened #N; Checks reads the passed count', async () => {
  const src = sources(); src.history.pipelines = src.history.pipelines.map((p) => (p.id === 'h2' ? { ...p, pr: { url: PR_URL, state: 'OPEN' } } : p));
  const read = (u) => (u === '/api/history/web-1/h2' ? [200, { state: TASK_DETAILS.approved.state }] : u.startsWith('/api/pr/checks?id=h2') ? [200, TASK_DETAILS.approved.checks] : null);
  const { w, d } = await page('h2', src, read);
  await go(w, '#run/h2/pr', 200);
  const text = card(d).textContent;
  assert.match(text, /Opened #\d+/);
  assert.match(text, /12 of 12 passed/);
});

// B1.6 (#1318): a live task waiting at its review gate (O1, O4), and a review forced on with open issues (O2)
const gNode = (id, label, progressStage) => ({ id, kind: 'agent', key: id.slice(2), label, progressStage });
const GATE_NODES = [gNode('n_plan', 'Plan', 'plan'), gNode('n_impl', 'Implementation', 'build'), gNode('n_rev', 'Review implementation', 'review'), gNode('n_manual', 'Manual tests checklist', 'review')];
const gRow = (nodeId, status, n = 1) => ({ key: `x:${nodeId}:${n}`, executionId: `x:${nodeId}:${n}`, nodeId, agentKey: nodeId.slice(2), status });
const GATE_Q = { id: 'gate-w5-3', kind: 'gate', wireId: 'w5', nodeId: 'n_rev', executionId: 'x:n_rev:3', deliveryNo: 3, holdNo: 0,
  issues: [{ severity: 'major', title: 'The pager loses its place', file: 'ui/pager.mjs', line: 42 }] };
const GATE_STATE = { ...TASK_DETAILS.plan.state, pendingQuestion: GATE_Q, stepper: { graph: { nodes: GATE_NODES } },
  steps: [gRow('n_plan', 'done'), gRow('n_impl', 'done'), gRow('n_rev', 'done')] };
const gatePage = (write = () => [200, { ok: true }]) => liveHost({ sources: sources(withRun({ pendingQuestion: GATE_Q })), read: detail('pa', GATE_STATE), write })
  .then(async (h) => { await go(h.w, '#run/run-a', 200); await settle(300); return h; });
const answers = (calls) => posts(calls).filter(([, u]) => u === '/api/answer');
const confirmIf = async (d) => { const y = d.querySelector('#card [data-confirm="yes"]'); if (y) { y.click(); await settle(80); } };

test('O1, O4: a task waiting at its review gate shows its line and issue rows under Review, Accept as is with Run another cycle, and no sample decision', async () => {
  const { d } = await gatePage();
  const c = card(d);
  assert.match(c.textContent, /Needs you/);
  assert.match(c.textContent, /Review implementation reached its cycle limit/);
  assert.doesNotMatch(c.textContent, /Asks you something/);
  const ask = c.querySelector('.sc-subs .is-ask');
  assert.ok(ask, 'a step asks');
  assert.match(ask.textContent, /Review implementation/);
  assert.match(ask.textContent, /1 open issue: accept as is, or run another cycle\?/);
  const under = c.querySelector('.sc-answer');
  assert.ok(under, 'the answer part sits under the asking step');
  assert.match(under.textContent, /The pager loses its place/);
  assert.match(under.textContent, /ui\/pager\.mjs:42/);
  assert.equal(c.querySelector('[data-key="act-main"]').dataset.label, 'Accept as is');
  c.querySelector('[data-key="menu:act"]').click(); await settle(30);
  const items = [...card(d).querySelectorAll('[data-menu-pick]')].map((x) => x.dataset.menuPick);
  assert.ok(items.includes('Run another cycle'), items.join(' | '));
  // I5: never the design's sample ask or issues
  assert.doesNotMatch(card(d).textContent, /· 1 open|Decisions\s*1|Group pages keep an unused Back|The trail wraps/);
});

test('O1: Accept as is sends POST /api/answer with decision continue', async () => {
  const { d, calls } = await gatePage();
  card(d).querySelector('[data-key="act-main"]').click(); await settle(60); await confirmIf(d);
  assert.deepEqual(answers(calls), [['POST', '/api/answer', { runId: 'run-a', id: 'gate-w5-3', payload: { decision: 'continue' } }]]);
});

test('O1: Run another cycle from the ▾ sends POST /api/answer with decision another', async () => {
  const { d, calls } = await gatePage();
  card(d).querySelector('[data-key="menu:act"]').click(); await settle(30);
  card(d).querySelector('[data-menu-pick="Run another cycle"]').click(); await settle(60); await confirmIf(d);
  assert.deepEqual(answers(calls), [['POST', '/api/answer', { runId: 'run-a', id: 'gate-w5-3', payload: { decision: 'another' } }]]);
});

test('O2: a saved run whose review was forced on draws that step as a problem, not done', async () => {
  const src = sources(); src.history.pipelines.push({ id: 'h7', title: 'Forced', status: 'done', projectName: 'web', projectKey: 'web-1', startedAt: '2026-11-14T06:00:00Z', mtime: Date.parse('2026-11-14T06:30:00Z') });
  const state = { ...TASK_DETAILS.stopped.state, id: 'h7', title: 'Forced', status: 'done', stepper: { graph: { nodes: GATE_NODES } },
    steps: [gRow('n_plan', 'done'), gRow('n_impl', 'done'), gRow('n_rev', 'done'), gRow('n_manual', 'done')],
    openIssues: [{ nodeId: 'n_rev', wireId: 'w5', executionId: 'x:n_rev:3', count: 2, critical: 0, major: 1, titles: ['a', 'b'] }] };
  const { w, d } = await page('h7', src, detail('h7', state));
  await go(w, '#run/h7/review', 200);
  const row = [...card(d).querySelectorAll('.sc-subs li')].find((li) => /Review implementation/.test(li.textContent));
  assert.ok(row, 'the review step is drawn');
  assert.match(row.className, /is-problem/);
  assert.doesNotMatch(row.className, /is-done/);
  assert.match(row.textContent, /Blocked · accepted with 2 open issues/);
});

// F-G-G2-02 (= F-cov23-10, TK-15): a live task waiting on its question shows that question, answered in place on dev's
// answer route (POST /api/answer {runId, id, payload: {answers}}, as classic and Stillhet Chat send it); never the
// design's sample question, in its step or under Decisions
const DEMO_ASKS = /Keep the breadcrumb on phones|Which pages get the breadcrumb|What does Back do on a group page|On phones, does the page keep its full trail|Run this workflow\?/;
const Q1 = { id: 'q-g2-1', kind: 'clarify', questions: [{ id: 'arch', question: 'Should the export include archived invoices?', options: ['Yes', 'No'], recommended: 'No' }] };
const Q2 = { id: 'q-g2-2', kind: 'questions', questions: [{ id: 'arch', question: 'Should the export include archived invoices?', options: ['Yes', 'No'], recommended: 'No' }, { id: 'sep', question: 'Which separator?', options: ['Comma', 'Semicolon'], recommended: 'Comma' }] };
const askPage = (q, write = () => [200, { ok: true }]) => liveHost({ sources: sources(withRun({ pendingQuestion: q })), write,
  read: detail('pa', { ...TASK_DETAILS.plan.state, pendingQuestion: q, stepper: { graph: { nodes: GATE_NODES } }, steps: [gRow('n_plan', 'done'), gRow('n_impl', 'start')] }) })
  .then(async (h) => { await go(h.w, '#run/run-a', 200); await settle(300); return h; });

test('F-G-G2-02: a task waiting on its question shows the run\'s own question and its options, never the design\'s sample', async () => {
  const { d } = await askPage(Q1);
  const c = card(d);
  assert.doesNotMatch(c.textContent, DEMO_ASKS);
  const ask = c.querySelector('.sc-subs .is-ask');
  assert.ok(ask, 'the step that asks is marked');
  assert.match(ask.textContent, /Should the export include archived invoices\?/);
  const under = c.querySelector('.sc-answer');
  assert.ok(under, 'the answer part sits under the asking step');
  assert.deepEqual([...under.querySelectorAll('[data-answer]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim().replace(/ ?Worca.*$/, '')), ['Yes', 'No']);
  assert.equal(c.querySelector('[data-key="act-main"]').dataset.label, 'Send answer');
  const dec = c.querySelector('[data-key="tab:decisions"]');
  assert.ok(dec, 'Decisions holds the open question');
  dec.click(); await settle(60);
  assert.match(card(d).textContent, /Should the export include archived invoices\?/);
  assert.doesNotMatch(card(d).textContent, DEMO_ASKS);
});

test('F-G-G2-02: Send answer posts the picked option on dev\'s answer route; Use the default answer posts Worca\'s pick', async () => {
  const { d, calls } = await askPage(Q1);
  card(d).querySelector('[data-answer="0"]').click(); await settle(30);
  card(d).querySelector('[data-key="act-main"]').click(); await settle(80); await confirmIf(d);
  assert.deepEqual(answers(calls), [['POST', '/api/answer', { runId: 'run-a', id: 'q-g2-1', payload: { answers: [{ id: 'arch', choice: 'Yes' }] } }]]);
  const b = await askPage(Q1);
  b.d.querySelector('#route-run:not([hidden]) #card [data-key="menu:act"]').click(); await settle(30);
  card(b.d).querySelector('[data-menu-pick="Use the default answer"]').click(); await settle(80); await confirmIf(b.d);
  assert.deepEqual(answers(b.calls), [['POST', '/api/answer', { runId: 'run-a', id: 'q-g2-1', payload: { answers: [{ id: 'arch', choice: 'No' }] } }]]);
});

test('F-G-G2-02: several questions are answered one by one, then sent together, your own words included', async () => {
  const { w, d, calls } = await askPage(Q2);
  assert.match(card(d).textContent, /Should the export include archived invoices\?/);
  assert.equal(card(d).querySelector('[data-key="act-main"]').dataset.label, 'Next question');
  card(d).querySelector('[data-answer="0"]').click(); await settle(30);
  card(d).querySelector('[data-key="act-main"]').click(); await settle(60);
  assert.match(card(d).textContent, /Which separator\?/);
  const own = card(d).querySelector('#answer-own');
  own.value = 'A tab'; own.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(20);
  assert.equal(card(d).querySelector('[data-key="act-main"]').dataset.label, 'Send answer');
  card(d).querySelector('[data-key="act-main"]').click(); await settle(80); await confirmIf(d);
  assert.deepEqual(answers(calls), [['POST', '/api/answer', { runId: 'run-a', id: 'q-g2-2', payload: { answers: [{ id: 'arch', choice: 'Yes' }, { id: 'sep', choice: 'A tab' }] } }]]);
});

test('F-G-G2-02: an ask the page cannot answer (a form) shows no sample question and no Send answer', async () => {
  const { d } = await askPage({ id: 'f-1', kind: 'form', form: 'release', version: 1 });
  assert.doesNotMatch(card(d).textContent, DEMO_ASKS);
  assert.equal(card(d).querySelector('.sc-answer'), null);
  assert.notEqual(card(d).querySelector('[data-key="act-main"]')?.dataset.label, 'Send answer');
  assert.equal(card(d).querySelector('[data-key="tab:decisions"]'), null, 'no Decisions part holds a sample question');
});

// F-G-G2-04: an archived task says it is archived, in classic's words (runs-list.mjs: the word Archived, no other line)
test('F-G-G2-04: an archived task reads Archived, never "Stopped by you · the branch and changes stay"', async () => {
  const src = sources(); src.archived = { pipelines: [{ id: 'h8', title: 'Shelved', status: 'stopped', archived: true, projectName: 'web', projectKey: 'web-1', startedAt: '2026-11-14T06:00:00Z' }] };
  const { d } = await page('h8', src, detail('h8', { ...TASK_DETAILS.stopped.state, id: 'h8', title: 'Shelved', archivedAt: '2026-11-14T07:00:00Z' }));
  assert.match(card(d).textContent, /Archived/);
  assert.doesNotMatch(card(d).textContent, /the branch and changes stay/);
  // the no-demo sweep (F-G-G2-02): the archived design case's Merged landing never reaches a task whose PR did not merge
  assert.doesNotMatch(card(d).textContent, /merged into/);
});
