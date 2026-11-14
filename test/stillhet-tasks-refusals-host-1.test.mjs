// test/stillhet-tasks-refusals-host-1.test.mjs — R-ux-9, R-qa-9: each Tasks action refused with its route's own code says
// Part 1 of 2: split to stay under CI's 300 s per file.
// one `Could not ACTION: REASON` where it started, and leaves the store and the task page model deep-equal. A 500 and a
// network failure read the same way. Live app host (jsdom).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, toastText, store } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const DETAIL = { h3: TASK_DETAILS.failed, h2: TASK_DETAILS.approved, h5: TASK_DETAILS.failing, h1: TASK_DETAILS.capped };
function sources() {
  const s = clone(SOURCES);
  for (const p of s.history.pipelines) p.projectKey = 'web-1';
  Object.assign(s.history.pipelines.find((p) => p.id === 'h2'), { pr: { url: PR_URL, state: 'OPEN' } });
  s.history.pipelines.push({ id: 'h5', title: 'Red CI', status: 'done', projectName: 'web', projectKey: 'web-1', startedAt: s.history.pipelines[0].startedAt, pr: { url: PR_URL, state: 'OPEN' } });
  s.history.pipelines.find((p) => p.id === 'h1').pauseReason = 'cost_pipeline';
  s.hello.runs = s.hello.runs.map((r) => (r.runId === 'run-a' ? { ...r, pendingQuestion: { id: 'q-plan', kind: 'plan' } } : r));
  return s;
}
const read = (u) => {
  const m = /^\/api\/history\/web-1\/(\w+)$/.exec(u); if (m && DETAIL[m[1]]) return [200, { state: DETAIL[m[1]].state }];
  const c = /^\/api\/pr\/checks\?id=(\w+)/.exec(u); if (c && DETAIL[c[1]]?.checks) return [200, DETAIL[c[1]].checks];
  return null;
};
async function refused(id, label, answer, args = {}) {
  const h = await liveHost({ sources: sources(), read, write: () => answer });
  await go(h.w, `#run/${id}`, 150);
  await settle(400);   // the open PRs' checks land and the store's rows redraw from them (D5, debounced) before the snapshot
  const before = { store: store(h.w), page: clone(h.w.RailTaskLive.detail(id)) };
  const res = await h.w.RailTaskLive.flow(label, { taskId: id, ...args });
  await settle(40);
  assert.equal(res.ok, false, label);
  assert.deepEqual({ store: store(h.w), page: clone(h.w.RailTaskLive.detail(id)) }, before, `${label}: nothing written locally`);
  return { ...h, res };
}
const CASES = [
  ['h2', 'Merge PR', [409, { error: 'GitHub reports merge conflicts on this pull request; fix them first.', code: 'CONFLICTS' }], 'Could not merge #959: GitHub reports merge conflicts on this pull request; fix them first.'],
  ['h5', 'Re-run checks', [409, { error: 'GitHub reports no failing checks on this pull request now.', code: 'NO_FAILING_CHECKS' }], 'Could not run the checks again: GitHub reports no failing checks on this pull request now.'],
  ['h5', 'Fix checks', [409, { error: 'A fix run is already working on this pull request.', code: 'BUSY' }], 'Could not start the checks fix: A fix run is already working on this pull request.'],
  ['h1', 'Raise the cap', [403, { error: 'total cost limit reached' }], 'Could not raise the cap: total cost limit reached', { value: '9' }],
  ['h1', 'Try again', [403, { error: 'total cost limit reached' }], 'Could not retry the task: total cost limit reached'],
  ['h3', 'Restart Build', [409, { error: 'This task has no saved plan to build from.', code: 'NO_PLAN' }], 'Could not restart Build: This task has no saved plan to build from.'],
  ['run-a', 'Approve and build', [409, { error: 'the run is not waiting on a plan' }], 'Could not approve the plan: the task is not waiting on a plan'],
  ['h3', 'Start a new task', [403, { error: 'total cost limit reached' }], 'Could not start the task: total cost limit reached'],
  ['run-b', 'Pause after this step', [409, { error: 'A pause after this step is already on its way.', code: 'ALREADY_PAUSING' }], 'Could not pause after this step: A pause after this step is already on its way.'],
  ['h3', 'Report this task', [502, { error: 'GitHub did not answer' }], 'Could not report this task: GitHub did not answer', { value: 'note' }],
];
for (const [id, label, answer, said, args] of CASES.slice(0, Math.ceil(CASES.length / 2))) {   // part 1: the first half of CASES
  test(`${label} refused (${answer[1].code || answer[0]}) says "${said}" once and changes nothing`, async () => {
    const { d } = await refused(id, label, answer, args);
    assert.equal(toastText(d), said);
  });
}
test('a 500 and a network failure read the same way, and change nothing', async () => {
  let { d } = await refused('h2', 'Merge PR', [500, { error: 'boom' }]);
  assert.equal(toastText(d), 'Could not merge #959: boom');
  const h = await liveHost({ sources: sources(), read, write: () => { throw new TypeError('Failed to fetch'); } });
  await go(h.w, '#run/h2', 150);
  const before = clone(h.w.RailTaskLive.detail('h2'));
  const res = await h.w.RailTaskLive.flow('Merge PR', { taskId: 'h2' });
  await settle(40);
  assert.equal(res.ok, false);
  assert.match(toastText(h.d), /^Could not merge #959: /);
  assert.deepEqual(clone(h.w.RailTaskLive.detail('h2')), before);
});

test('on the page: a refused Merge says it in its strip, naming the action, once; a refused cap keeps its typed value in its dialog', async () => {
  const h = await liveHost({ sources: sources(), read, write: () => [409, { error: 'GitHub reports merge conflicts on this pull request; fix them first.', code: 'CONFLICTS' }] });
  await go(h.w, '#run/h2', 150);
  await settle(400);   // the store's rows redraw once the open PRs' checks land (D5)
  h.d.querySelector('#card [data-key="act-main"]').click(); await settle(40);
  h.d.querySelector('#card [data-confirm="yes"]').click(); await settle(100);
  const strip = h.d.querySelector('#card').textContent;
  assert.match(strip, /Could not merge #959/);
  assert.match(strip, /GitHub reports merge conflicts on this pull request; fix them first/);
  assert.equal(toastText(h.d), '', 'said once, in the strip');
  // a refused cap keeps its typed value in its dialog and names the action
  const c = await liveHost({ sources: sources(), read, write: () => [400, { error: 'The new cap must be above what this task has spent ($2.50).' }] });
  await go(c.w, '#run/h1', 150);
  await settle(400);   // the store's rows redraw once the open PRs' checks land (D5)
  c.d.querySelector('#card [data-key="act-main"]').click(); await settle(40);
  const f = c.d.querySelector('#fd-value'); f.value = '2'; f.dispatchEvent(new c.w.Event('input', { bubbles: true }));
  c.d.querySelector('[data-key="fd-ok"]').click(); await settle(100);
  assert.equal(c.d.querySelector('#fd-value').value, '2', 'the dialog keeps the typed value');
  assert.match(c.d.body.textContent, /Could not raise the cap/);
});
