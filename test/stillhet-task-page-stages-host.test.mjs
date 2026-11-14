// test/stillhet-task-page-stages-host.test.mjs — the live task page's stages and focus on dev's data (feature 1 audit fix
// pass, D9, D10): a failure's bold title and its rows, a stopped task's subtitle and its stages, a plan waiting for
// approval with the run's own findings (none without a review, never the design's sample), the cap line, the PR lines.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, withRun } from './helpers/stillhet-chat-live-host.mjs';
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
