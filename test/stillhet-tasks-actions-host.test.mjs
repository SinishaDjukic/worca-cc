// test/stillhet-tasks-actions-host.test.mjs — Step 7: each of the ten Tasks actions sends exactly its route and body, in
// the live app host (jsdom, the real live adapter and RailTaskLive). Merge, Fix checks, Raise the cap and Restart Build
// are pressed on the task page itself (its action slot, strip and dialog); the rest through the page's flow.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const DETAIL = { h3: TASK_DETAILS.failed, h2: TASK_DETAILS.approved, h5: TASK_DETAILS.failing, h1: TASK_DETAILS.capped };
function sources() {
  const s = clone(SOURCES);
  for (const p of s.history.pipelines) p.projectKey = 'web-1';
  const h2 = s.history.pipelines.find((p) => p.id === 'h2'); h2.pr = { url: PR_URL, state: 'OPEN' };
  s.history.pipelines.push({ id: 'h5', title: 'Red CI', status: 'done', projectName: 'web', projectKey: 'web-1', startedAt: h2.startedAt, mtime: h2.mtime, pr: { url: PR_URL, state: 'OPEN' } });
  const h1 = s.history.pipelines.find((p) => p.id === 'h1'); h1.pauseReason = 'cost_pipeline';
  return s;
}
const read = (u) => {
  const m = /^\/api\/history\/web-1\/(\w+)$/.exec(u); if (m && DETAIL[m[1]]) return [200, { state: DETAIL[m[1]].state }];
  const c = /^\/api\/pr\/checks\?id=(\w+)/.exec(u); if (c && DETAIL[c[1]]?.checks) return [200, DETAIL[c[1]].checks];
  return null;
};
async function page(id, over = {}) {
  const h = await liveHost({ sources: sources(), read, write: () => [200, { ok: true }], ...over });
  await go(h.w, `#run/${id}`, 150);
  await settle(400);   // the open PRs' checks land and the store's rows redraw from them (D5, debounced)
  return h;
}
const main = (d) => d.querySelector('#card [data-key="act-main"]');
const yes = async (d) => { d.querySelector('#card [data-confirm="yes"]').click(); await settle(80); };
const sent = (calls) => posts(calls).filter(([m, u]) => m !== 'GET' && !/^\/api\/ask\//.test(u));

test('merge: Merge PR, confirmed in its strip, posts /api/pr/merge with the task\'s scope', async () => {
  const { d, calls } = await page('h2');
  assert.equal(main(d).dataset.label, 'Merge PR');
  assert.doesNotMatch(d.querySelector('#card').textContent, /What broke/, 'a passing PR broke nothing');
  main(d).click(); await settle(40);
  assert.match(d.querySelector('#card').textContent, /Merge #959 into dev\?/);
  await yes(d);
  assert.deepEqual(sent(calls), [['POST', '/api/pr/merge', { id: 'h2', projectKey: 'web-1' }]]);
});

test('rerun-checks: Re-run checks posts /api/pr/rerun-checks', async () => {
  const { w, calls } = await page('h5');
  await w.RailTaskLive.flow('Re-run checks', { taskId: 'h5' });
  assert.deepEqual(sent(calls), [['POST', '/api/pr/rerun-checks', { id: 'h5', projectKey: 'web-1' }]]);
});

test('fix-checks: Fix checks, confirmed, posts /api/pr/fix-checks', async () => {
  const { d, calls } = await page('h5');
  assert.equal(main(d).dataset.label, 'Fix checks');
  assert.match(d.querySelector('#card').textContent, /What broke/, 'failing checks: what broke');
  main(d).click(); await settle(40); await yes(d);
  assert.deepEqual(sent(calls), [['POST', '/api/pr/fix-checks', { id: 'h5', projectKey: 'web-1' }]]);
});

test('raise-cap: the cap dialog starts at the task\'s own cap, and "$180" as typed posts /api/resume with costCapUsd 180', async () => {
  const { w, d, calls } = await page('h1');
  assert.equal(main(d).dataset.label, 'Raise the cap');
  main(d).click(); await settle(40);
  const field = d.querySelector('#fd-value');
  assert.equal(field.value, '$2', 'the field starts at this task\'s cap, not the demo\'s $180');
  assert.match(d.querySelector('#card').textContent, /It is at \$2/);
  assert.doesNotMatch(d.querySelector('#card').textContent, /It is at \$120/);
  field.value = 'lots'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('[data-key="fd-ok"]').click(); await settle(40);
  assert.match(d.querySelector('#card').textContent, /Write the new cap in dollars, like \$180/);
  assert.deepEqual(sent(calls), [], 'not money: nothing is posted');
  d.querySelector('#fd-value').value = '$180'; d.querySelector('#fd-value').dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('[data-key="fd-ok"]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['POST', '/api/resume', { pipelineId: 'h1', costCapUsd: 180 }]]);
});

test('retry: Try again on a paused task posts /api/resume with baseCheck', async () => {
  const { w, calls } = await page('h1');
  await w.RailTaskLive.flow('Try again', { taskId: 'h1' });
  assert.deepEqual(sent(calls), [['POST', '/api/resume', { pipelineId: 'h1', baseCheck: true }]]);
});

test('restart-build: Restart Build on an errored task posts /api/runs/:id/restart-build', async () => {
  const { d, calls } = await page('h3');
  assert.equal(main(d).dataset.label, 'Restart Build');
  main(d).click(); await settle(80);
  if (d.querySelector('#card [data-confirm="yes"]')) await yes(d);
  assert.deepEqual(sent(calls), [['POST', '/api/runs/h3/restart-build', {}]]);
});

test('plan-approve: Approve and build posts the plan answer through Chat\'s action', async () => {
  const s = sources();
  s.hello.runs = s.hello.runs.map((r) => (r.runId === 'run-a' ? { ...r, pendingQuestion: { id: 'q-plan', kind: 'plan', plan: { file: '/p.md' } } } : r));
  const { w, calls } = await page('run-a', { sources: s });
  await w.RailTaskLive.flow('Approve and build', { taskId: 'run-a' });
  assert.deepEqual(sent(calls), [['POST', '/api/runs/run-a/answer', { id: 'q-plan', decision: 'approve' }]]);
});

test('new-task: Start a new task posts /api/run with the saved run\'s project, prompt and setup', async () => {
  const { w, calls } = await page('h3', { write: (u) => (u === '/api/run' ? [200, { runId: 'r-new' }] : [200, {}]) });
  const r = await w.RailTaskLive.flow('Start a new task', { taskId: 'h3' });
  assert.equal(r.ok, true);
  assert.deepEqual(sent(calls), [['POST', '/api/run', { projectDir: '/src/web', prompt: 'Update Node to 24', workflowId: 'wf_default', guardrailsId: 'g1', labels: ['infra'], tags: [{ key: 'team', value: 'web' }] }]]);
});

test('pause-after-step: Pause after this step posts /api/pause with afterStep', async () => {
  const { w, calls } = await page('run-b');
  await w.RailTaskLive.flow('Pause after this step', { taskId: 'run-b' });
  assert.deepEqual(sent(calls), [['POST', '/api/pause', { runId: 'run-b', afterStep: true }]]);
});

test('report: Report this task posts dev\'s run report with its reason and the note', async () => {
  const { w, calls } = await page('h3');
  await w.RailTaskLive.flow('Report this task', { taskId: 'h3', value: 'It hung on the tests' });
  assert.deepEqual(sent(calls), [['POST', '/api/pipelines/h3/report-issue', { reason: 'failed-or-stuck', expectation: 'It hung on the tests' }]]);
});

test('the page\'s own tools: Changes › Check out posts dev\'s checkout route with the task\'s scope, never a stand-in', async () => {
  const { d, calls } = await page('h2');
  const tab = d.querySelector('#card [data-key="tab:changes"], #card [data-tab="changes"]');
  if (tab && tab.dataset.tab === 'changes') { tab.click(); await settle(60); }   // a ready task's Changes may already be open (partNow)
  const co = d.querySelector('#card [data-checkout]');
  assert.ok(co, 'Check out is drawn in the live kind');
  co.click(); await settle(80);
  assert.deepEqual(sent(calls), [['POST', '/api/runs/h2/checkout?projectKey=web-1', {}]]);
  assert.doesNotMatch(d.body.textContent, /Not connected to Worca yet|Would /);
});

test('create-pr: the Create PR dialog starts on the task\'s base and posts what you wrote and picked: title, description, draft, watch, base (code review r9)', async () => {
  const h7 = { id: 'h7', title: 'Ready one', status: 'done', projectName: 'web', projectKey: 'web-1', branch: 'feat/ready', survived: true, startedAt: SOURCES.history.pipelines[2].startedAt, mtime: SOURCES.history.pipelines[2].mtime };
  const s = sources(); s.history.pipelines.push(h7);
  const state = { id: 'h7', title: 'Ready one', status: 'done', projectKey: 'web-1', projectDir: '/src/web', branch: { source: 'main', feature: 'feat/ready', branchKept: true }, totalCostUsd: 0.2, totalActiveMs: 60000, steps: [] };
  const h = await liveHost({ sources: s, read: (u) => (u === '/api/history/web-1/h7' ? [200, { state }] : read(u)), write: () => [200, { ok: true }] });
  await go(h.w, '#run/h7', 150); await settle(400);
  const { w, d, calls } = h;
  assert.equal(main(d).dataset.label, 'Create PR');
  main(d).click(); await settle(40);
  assert.match(d.querySelector('#card [data-key="menu:pdbase"]')?.textContent || '', /main/, 'the base picker starts on the task\'s own base');
  assert.doesNotMatch(d.querySelector('#card').textContent, /41 commits behind|2 new commits since the task started/, 'no demo base lines on a live task');
  const title = d.querySelector('#pd-title'), desc = d.querySelector('#pd-desc');
  title.value = 'My title'; title.dispatchEvent(new w.Event('input', { bubbles: true }));
  desc.value = 'What it did'; desc.dispatchEvent(new w.Event('input', { bubbles: true }));
  const draft = d.querySelector('#pd-draft'); draft.checked = true; draft.dispatchEvent(new w.Event('change', { bubbles: true }));
  d.querySelector('#card [data-key="pd-ok"]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['POST', '/api/pr', { id: 'h7', title: 'My title', body: 'What it did', draft: true, watch: true, baseBranch: 'main', projectKey: 'web-1' }]]);
});
