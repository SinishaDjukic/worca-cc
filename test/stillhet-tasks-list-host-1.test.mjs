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
  // the toast counts what dev archived, not what was asked
  const h = await liveHost({ sources: sources(), write: () => [200, { done: [], skipped: [{ pipelineId: 'h3', reason: 'running' }] }] });
  await go(h.w, '#runs', 150);
  await rowPick(h.w, h.d, 'h3', 'archive');
  assert.doesNotMatch(h.d.body.textContent, /Archived 1/, 'nothing archived, nothing claimed');
  assert.match(h.d.body.textContent, /Could not archive/, 'dev\'s refusal instead');
  // an interrupted task can still be resumed: Archive asks first, in the library's Archive words
  const ps = sources(); ps.history.pipelines.find((x) => x.id === 'h1').status = 'interrupted';
  const p = await liveHost({ sources: ps, write: () => [200, { done: [{ pipelineId: 'h1' }], skipped: [] }] });
  await go(p.w, '#runs', 150);
  await rowPick(p.w, p.d, 'h1', 'archive');
  assert.deepEqual(sent(p.calls), [], 'nothing before the confirm');
  assert.match(p.d.body.textContent, /It cannot be resumed after this/);
  [...p.d.querySelectorAll('button')].find((x) => /^Archive 1$/.test(x.textContent.trim())).click(); await settle(80);
  assert.deepEqual(sent(p.calls), [['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'h1' }] }]]);
  assert.match(p.d.body.textContent, /Archived 1 task/);
});

test('Bulk Label follows dev\'s runLabels flag (the hello and flags frames)', async () => {
  const { w, d, sockets } = await liveHost({ sources: sources() });
  await go(w, '#runs', 150);
  // the bulk bar's actions, with every row picked
  // the bulk bar's actions, with a row picked (Ctrl-click, as the chat list's bulk test)
  const labelItem = async () => { if (!d.querySelector('[data-bulk]')) { d.querySelector('[data-open="run:h3"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, ctrlKey: true, metaKey: true })); await settle(40); } assert.ok(d.querySelector('[data-bulk]'), 'the bulk bar is up'); return !!d.querySelector('[data-bulk="label"]'); };
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { runLabels: true } }) }); await settle(40);
  assert.equal(await labelItem(), true);
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'flags', flags: { runLabels: false } }) }); await settle(40);
  assert.equal(await labelItem(), false, 'runLabels off: no Label');
});

test('a row\'s Delete asks first, then sends dev\'s bulk delete (its purge; DELETE /api/runs/:id only archives)', async () => {
  const { w, d, calls } = await liveHost({ sources: sources(), write: () => [200, { done: [{ pipelineId: 'h3' }], skipped: [] }] });
  await go(w, '#runs', 150);
  await rowPick(w, d, 'h3', 'delete');
  assert.deepEqual(sent(calls), [], 'nothing before the confirm');
  assert.match(d.body.textContent, /Deletes the task records, their files and local branches\. Keeps remote branches, pull requests/, 'it says what goes and what stays, in dev\'s words');
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
  assert.deepEqual(sent(calls), [['POST', '/api/resume', { pipelineId: 'h1', baseCheck: true }]]);
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

test('F-3-09: the Tasks center by workflow groups tasks under their own workflow, the rest under Default', async () => {
  const s = sources(), h3 = s.history.pipelines.find((p) => p.id === 'h3');
  const at = { status: 'error', projectName: 'api', projectKey: 'web-1', startedAt: h3.startedAt, mtime: Date.parse(h3.startedAt) };
  s.history.pipelines = [{ ...at, id: 'w1', title: 'Lean one', workflowId: 'wf_lean', workflowName: 'Lean' }, { ...at, id: 'w2', title: 'Lean two', workflowId: 'wf_lean', workflowName: 'Lean' }, { ...at, id: 'w3', title: 'Plain one' }];
  s.hello.runs = []; s.schedules = { schedules: [] };
  const { w, d } = await liveHost({ sources: s });
  await go(w, '#runs', 150);
  const center = () => d.querySelector('#route-runs');
  center().querySelector('[data-menu="c-by"]').click(); await settle(20);
  center().querySelector('[data-menu-pick="c-by|workflow"]').click(); await settle(40);
  // every task here is finished, so the groups start folded under the quiet line: open it
  assert.equal(center().querySelectorAll('.pg-card').length, 0, 'the finished groups start folded');
  center().querySelector('[data-c-quiet]').click(); await settle(40);
  const cards = () => [...center().querySelectorAll('.pg-card')];
  assert.deepEqual(cards().map((c) => c.querySelector('.pg-t').textContent).sort(), ['Default', 'Lean']);
  // the list as the card's Open leaves it: its "using" word and how many tasks its sections hold
  const shown = () => { const r = d.getElementById('runs-root'); return { using: r.querySelector('[data-menu="workflow"]')?.textContent || '', n: [...r.querySelectorAll('.list-group .list-h .n')].reduce((a, e) => a + Number(e.textContent), 0) }; };
  const open = async (name) => { const card = cards().find((c) => c.querySelector('.pg-t').textContent === name); card.querySelector('[data-c-filter]').click(); await settle(60); };
  await open('Lean');
  assert.deepEqual(shown(), { using: 'Lean', n: 2 }, 'the Lean card opens its 2 tasks');
  await go(w, '#runs', 60);
  const facts = (name) => cards().find((c) => c.querySelector('.pg-t').textContent === name).getAttribute('title');
  assert.equal(facts('Lean'), '2 finished');
  assert.equal(facts('Default'), '1 finished', 'a task with no workflow is under Default');
});

test('F-a4-07: the Showing menu\'s archived count is the API\'s archived rows; picking Archived lists them and reads /api/history?archived=1 again', async () => {
  const s = sources(), h3 = s.history.pipelines.find((p) => p.id === 'h3');
  s.archived = { pipelines: ['x1', 'x2', 'x3'].map((id) => ({ ...h3, id, title: `Arch ${id}`, archived: true })) };
  const { w, d, calls } = await liveHost({ sources: s });
  await go(w, '#runs', 150);
  const root = d.querySelector('#runs-root');   // the bar's Tasks list
  root.querySelector('[data-menu="show"]').click(); await settle(20);
  const item = root.querySelector('[data-pick="show|archived"]');
  assert.ok(item, 'the Showing menu offers Archived');
  assert.match(item.textContent.trim(), /3$/, `the archived count is the API's (${item.textContent.trim()})`);
  const n = calls.filter((c) => c.method === 'GET' && c.url === URLS.archived).length;
  item.click(); await settle(400);
  for (const id of ['x1', 'x2', 'x3']) assert.ok(root.querySelector(`[data-open="run:${id}"]`), `${id} is listed`);
  assert.ok(!root.querySelector('[data-open="run:h3"]'), 'an active row is not');
  assert.equal(calls.filter((c) => c.method === 'GET' && c.url === URLS.archived).length, n + 1, 'the view\'s opening reads the archived feed once');
});

test('F-a4-07 (review minor): a failing archived read leaves the Tasks list drawn; the Archived view says it could not load, and its Try again reads only the archived feed', async () => {
  let fail = true;
  const s = sources(), h3 = s.history.pipelines.find((p) => p.id === 'h3');
  s.archived = { pipelines: [{ ...h3, id: 'x1', title: 'Arch x1', archived: true }] };
  const { w, d, calls } = await liveHost({ sources: s, read: (u) => (fail && u === URLS.archived ? [500, {}] : null) });
  await go(w, '#runs', 150);
  const root = d.querySelector('#runs-root');
  assert.ok(root.querySelector('[data-open="run:h3"]'), 'the rest of the list draws');
  assert.doesNotMatch(root.textContent, /Could not load/);
  root.querySelector('[data-menu="show"]').click(); await settle(20);
  root.querySelector('[data-pick="show|archived"]').click(); await settle(400);
  assert.match(root.textContent, /Could not load the tasks/, 'the Archived view says it could not load');
  const again = [...root.querySelectorAll('[data-retry]')].find((b) => b.textContent.trim() === 'Try again');
  assert.ok(again, 'with Try again');
  fail = false;
  const n = calls.length;
  again.click(); await settle(400);
  assert.deepEqual(calls.slice(n).filter((c) => c.method === 'GET').map((c) => c.url), [URLS.archived], 'Try again reads the archived feed alone');
  assert.ok(root.querySelector('[data-open="run:x1"]'), 'the archived row shows');
  assert.doesNotMatch(root.textContent, /Could not load/);
});
