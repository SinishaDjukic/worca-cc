// test/stillhet-tasks-list-host-1.test.mjs — D17, Step 8: the bar's row menu and bulk bar and the Tasks center's card actions
// Part 1 of 2: split to stay under CI's 300 s per file.
// call dev's routes in the live kind; the center shows the list's loading and failed looks and never "No tasks yet." while
// the first load is out. Live app host (jsdom).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts, toastText } from './helpers/stillhet-chat-live-host.mjs';
import { URLS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const sources = () => { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; };
const sent = (calls) => posts(calls).filter(([, u]) => !/^\/api\/ask\//.test(u));
async function rowPick(w, d, id, item) {
  [...d.querySelectorAll('[data-menu^="row:"]')].find((b) => b.dataset.menu === `row:run:${id}`).click(); await settle(30);
  d.querySelector(`[data-menu-pick="row:run:${id}|${item}"]`).click(); await settle(60);
}
const confirmYes = async (d) => { const b = [...d.querySelectorAll('button')].find((x) => /^(Stop|Delete) \d/.test(x.textContent.trim())); b.click(); await settle(80); };
async function prCenter(write = () => [200, { ok: true }]) {
  const { TASK_DETAILS, PR_URL } = await import('./helpers/stillhet-live-fixture.mjs');
  const s = sources(), h2 = s.history.pipelines.find((p) => p.id === 'h2'); h2.pr = { url: PR_URL, state: 'OPEN' };
  s.history.pipelines.push({ id: 'h5', title: 'Red CI', status: 'done', projectName: 'billing', projectKey: 'web-1', startedAt: h2.startedAt, mtime: h2.mtime, pr: { url: PR_URL, state: 'OPEN', checks: 'failing' } });
  const C = { h2: TASK_DETAILS.approved.checks, h5: TASK_DETAILS.failing.checks };
  const h = await liveHost({ sources: s, write, read: (u) => { const c = /^\/api\/pr\/checks\?id=(\w+)/.exec(u); return c && C[c[1]] ? [200, C[c[1]]] : null; } });
  await go(h.w, '#runs', 900);
  return h;
}
const strip = (d) => d.querySelector('#route-runs .rc-confirm');

test('a row\'s Archive posts dev\'s bulk archive; its Undo restores through the bulk route, which needs no project', async () => {
  const { w, d, calls } = await liveHost({ sources: sources(), write: () => [200, { done: [{ pipelineId: 'h3' }], skipped: [] }] });
  await go(w, '#runs', 150);
  await rowPick(w, d, 'h3', 'archive');
  assert.deepEqual(sent(calls), [['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'h3' }] }]]);
  const undo = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Undo');
  assert.ok(undo, 'the toast carries Undo'); undo.click(); await settle(80);
  assert.deepEqual(sent(calls).at(-1), ['POST', '/api/runs/bulk', { action: 'restore', targets: [{ pipelineId: 'h3' }] }]);
});

test('a row\'s Delete asks first, then sends dev\'s bulk delete (its purge; DELETE /api/runs/:id only archives)', async () => {
  const { w, d, calls } = await liveHost({ sources: sources(), write: () => [200, { done: [{ pipelineId: 'h3' }], skipped: [] }] });
  await go(w, '#runs', 150);
  await rowPick(w, d, 'h3', 'delete');
  assert.deepEqual(sent(calls), [], 'nothing before the confirm');
  await confirmYes(d);
  assert.deepEqual(sent(calls), [['POST', '/api/runs/bulk', { action: 'delete', targets: [{ pipelineId: 'h3' }] }]]);
});

test('a live row\'s Stop asks first, then posts /api/stop with its run id', async () => {
  const { w, d, calls } = await liveHost({ sources: sources() });
  await go(w, '#runs', 150);
  await rowPick(w, d, 'run-b', 'stop');
  await confirmYes(d);
  assert.deepEqual(sent(calls), [['POST', '/api/stop', { runId: 'run-b' }]]);
});

test('a refused row action says Could not ACTION: REASON and moves nothing', async () => {
  const { w, d, calls } = await liveHost({ sources: sources(), write: () => [409, { error: 'a terminal still has the worktree open' }] });
  await go(w, '#runs', 150);
  const before = JSON.stringify(w.RailWorld.data());
  await rowPick(w, d, 'h3', 'archive');
  assert.equal(toastText(d), 'Could not archive the tasks: a terminal still has the worktree open');
  assert.equal(JSON.stringify(w.RailWorld.data()), before);
  assert.equal(sent(calls).length, 1);
});

test('the center\'s card actions run the same routes: Resume on a paused task', async () => {
  const { w, d, calls } = await liveHost({ sources: sources() });
  await go(w, '#runs', 150);
  d.querySelector('#route-runs [data-c-act="resume|h1"]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['POST', '/api/resume', { pipelineId: 'h1' }]]);
  assert.doesNotMatch(toastText(d), /not in Stillhet yet/);
});

test('the center shows the list\'s loading look while the first load is out, never "No tasks yet."; then its cards', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { w, d, sockets } = await liveHost({ sources: sources(), hash: '#runs', hold: (u) => (u === URLS.history ? gate : null) });
  await settle(60);
  const center = () => d.querySelector('#route-runs')?.textContent || '';
  assert.match(center(), /Loading tasks…/);
  assert.doesNotMatch(center(), /No tasks yet\./);
  release(); await settle(120);
  sockets.at(-1)?.onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: sources().hello.runs }) }); await settle(60);
  await go(w, '#chat', 30); await go(w, '#runs', 120);
  assert.doesNotMatch(center(), /Loading tasks…/);
});

test('the center\'s failed look has Try again', async () => {
  const s = sources();
  const { w, d } = await liveHost({ sources: s, hash: '#runs', read: (u) => (u === URLS.history ? [500, { error: 'boom' }] : null) });
  await go(w, '#runs', 120);
  const c = d.querySelector('#route-runs');
  assert.match(c.textContent, /Could not load the tasks/);
  assert.ok(c.querySelector('[data-c-retry]'));
});

test('+ › Legacy approach › New task… posts /api/run with the project folder, the prompt, the title and its files, then opens the task', async () => {
  const s = sources();
  const { w, d, calls } = await liveHost({ sources: s, write: (u) => (u === '/api/run' ? [200, { runId: 'r-new' }] : [200, {}]) });
  await go(w, '#runs', 120);
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(40);
  const t = d.querySelector('#cc-text'); t.value = 'Add a pager'; t.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('#center-dlg [data-c-more]').click(); await settle(20);
  const ti = d.querySelector('#cc-title'); ti.value = 'Pager'; ti.dispatchEvent(new w.Event('input', { bubbles: true }));
  // Add files… opens the system file picker (here: one file handed straight back) and never a stand-in toast.
  w.HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file') return;
    Object.defineProperty(this, 'files', { value: [new w.File(['hello'], 'notes.md')] });
    this.dispatchEvent(new w.Event('change'));
  };
  d.querySelector('#center-dlg [data-c-files]').click(); await settle(60);
  assert.match(d.querySelector('#center-dlg .cc-more').textContent, /notes\.md/, 'the picked file shows in the form');
  assert.doesNotMatch(d.body.textContent, /Not connected to Worca yet|Would /);
  const form = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start task');
  assert.ok(form, 'the form\'s start button');
  form.click(); await settle(100);
  const run = sent(calls).find(([, u]) => u === '/api/run');
  assert.ok(run, JSON.stringify(sent(calls)));
  assert.equal(run[2].prompt, 'Add a pager');
  assert.equal(run[2].title, 'Pager');
  assert.deepEqual(run[2].extras, [{ name: 'notes.md', dataBase64: Buffer.from('hello').toString('base64') }], 'the file goes as dev\'s New run sends it');
  assert.ok(s.projects.projects.some((p) => p.path === run[2].projectDir), `the picked project's folder: ${run[2].projectDir}`);
  assert.equal(w.location.hash, '#run/r-new');
});
