// test/stillhet-task-page-states-host.test.mjs — the live task page's own states (D15, §3): loading until the list and the
// task's detail are in, "Could not load this task" with Try again, "This task no longer exists" with a Tasks button; and
// a page that draws the prototype's case with the task's own facts. jsdom app host, live kind.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
// The fixture's saved runs with their store keys, so the page can read their History detail.
const sources = () => { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; };
const text = (d) => (d.querySelector('#route-today:not([hidden])')?.textContent || '').replace(/\s+/g, ' ').trim();

test('a task page loads: the loading look first, then the prototype\'s failed page with the task\'s own title, branch and reason', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { w, d } = await liveHost({ sources: sources(), hold: (u) => (u === '/api/history/web-1/h3' ? gate : null),
    read: (u) => (u === '/api/history/web-1/h3' ? [200, { state: TASK_DETAILS.failed.state }] : null) });
  await go(w, '#run/h3');
  assert.match(text(d), /Loading this task…/);
  release(); await settle(80);
  const card = d.querySelector('#route-run:not([hidden]) #card');
  assert.ok(card, 'the page draws');
  assert.equal(card.querySelector('[data-title]').textContent, 'Broke');
  assert.match(card.textContent, /chore\/node-24/);
  assert.match(card.textContent, /Build · 3 tests failed/);
});

test('a cold deep link to #run/ID: no error while the adapter starts, the loading look, then the page', async () => {
  const errs = [];
  const { w, d } = await liveHost({ sources: sources(), hash: '#run/h3',
    beforeScripts: (win) => { win.console.error = (...a) => errs.push(String(a[0])); win.addEventListener('error', (e) => errs.push(String(e.error))); },
    read: (u) => (u === '/api/history/web-1/h3' ? [200, { state: TASK_DETAILS.failed.state }] : null) });
  await settle(150);
  assert.deepEqual(errs, []);
  assert.equal(d.querySelector('#route-run:not([hidden]) #card [data-title]')?.textContent, 'Broke');
});

test('a failed task\'s What broke lists the same failing items as its card (R-ux-6), never the design\'s sample', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h3' ? [200, { state: TASK_DETAILS.failed.state }] : null) });
  await go(w, '#run/h3', 200); await settle(200);
  const broke = d.querySelector('#route-run:not([hidden]) #card #ov-focus');
  assert.ok(broke, 'the What broke part');
  const lines = broke.querySelector('.rtab-ev-l').textContent.split('\n');
  assert.deepEqual(lines, w.RailTaskLive.detail('h3').why, 'the card\'s own items');
  assert.deepEqual(lines, ['✗ test/a.test.mjs: timeout', '✗ test/b.test.mjs: expected 2', '✗ test/c.test.mjs: ENOENT']);
});

test('a failed load says "Could not load this task" with Try again; Try again draws the page and focuses its heading', async () => {
  let fail = true;
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h3' ? (fail ? [500, { error: 'boom' }] : [200, { state: TASK_DETAILS.failed.state }]) : null) });
  await go(w, '#run/h3', 100);
  assert.match(text(d), /Could not load this task/);
  assert.match(text(d), /Nothing changed\./);
  assert.doesNotMatch(text(d), /server did not answer/);
  fail = false;
  d.querySelector('[data-task-retry]').click(); await settle(100);
  assert.ok(d.querySelector('#route-run:not([hidden]) #card [data-title]'), 'the page draws');
  assert.equal(d.activeElement, d.querySelector('#card [data-title]'));
});

test('a cold deep link whose task list fails to load says "Could not load this task"; Try again reads the list and draws the page (web-UI review cycle 2)', async () => {
  let fail = true;
  const h = await liveHost({ sources: sources(), hash: '#run/h3', read: (u) => (u === '/api/history' && fail ? [500, { error: 'boom' }] : u === '/api/history/web-1/h3' ? [200, { state: TASK_DETAILS.failed.state }] : null) });
  await settle(100);
  assert.match(text(h.d), /Could not load this task/, 'never "Loading this task…" for ever');
  fail = false;
  h.d.querySelector('[data-task-retry]').click(); await settle(60);
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: SOURCES.hello.runs }) });
  await settle(300);
  assert.ok(h.d.querySelector('#route-run:not([hidden]) #card [data-title]'), 'the page draws');
  assert.equal(h.d.activeElement, h.d.querySelector('#card [data-title]'), 'Try again lands on the heading, never <body> (web-UI review cycle 3)');
});

test('Try again while the load still fails keeps the focus on the new Try again (web-UI review cycle 3)', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h3' ? [500, { error: 'boom' }] : null) });
  await go(w, '#run/h3', 100);
  d.querySelector('[data-task-retry]').focus();
  d.querySelector('[data-task-retry]').click(); await settle(100);
  assert.match(text(d), /Could not load this task/);
  assert.equal(d.activeElement, d.querySelector('[data-task-retry]'));
});

test('a network failure reads the same as a 5xx', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h3' ? [0] : null) });
  await go(w, '#run/h3', 100);
  assert.match(text(d), /Could not load this task/);
});

test('gone: an id neither the runs nor the store hold, or a 404, says "This task no longer exists" with a Tasks button and no Try again', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === '/api/history/web-1/h2' ? [404, { error: 'pipeline not found' }] : null) });
  for (const id of ['nope-123', 'h2']) {
    await go(w, `#run/${id}`, 100);
    assert.match(text(d), /This task no longer exists/, id);
    assert.equal(d.querySelector('#route-today [data-task-retry]'), null);
    const tasks = d.querySelector('#route-today [data-nav="runs"]');
    assert.equal(tasks?.textContent.trim(), 'Tasks');
  }
  d.querySelector('#route-today [data-nav="runs"]').click(); await settle(60);
  assert.equal(w.location.hash, '#runs');
  assert.ok(d.querySelector('#runs-root').contains(d.activeElement), `focus lands in the Tasks list, not on ${d.activeElement?.tagName}`);
});

test('no task at all: the Tasks list says "No tasks yet." and Start a task hands over to Chat (D12c)', async () => {
  const s = sources(); s.hello.runs = []; s.history.pipelines = []; s.schedules = { tickets: [], schedules: [] };
  const { w, d } = await liveHost({ sources: s });
  await go(w, '#runs', 200);
  const root = d.querySelector('#runs-root');
  assert.match(root.textContent, /No tasks yet\./);
  const start = root.querySelector('[data-empty]');
  assert.equal(start?.textContent.trim(), 'Start a task');
  let started = '';
  w.RailConversation.start = (kind) => { started = kind; };
  start.click(); await settle(40);
  assert.equal(started, 'task');
});

test('old addresses keep the id: #running/ID and #history/KEY/PID open #run/ID', async () => {
  const { w } = await liveHost({ sources: sources(), read: (u) => (u.startsWith('/api/history/web-1/') ? [200, { state: TASK_DETAILS.failed.state }] : null) });
  await go(w, '#running/h3', 80);
  assert.equal(w.location.hash, '#run/h3');
  await go(w, '#history/web-1/h3', 80);
  assert.equal(w.location.hash, '#run/h3');
});

test('a reply that lands after another task opened never touches that page: no strip, no dialog, no toast', async () => {
  const { PR_URL } = await import('./helpers/stillhet-live-fixture.mjs');
  const s = sources(); s.history.pipelines.find((p) => p.id === 'h2').pr = { url: PR_URL, state: 'OPEN' };
  let release;
  const read = (u) => (u === '/api/history/web-1/h2' ? [200, { state: TASK_DETAILS.approved.state }]
    : u === '/api/history/web-1/h3' ? [200, { state: TASK_DETAILS.failed.state }]
    : u.startsWith('/api/pr/checks?id=h2') ? [200, TASK_DETAILS.approved.checks] : null);
  const { w, d } = await liveHost({ sources: s, read, write: () => new Promise((r) => { release = () => r([200, { merged: true, pr: { url: PR_URL, state: 'MERGED' }, next: null }]); }) });
  await go(w, '#run/h2', 200);
  d.querySelector('#card [data-key="act-main"]').click(); await settle(40);
  d.querySelector('#card [data-confirm="yes"]').click(); await settle(40);
  await go(w, '#run/h3', 200);
  assert.equal(d.querySelector('#card [data-title]').textContent, 'Broke');
  release(); await settle(120);
  const page = d.querySelector('#route-run').textContent;
  assert.doesNotMatch(page, /Could not merge|Merged #959/);
  assert.equal(d.querySelector('#card [data-confirm="yes"]'), null, 'no strip opened on the other task');
  assert.doesNotMatch([...d.querySelectorAll('.rc-toast, [role="status"]')].map((x) => x.textContent).join(' '), /merge/i);
});

test('a store change while a dialog is open keeps the page\'s own state: the cap dialog stays open with its typed value', async () => {
  const { PR_URL } = await import('./helpers/stillhet-live-fixture.mjs');
  const s = sources(); s.history.pipelines.find((p) => p.id === 'h2').pr = { url: PR_URL, state: 'OPEN' }; s.history.pipelines.find((p) => p.id === 'h1').pauseReason = 'cost_pipeline';
  const read = (u) => (u === '/api/history/web-1/h1' ? [200, { state: TASK_DETAILS.capped.state }] : u.startsWith('/api/pr/checks?id=h2') ? [200, TASK_DETAILS.approved.checks] : null);
  const { w, d } = await liveHost({ sources: s, read });
  await go(w, '#run/h1', 150);
  d.querySelector('#card [data-key="act-main"]').click(); await settle(20);
  const f = d.querySelector('#fd-value'); f.value = '$40'; f.dispatchEvent(new w.Event('input', { bubbles: true }));
  await settle(600);   // h2's checks land and the store redraws its rows meanwhile
  assert.equal(w.RailWorld.find('h2').case, 'approved', 'the store did change');
  assert.equal(d.querySelector('#fd-value')?.value, '$40', 'the dialog is still open with what was typed');
});
