// test/stillhet-task-card-host.test.mjs — R-ux-13, R-qa-14: in a live chat, the TaskCard of a failed task draws c17 (its
// branch into its base, "Build · REASON", the failing items, Retry) and of an approved PR c18 (its checks, "Approved by
// NAME", Merge PR), from task-live's taskCardOf; the same task's page shows the same case, branch line and items.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, stoppedRun } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
function sources(over) {
  const s = clone(stoppedRun());
  for (const p of s.history.pipelines) p.projectKey = 'web-1';
  Object.assign(s.history.pipelines.find((p) => p.id === 'pa'), over);
  return s;
}
const card = (d) => d.querySelector('#route-chat [data-anchor="card_run"]') || [...d.querySelectorAll('#route-chat .task-card, #route-chat [class*="task-card"]')].at(-1);

test('the failed task (c17): BRANCH into BASE, "Build · REASON", its failing items and Retry; its page shows the same', async () => {
  const state = { ...TASK_DETAILS.failed.state, id: 'pa' };
  const { w, d } = await liveHost({ sources: sources({ status: 'error' }), read: (u) => (u === '/api/history/web-1/pa' ? [200, { state }] : null) });
  await go(w, '#chat/ask_1', 200);
  const c = card(d);
  assert.ok(c, 'the card draws');
  const text = c.textContent.replace(/\s+/g, ' ');
  assert.match(text, /chore\/node-24/);
  assert.match(text, /into dev/);
  assert.match(text, /Build · 3 tests failed/);
  assert.match(text, /test\/a\.test\.mjs: timeout/);
  assert.match(text, /Retry/);
  const T = w.RailTaskLive;
  assert.deepEqual([T.card('pa').case, T.detail('pa').case], ['failed', 'failed']);
  await go(w, '#run/pa', 200);
  const page = d.querySelector('#card').textContent.replace(/\s+/g, ' ');
  assert.match(page, /chore\/node-24/);
  assert.match(page, /Build · 3 tests failed/);
});

test('the approved PR (c18): its checks, "Approved by NAME" and Merge PR; its page offers Merge PR too', async () => {
  const state = { ...TASK_DETAILS.approved.state, id: 'pa' };
  const { w, d } = await liveHost({ sources: sources({ status: 'done', pr: { url: PR_URL, state: 'OPEN' } }), read: (u) => (u === '/api/history/web-1/pa' ? [200, { state }]
    : u.startsWith('/api/pr/checks?id=pa') ? [200, TASK_DETAILS.approved.checks] : null) });
  await go(w, '#chat/ask_1', 250);
  const text = card(d).textContent.replace(/\s+/g, ' ');
  assert.match(text, /feat\/audit-log-pager/);
  assert.match(text, /All 12 checks pass/);
  assert.match(text, /Approved by maya/);
  assert.match(text, /Merge/);
  assert.equal(w.RailTaskLive.card('pa').case, 'approved');
  await go(w, '#run/pa', 200);
  assert.equal(d.querySelector('#card [data-key="act-main"]').dataset.label, 'Merge PR');
});

test('the failing PR\'s card: Fix checks asks with its own count, PR and base, never the design\'s sample "2 failing checks" (code review r9)', async () => {
  const state = { ...TASK_DETAILS.failing.state, id: 'pa', projectKey: 'web-1', branch: { source: 'main', feature: 'feat/red', branchKept: true } };
  const checks = { ...TASK_DETAILS.failing.checks, base: 'main', checks: { ...TASK_DETAILS.failing.checks.checks, failed: 3 } };
  const { w, d } = await liveHost({ sources: sources({ status: 'done', pr: { url: PR_URL, state: 'OPEN' } }), read: (u) => (u === '/api/history/web-1/pa' ? [200, { state }]
    : u.startsWith('/api/pr/checks?id=pa') ? [200, checks] : null) });
  await go(w, '#chat/ask_1', 250);
  assert.deepEqual([w.RailTaskLive.card('pa').base, w.RailTaskLive.card('pa').failedChecks], ['main', 3]);
  assert.ok(d.querySelector('#route-chat [data-card-act="pa|Fix checks"]'), 'the card offers Fix checks');
  // under load the card can repaint between finding the button and the click: press the one drawn now until the strip asks
  let text = '';
  for (let i = 0; i < 40 && !/Fix the /.test(text); i++) {
    d.querySelector('#route-chat [data-card-act="pa|Fix checks"]')?.click();
    await settle(50); text = d.querySelector('#route-chat').textContent.replace(/\s+/g, ' ');
  }
  assert.match(text, /Fix the 3 failing checks on #959\?/);
  assert.doesNotMatch(text, /2 failing checks/);
});
