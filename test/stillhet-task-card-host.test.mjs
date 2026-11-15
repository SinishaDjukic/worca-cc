// test/stillhet-task-card-host.test.mjs — R-ux-13, R-qa-14: in a live chat, the TaskCard of a failed task draws c17 (its
// branch into its base, "Build · REASON", the failing items, Retry) and of an approved PR c18 (its checks, "Approved by
// NAME", Merge PR), from task-live's taskCardOf; the same task's page shows the same case, branch line and items.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, stoppedRun } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

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

// #1266: the card draws its page's stages. A task with no project (no PR stage) ends at Done, closed and opened in place,
// and says its state once ("Finished", no "Ready" line under it); a task with a PR still reads PR and Merged.
const barLabels = (c) => [...c.querySelectorAll('.sb-labels > *')].map((e) => e.firstChild.textContent);
const lineLabels = (el) => [...el.querySelectorAll('.stage-line .tr-text b')].map((e) => e.textContent.replace(/ · now$/, ''));

test('a no-project finished card shows Plan, Build, Review, Done and one word, as its page does', async () => {
  const state = { ...TASK_DETAILS.approved.state, id: 'pa', projectKey: 'web-1', pr: null, branch: null, status: 'done' };
  const { w, d } = await liveHost({ sources: sources({ status: 'done' }), read: (u) => (u === '/api/history/web-1/pa' ? [200, { state }] : null) });
  await go(w, '#chat/ask_1', 200);
  const STAGES = ['Plan', 'Build', 'Review', 'Done'];
  assert.deepEqual(barLabels(card(d)), STAGES);
  assert.ok(card(d).querySelector('.stage-bar.is-done'), 'all of it in ink');
  card(d).querySelector('[data-open-task="pa"]').click(); await settle(80);
  const own = card(d).querySelector('.own-stages');
  assert.deepEqual(lineLabels(own), STAGES);
  assert.equal(own.querySelectorAll('.is-future').length, 0, 'every stage is done');
  const text = card(d).textContent;
  assert.doesNotMatch(text, /\bPR\b|Merged|Ready/);
  assert.equal(text.match(/Finished/g)?.length, 1, 'the state is said once');
  await go(w, '#run/pa', 300);
  assert.deepEqual(lineLabels(d.querySelector('#card .stage-stream')), STAGES, 'the page has the same stages');
  assert.match(d.querySelector('#card').textContent, /Finished/);
});

test('a ready task with a PR still shows PR and Merged, its bar at PR', async () => {
  const { w, d } = await liveHost({ sources: sources({ status: 'done', pr: { url: PR_URL, state: 'OPEN' } }) });
  await go(w, '#chat/ask_1', 250);
  const labels = barLabels(card(d));
  assert.deepEqual(labels.slice(-2), ['PR', 'Merged']);
  assert.equal(card(d).querySelector('.sb-labels > b')?.firstChild.textContent, 'PR');
});

test('the prototype\'s demo chat holds a finished no-project card with the same four stages (R-ux-7)', async (t) => {
  const w = stillhetHost({ hash: '#chat/c9', after: (f) => t.after(f) }); await settle(400);
  const c = w.document.querySelector('#route-chat [data-anchor="a4c"]');
  assert.ok(c, 'the demo card is drawn');
  assert.deepEqual(barLabels(c), ['Plan', 'Build', 'Review', 'Done']);
});

// R-qa-3, tone ok: a no-project task always maps to tone done (live-map.mjs caseOf: finished-nogit). A no-PR case with tone
// ok (push, folder, a feature) is not finished: its card keeps its last stage to come, as its page does.
test('a no-PR card with tone ok keeps its last stage to come, as its page does', async (t) => {
  const w = stillhetHost({ hash: '#chat/c9', after: (f) => t.after(f) }); await settle(400);
  const task = w.RailChats.data().chats.find((c) => c.id === 'c9').tasks.find((x) => x.id === 't9n');
  Object.assign(task, { case: 'push', stage: 2 });
  w.RailConversation.refresh(); await settle(80);
  const c = () => w.document.querySelector('#route-chat [data-anchor="a4c"]');
  assert.deepEqual(barLabels(c()), ['Plan', 'Build', 'Review', 'Push']);
  c().querySelector('[data-open-task="t9n"]').click(); await settle(80);
  const own = c().querySelector('.own-stages');
  assert.deepEqual(lineLabels(own), ['Plan', 'Build', 'Review', 'Push']);
  assert.equal(own.querySelectorAll('.is-future').length, 1, 'Push is still to come');
});
