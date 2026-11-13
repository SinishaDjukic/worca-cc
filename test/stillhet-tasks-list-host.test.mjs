// test/stillhet-tasks-list-host.test.mjs — D17, Step 8: the bar's row menu and bulk bar and the Tasks center's card actions
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

test('New task…: every drawn picker reaches the posted body; Agent, sync and PR keep the project\'s own setup until picked; No project sends noProject (correctness-5-6, fit-5-1)', async () => {
  const branches = (u) => (u.startsWith('/api/branches?projectDir=') ? [200, { branches: ['dev', 'main', 'feat/x'], current: 'dev' }] : null);
  const { w, d, calls } = await liveHost({ sources: sources(), read: branches, write: (u) => (u === '/api/run' ? [200, { runId: 'r-new' }] : [200, {}]) });
  await go(w, '#runs', 120);
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(60);
  const picks = (id) => [...d.querySelectorAll(`#center-dlg [data-menu-pick^="f-${id}|"]`)].map((x) => x.dataset.menuPick.slice(`f-${id}|`.length));
  const open = async (id) => { d.querySelector(`#center-dlg [data-menu="f-${id}"]`).click(); await settle(20); };
  const pick = async (id, v) => { await open(id); d.querySelector(`#center-dlg [data-menu-pick="f-${id}|${v}"]`).click(); await settle(20); };
  await open('workflow'); assert.deepEqual(picks('workflow'), ['Shaper', 'Lean'], 'dev\'s own workflows, never the demo\'s'); await open('workflow');
  await open('agent'); assert.deepEqual(picks('agent'), ['the project\'s default', 'Claude Code', 'OpenAI Codex', 'GitHub Copilot', 'Cursor', 'Gemini CLI', 'Goose', 'OpenCode', 'Qwen Code']); await open('agent');
  await open('base'); assert.deepEqual(picks('base'), ['its default branch', 'dev', 'main', 'feat/x'], 'the project\'s own branches'); await open('base');
  await open('then'); assert.deepEqual(picks('then'), ['as the project is set up', 'open a PR', 'leave it on the branch'], 'no auto-merge: dev has none at start'); await open('then');
  await open('source'); assert.deepEqual(picks('source'), ['as the project is set up', 'the latest version from origin', 'my local copy']); await open('source');
  d.querySelector('#center-dlg [data-c-more]').click(); await settle(20);
  assert.doesNotMatch(d.querySelector('#center-dlg .cc-more').textContent, /Agents:/, 'a workflow whose agents are not known offers no per-step pick');
  assert.match(d.querySelector('#center-dlg .cc-more').textContent, /Cost cap:/, 'the run\'s own cap');
  const type = () => { const t = d.querySelector('#cc-text'); t.value = 'Add a pager'; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const start = () => [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start task').click();
  type(); start(); await settle(100);
  let run = sent(calls).filter(([, u]) => u === '/api/run').pop();
  assert.deepEqual([run[2].workflowId, 'engine' in run[2], run[2].sourceBranch, 'syncBeforeStart' in run[2], 'pr' in run[2], 'costCapUsd' in run[2]], [undefined, false, undefined, false, false, false],
    'the defaults: dev\'s default workflow and engine on the project\'s own branch; its sync, PR and cap as the project is set up');
  await go(w, '#runs', 60);
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(60);
  type();
  await pick('workflow', 'Lean'); await pick('agent', 'OpenAI Codex'); await pick('base', 'feat/x'); await pick('source', 'my local copy'); await pick('then', 'leave it on the branch');
  d.querySelector('#center-dlg [data-c-more]').click(); await settle(20); await pick('cap', 'at $5');
  start(); d.querySelector('#center-dlg [data-dialog="yes"]').click(); await settle(100);   // pressed again while it starts (Starting…)
  const all = sent(calls).filter(([, u]) => u === '/api/run');
  run = all.pop();
  assert.deepEqual([run[2].workflowId, run[2].engine, run[2].sourceBranch, run[2].syncBeforeStart, run[2].pr, run[2].costCapUsd], ['wf_lean', 'codex', 'feat/x', false, { open: 'none' }, 5]);
  assert.equal(all.length, 1, 'a second press while it starts posts nothing');
  await go(w, '#runs', 60);
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(60);
  type(); await pick('project', 'No project'); start(); await settle(100);
  run = sent(calls).filter(([, u]) => u === '/api/run').pop();
  assert.deepEqual([run[2].noProject, 'projectDir' in run[2]], [true, false], 'No project is dev\'s noProject');
});

test('New task…\'s Agents is dev\'s per-run pick: one model for every agent node of the workflow, sent as overlay.nodes (R-po-4)', async () => {
  const flows = { workflows: [{ id: 'wf_default', name: 'Default', nodes: [{ id: 'n_plan', kind: 'agent' }, { id: 'n_gate', kind: 'gate' }, { id: 'n_impl', kind: 'agent' }] }, { id: 'wf_auto', name: 'Auto', auto: true, nodes: [] }] };
  const { w, d, calls } = await liveHost({ sources: sources(), read: (u) => (u === '/api/workflows' ? [200, flows] : null), write: (u) => (u === '/api/run' ? [200, { runId: 'r-new' }] : [200, {}]) });
  await go(w, '#runs', 120);
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(60);
  const t = d.querySelector('#cc-text'); t.value = 'Add a pager'; t.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('#center-dlg [data-c-more]').click(); await settle(20);
  const picks = (id) => [...d.querySelectorAll(`#center-dlg [data-menu-pick^="f-${id}|"]`)].map((x) => x.dataset.menuPick.slice(`f-${id}|`.length));
  const open = async (id) => { d.querySelector(`#center-dlg [data-menu="f-${id}"]`).click(); await settle(20); };
  await open('agents');
  assert.deepEqual(picks('agents'), ['the workflow\'s own', 'Opus 5.5 for every step', 'Sonnet 5.5 for every step'], 'dev\'s models for the run\'s engine, never the demo\'s');
  d.querySelector('#center-dlg [data-menu-pick="f-agents|Sonnet 5.5 for every step"]').click(); await settle(20);
  [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start task').click(); await settle(100);
  const run = sent(calls).filter(([, u]) => u === '/api/run').pop();
  assert.deepEqual(run[2].overlay, { nodes: { n_plan: { model: 'sonnet' }, n_impl: { model: 'sonnet' } } });
  // Auto decides its agents at start: no Agents pick, and a pick made before falls back to the workflow's own
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(60);
  d.querySelector('#center-dlg [data-c-more]').click(); await settle(20);
  await open('workflow'); d.querySelector('#center-dlg [data-menu-pick="f-workflow|Auto"]').click(); await settle(20);
  assert.doesNotMatch(d.querySelector('#center-dlg .cc-more').textContent, /Agents:/);
});

test('New task… from a file: a refused start sits under the From file field, and keeps the path typed', async () => {
  const { w, d } = await liveHost({ sources: sources(), write: (u) => (u === '/api/run' ? [403, { error: 'total cost limit reached' }] : [200, {}]) });
  await go(w, '#runs', 120);
  w.RailCenters.maker('tasks')?.newPick?.('form'); await settle(40);
  d.querySelector('#center-dlg [data-c-src]:not([data-c-src="write"])').click(); await settle(20);
  const p = d.querySelector('#cc-path'); p.value = 'docs/task.md'; p.dispatchEvent(new w.Event('input', { bubbles: true }));
  [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start task').click(); await settle(100);
  const field = d.querySelector('#cc-path');
  assert.equal(field.value, 'docs/task.md');
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  assert.match(d.querySelector('#cc-path-note')?.textContent || '', /Could not start the task: total cost limit reached/);
});

test('a saved task whose open PR the checks cache reads approved offers Merge on its center card (R-arch-11)', async () => {
  const { TASK_DETAILS, PR_URL } = await import('./helpers/stillhet-live-fixture.mjs');
  const s = sources(); s.history.pipelines.find((p) => p.id === 'h2').pr = { url: PR_URL, state: 'OPEN' };
  const { w, d } = await liveHost({ sources: s, read: (u) => (u.startsWith('/api/pr/checks?id=h2') ? [200, TASK_DETAILS.approved.checks] : null) });
  await go(w, '#runs', 900);
  assert.equal(w.RailWorld.find('h2').case, 'approved', 'the row reads the same entry as the page');
  assert.ok(d.querySelector('#route-runs [data-c-act="merge|h2"]'), 'the card offers Merge');
});

// h2's PR approved, h5's failing 2 of 5 (alone in its project, as the review's repro): the task page's own fixtures (test/stillhet-tasks-actions-host.test.mjs)
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

test('Merge on a center card asks first, as the task page does: nothing is sent until Merge PR in its strip; Cancel sends nothing (web-UI review cycle 3)', async () => {
  const { w, d, calls } = await prCenter();
  d.querySelector('#route-runs [data-c-act="merge|h2"]').click(); await settle(60);
  assert.deepEqual(sent(calls), [], 'a merge cannot be undone: it asks first');
  assert.match(strip(d)?.textContent || '', /Merge #959 into dev\?/, 'the task page\'s own words, with the task\'s PR and base');
  assert.equal(d.activeElement, strip(d).querySelector('[data-confirm="yes"]'));
  strip(d).querySelector('[data-confirm="no"]').click(); await settle(60);
  assert.equal(strip(d), null);
  assert.deepEqual(sent(calls), []);
  assert.equal(d.activeElement, d.querySelector('#route-runs [data-c-act="merge|h2"]'), 'Cancel goes back to the card\'s Merge');
  d.querySelector('#route-runs [data-c-act="merge|h2"]').click(); await settle(60);
  strip(d).querySelector('[data-confirm="yes"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/pr/merge', { id: 'h2', projectKey: 'web-1' }]]);
  assert.equal(strip(d), null);
  assert.ok(w.RailWorld.find('h2'));
});

test('a failing-checks task\'s center card says what the task page says and offers its Fix checks, confirmed first (web-UI review cycle 3)', async () => {
  const { w, d, calls } = await prCenter();
  assert.equal(w.RailWorld.find('h5').case, 'failing');
  const page = w.RailTaskLive.detail('h5');
  const card = [...d.querySelectorAll('#route-runs .pg-grid > *')].find((c) => /Red CI/.test(c.textContent));
  assert.ok(card, 'the card');
  assert.match(card.textContent, /Red CI: 2 of 5 checks failing/, 'the page\'s own why, never "Finished"');
  assert.ok(page.why.includes('✗ 2 of 5 checks failing'));
  assert.doesNotMatch(card.textContent, /Finished/);
  const fix = card.querySelector('[data-c-act="fix-checks|h5"]');
  assert.equal(fix?.textContent.trim(), 'Fix checks');
  fix.click(); await settle(60);
  assert.deepEqual(sent(calls), []);
  assert.match(strip(d)?.textContent || '', /Fix the 2 failing checks on #959\?/);
  strip(d).querySelector('[data-confirm="yes"]').click(); await settle(120);
  assert.deepEqual(sent(calls), [['POST', '/api/pr/fix-checks', { id: 'h5', projectKey: 'web-1' }]]);
});

test('dev\'s #feature/ID and #group/ID bookmarks open the group\'s page; a group dev does not hold says it no longer exists', async () => {
  const { w, d } = await liveHost({ sources: sources(), read: (u) => (u === '/api/run-groups' ? [200, { groups: [] }] : null) });
  for (const [hash, to] of [['#feature/f1', '#run/group:f1'], ['#group/g1', '#run/group:g1']]) {
    await go(w, hash, 200);
    assert.equal(w.location.hash, to, hash);
    assert.match(d.body.textContent, /This task no longer exists/, hash);
  }
});

test('a user group\'s task offers Remove from group in the live list, and it sends dev\'s member DELETE; its Undo posts the token (correctness-5-5)', async () => {
  const groups = { groups: [{ id: 'G1', kind: 'user', title: 'Audit log', members: [{ position: 2, pipelineId: 'h3', adhoc: true }, { position: 1, pipelineId: 'h1', adhoc: true }], cost: { usd: 1 } }] };   // led by the capped task: a Failed group starts folded
  const { w, d, calls } = await liveHost({ sources: sources(), read: (u) => (u === '/api/run-groups' ? [200, groups] : null), write: () => [200, { ok: true, undo: 'u1' }] });
  await go(w, '#runs', 200);
  [...d.querySelectorAll('[data-menu^="row:"]')].find((b) => b.dataset.menu === 'row:run:h3').click(); await settle(30);
  assert.ok(d.querySelector('[data-menu-pick="row:run:h3|leave-group"]'), 'Remove from group is offered');
  d.querySelector('[data-menu-pick="row:run:h3|leave-group"]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['DELETE', '/api/run-groups/members/h3', undefined]]);
  assert.match(d.querySelector('.rc-toast.is-on')?.textContent || '', /Removed from Audit log/);
  const undo = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Undo');
  assert.ok(undo, 'the toast carries Undo'); undo.click(); await settle(80);
  assert.deepEqual(sent(calls).at(-1), ['POST', '/api/run-groups/undo', { token: 'u1' }]);
});
