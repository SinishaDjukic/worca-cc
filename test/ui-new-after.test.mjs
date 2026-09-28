// New pipeline with a predecessor (run chains): #new/after/<id> preselects the target and the pick,
// "Branch of the run before it" leads the Source branch select, the submit carries after +
// sourceFromPrevious, run branches are grouped in the picker, and workspace mode uses the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }, { name: 'svc-ui', path: '/a/svc-ui', exists: true }, { name: 'svc-empty', path: '/a/svc-empty', exists: true }];
const WORKSPACES = [
  { id: 'ws_1', name: 'Alpha WS', description: '# x', projectPaths: ['/a/svc-iam', '/a/svc-ui'],
    projectKeys: ['svc-iam-aaaa1111', 'svc-ui-bbbb2222'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
  // No members: renderWorkspaceSourceBranches takes its early return and the single select stays as a disabled stand-in.
  { id: 'ws_2', name: 'Empty WS', description: '', projectPaths: [], projectKeys: [], exists: [], createdAt: 'x', updatedAt: 'x' },
];
const BRANCHES = {
  '/a/svc-iam': { branches: ['main', 'worca/refactor-p1'], current: 'main', runs: [{ branch: 'worca/refactor-p1', pipelineId: 'p1', title: 'Refactor', status: 'running', endedAt: null }] },
  // A second project WITH branches: switching to it takes populateBranchSelect's full rebuild, whose
  // tail is the one place the option is re-applied after the list is rebuilt.
  '/a/svc-ui': { branches: ['dev'], current: 'dev', runs: [] },
  // …and one WITHOUT: that switch takes the `!branches.length` early return, which has its own copy.
  '/a/svc-empty': { branches: [], current: '', runs: [] },
};
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));
// boot()'s fixed 60 ms budget can expire before the deliberately SLOW (25 ms) branch fetch lands,
// which flakes under parallel test load. Wait for the rebuilt list instead of a fixed delay.
async function branchesReady(doc) {
  for (let i = 0; i < 200 && !doc.getElementById('sourceBranch').dataset.current; i++) await tick(5);
}

async function boot(hash) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash}` });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const runBodies = []; const calls = [];
  const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
  // The branch fetch resolves LATE on purpose: the previous-run option must be re-applied
  // after populateBranchSelect rebuilds the list, not only before it.
  const slow = (data) => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => data }), 25));
  window.fetch = (url, opts) => {
    const u = String(url); calls.push(u);
    // SLOW on purpose (like /api/branches): GET /api/schedules/after/:id is a sync DB read on the server and
    // answers before the async registry read — openAfterForNew must wait for the project list, not judge [].
    if (u.includes('/api/projects')) return slow({ projects: PROJECTS });
    if (u.includes('/api/workspaces')) return json({ workspaces: WORKSPACES });
    if (u.includes('/api/schedules/after/p1')) return json({ kind: 'pipeline', id: 'p1', title: 'Refactor', status: 'running', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after/e1')) return json({ kind: 'pipeline', id: 'e1', title: 'Broken', status: 'error', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after/w2')) return json({ kind: 'pipeline', id: 'w2', title: 'Empty run', status: 'done', projectDir: null, workspaceId: 'ws_2' });
    if (u.includes('/api/schedules/after/w1')) return json({ kind: 'pipeline', id: 'w1', title: 'Ws run', status: 'done', projectDir: null, workspaceId: 'ws_1' });
    // A ticket predecessor always answers with ITS projectDir, registered or not — the form must say so.
    if (u.includes('/api/schedules/after/t9')) return json({ kind: 'ticket', id: 't9', title: 'Elsewhere', status: 'scheduled', projectDir: '/a/not-registered', workspaceId: null });
    if (u.includes('/api/schedules/after/t8')) return json({ kind: 'ticket', id: 't8', title: 'Gone', status: 'canceled', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after-candidates')) return json({ runs: [{ pipelineId: 'p1', runId: 'r1', title: 'Refactor', status: 'running' }], tickets: [] });
    if (u.includes('/api/branches')) {
      const dir = decodeURIComponent(new URL(u, 'http://x').searchParams.get('projectDir') || '');
      return slow(BRANCHES[dir] || { branches: [], current: '', runs: [] });
    }
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') { const body = JSON.parse(opts.body); runBodies.push(body); return json({ runId: 'r-2', status: 'scheduled', scheduledFor: null, after: body.after }, 202); }
    if (u.includes('/api/schedules')) return json({ schedules: [], tickets: [], counts: { scheduled: 0, missed: 0, recurring: 0, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 } });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(60);
  return { window, runBodies, calls };
}

test('#new/after/p1: the pick waits on the form, the branch select leads with the previous run, the submit carries both', async () => {
  const { window, runBodies } = await boot('#new/after/p1');
  const doc = window.document;
  await branchesReady(doc);
  assert.equal(window.location.hash, '#new');
  assert.equal(doc.getElementById('new-sched').hidden, false);
  assert.equal(doc.getElementById('new-sched-badge').textContent, 'After run');
  assert.equal(doc.getElementById('new-sched-text').textContent, 'Starts when ‘Refactor’ finishes');
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Schedule');
  const sel = doc.getElementById('sourceBranch');
  assert.equal(sel.options[0].value, '__previous__');
  assert.equal(sel.options[0].textContent, 'Branch of the run before it');
  assert.equal(sel.value, '__previous__', 'selected by default on an after-pick');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Branches', 'Run branches']);
  assert.equal(sel.querySelector('optgroup[label="Run branches"] option').textContent, 'worca/refactor-p1 — Refactor · running');
  assert.equal(sel.querySelector('optgroup[label="Branches"] option[value="worca/refactor-p1"]'), null, 'not repeated under Branches');
  doc.getElementById('prompt').value = 'Add tests';
  doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal(runBodies.length, 1);
  assert.deepEqual(runBodies[0].after, { kind: 'pipeline', id: 'p1', title: 'Refactor' });
  assert.equal(runBodies[0].afterPolicy, 'done');
  assert.equal(runBodies[0].sourceFromPrevious, true);
  assert.equal('sourceBranch' in runBodies[0], false);
});

test('Start now instead drops the pick and the previous-run option', async () => {
  const { window } = await boot('#new/after/p1');
  const doc = window.document;
  await branchesReady(doc);
  doc.getElementById('new-sched-clear').click();
  await tick();
  const sel = doc.getElementById('sourceBranch');
  assert.equal([...sel.options].some((o) => o.value === '__previous__'), false);
  assert.equal(sel.value, 'main', 'back to the current branch');
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Start run');
});

test('#new/after/w1: a workspace predecessor shows the switch, disables the member selects, and submits the flag', async () => {
  const { window, runBodies } = await boot('#new/after/w1');
  const doc = window.document;
  await tick(30);
  assert.equal(doc.getElementById('ws-source-previous-row').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('ws-source-previous').classList.contains('on'), true);
  const members = [...doc.querySelectorAll('#ws-source-branches select.ws-src-select')];
  assert.equal(members.length, 2);
  assert.ok(members.every((s) => s.disabled), 'the per-member picks are taken over by the previous run');
  assert.ok(members.every((s) => ![...s.options].some((o) => o.value === '__previous__')), '__previous__ never appears on a member select');
  assert.equal([...doc.getElementById('sourceBranch').options].some((o) => o.value === '__previous__'), false, 'nor on the disabled stand-in the single select becomes in workspace mode');
  // Toggling the switch off hands the member selects back. (Checked BEFORE the submit: a 202
  // calls setPendingSchedule(null), which already drops the pick and turns the switch off.)
  doc.getElementById('ws-source-previous').click();
  await tick();
  assert.ok([...doc.querySelectorAll('#ws-source-branches select.ws-src-select')].every((s) => !s.disabled));
  doc.getElementById('ws-source-previous').click();
  await tick();
  doc.getElementById('prompt').value = 'Add tests';
  doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal(runBodies.length, 1);
  assert.equal(runBodies[0].after.id, 'w1');
  assert.equal(runBodies[0].sourceFromPrevious, true);
  assert.equal('sourceBranchByKey' in runBodies[0], false);
  assert.equal(doc.getElementById('ws-source-previous').classList.contains('on'), false, 'the 202 drops the pick');
});

test('the previous-run option survives a branch rebuild for another project', async () => {
  // The tail `syncPreviousBranchOption(select)` in populateBranchSelect is the only thing that
  // re-applies the option after a rebuild — switching projects with the pick pending kills it.
  const { window } = await boot('#new/after/p1');
  const doc = window.document;
  await branchesReady(doc);
  const sel = doc.getElementById('sourceBranch');
  const projects = doc.getElementById('projectSelect');
  projects.value = '/a/svc-ui';
  projects.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(60);   // the second project's SLOW /api/branches answer rebuilds the option list (the tail)
  assert.equal(sel.options[0].value, '__previous__', 'the option survives a branch rebuild');
  assert.equal(sel.value, '__previous__');
  assert.ok([...sel.options].some((o) => o.value === 'dev'), 'the new project\'s branches are there');
  projects.value = '/a/svc-empty';
  projects.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(60);   // an EMPTY list: the `!branches.length` early return, which carries its own sync
  assert.equal(sel.options[0].value, '__previous__', 'the option survives the empty-list return too');
  assert.equal(sel.value, '__previous__');
});

test('#new/after/t:t9: a predecessor in a project this worca does not know is refused', async () => {
  const { window } = await boot('#new/after/t:t9');
  const doc = window.document;
  await tick(30);
  assert.equal(doc.getElementById('new-sched').hidden, true, 'no pick is made');
  assert.equal(doc.getElementById('form-msg').textContent, 'That run’s project is not registered.');
});

test('#new/after/e1: a predecessor that already ended badly is picked with the any policy', async () => {
  const { window, runBodies } = await boot('#new/after/e1');
  const doc = window.document;
  await branchesReady(doc);
  assert.equal(doc.getElementById('new-sched-text').textContent, 'Starts when ‘Broken’ finishes');
  doc.getElementById('prompt').value = 'Fix it';
  doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal(runBodies[0].afterPolicy, 'any', 'resolveAfterRef would refuse done for an errored run');
});

test('#new/after/t:t8: a ticket predecessor that already ended is refused — nothing to wait for', async () => {
  const { window } = await boot('#new/after/t:t8');
  const doc = window.document;
  await tick(30);
  assert.equal(doc.getElementById('new-sched').hidden, true, 'no pick is made');
  assert.equal(doc.getElementById('form-msg').textContent, '‘Gone’ was canceled — nothing to wait for.');
});

test('#new/after/w1: turning the switch off survives a member re-render', async () => {
  const { window } = await boot('#new/after/w1');
  const doc = window.document;
  await tick(30);
  doc.getElementById('ws-source-previous').click();
  await tick();
  // The workspace select's change handler rebuilds the member selects (enabled) and re-runs the tail sync.
  doc.getElementById('workspaceSelect').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(5);
  assert.equal(doc.getElementById('ws-source-previous').classList.contains('on'), false, 'a deliberate OFF is kept');
  assert.ok([...doc.querySelectorAll('#ws-source-branches select.ws-src-select')].every((s) => !s.disabled), '…and the fresh member selects stay enabled');
});

test('#new/after/w2: a workspace without members keeps the previous-run option OFF the disabled stand-in select', async () => {
  const { window } = await boot('#new/after/w2');
  const doc = window.document;
  await tick(30);
  assert.equal(doc.getElementById('new-sched-badge').textContent, 'After run');
  assert.equal(doc.getElementById('ws-source-previous-row').classList.contains('hidden'), false, 'the switch row is the workspace-mode control');
  assert.equal([...doc.getElementById('sourceBranch').options].some((o) => o.value === '__previous__'), false, 'never on the stand-in the single select becomes in workspace mode');
});
