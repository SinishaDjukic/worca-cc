// New pipeline with a predecessor (run chains): #new/after/<id> preselects the target and the pick,
// "Branch of the run before it" leads the Source branch select, the submit carries after +
// sourceFromPrevious, run branches are grouped in the picker, and workspace mode uses the switch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast, fieldErrorText, cardAlertOf } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }, { name: 'svc-ui', path: '/a/svc-ui', exists: true }, { name: 'svc-empty', path: '/a/svc-empty', exists: true }];
const WORKSPACES = [
  { id: 'ws_1', name: 'Alpha WS', description: '# x', projectPaths: ['/a/svc-iam', '/a/svc-ui'],
    projectKeys: ['svc-iam-aaaa1111', 'svc-ui-bbbb2222'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
  // No members: renderWorkspaceSourceBranches takes its early return and the single select stays as a disabled stand-in.
  { id: 'ws_2', name: 'Empty WS', description: '', projectPaths: [], projectKeys: [], exists: [], createdAt: 'x', updatedAt: 'x' },
  // P5 (annotated vcs): every member a Folder project, and a Git member beside a Folder member.
  { id: 'ws_3', name: 'Folders WS', description: '', projectPaths: ['/f/notes', '/f/docs'], projectKeys: ['notes-cccc3333', 'docs-dddd4444'],
    exists: [true, true], vcs: ['none', 'none'], createdAt: 'x', updatedAt: 'x' },
  { id: 'ws_4', name: 'Mixed WS', description: '', projectPaths: ['/a/svc-iam', '/f/notes'], projectKeys: ['svc-iam-aaaa1111', 'notes-cccc3333'],
    exists: [true, true], vcs: ['git', 'none'], createdAt: 'x', updatedAt: 'x' },
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

async function boot(hash, { withSync = false, runReply = null, seedProject = '', gitOff = false } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  if (gitOff) window.document.documentElement.dataset.git = 'off';   // as the server renders it when git is missing
  // app-js-jsdom-traps: a plain #new restores the project by NAME, and a previous test's workspace choice must not leak in.
  if (seedProject) { window.localStorage.setItem('worca-cc.lastProject', seedProject); window.localStorage.setItem('worca-cc.runTarget', 'project'); }
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
    // A finished run whose branch archive deleted (then restored): the server says branchGone.
    if (u.includes('/api/schedules/after/g1')) return json({ kind: 'pipeline', id: 'g1', title: 'Restored', status: 'done', projectDir: '/a/svc-iam', workspaceId: null, branchGone: true });
    if (u.includes('/api/schedules/after/g2')) return json({ kind: 'pipeline', id: 'g2', title: 'Restored ws', status: 'done', projectDir: null, workspaceId: 'ws_1', branchGone: true });
    if (u.includes('/api/schedules/after/e1')) return json({ kind: 'pipeline', id: 'e1', title: 'Broken', status: 'error', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after/w2')) return json({ kind: 'pipeline', id: 'w2', title: 'Empty run', status: 'done', projectDir: null, workspaceId: 'ws_2' });
    if (u.includes('/api/schedules/after/w3')) return json({ kind: 'pipeline', id: 'w3', title: 'Folders run', status: 'done', projectDir: null, workspaceId: 'ws_3' });
    if (u.includes('/api/schedules/after/w4')) return json({ kind: 'pipeline', id: 'w4', title: 'Mixed run', status: 'done', projectDir: null, workspaceId: 'ws_4' });
    if (u.includes('/api/schedules/after/w1')) return json({ kind: 'pipeline', id: 'w1', title: 'Ws run', status: 'done', projectDir: null, workspaceId: 'ws_1' });
    // A ticket predecessor always answers with ITS projectDir, registered or not — the form must say so.
    if (u.includes('/api/schedules/after/t9')) return json({ kind: 'ticket', id: 't9', title: 'Elsewhere', status: 'scheduled', projectDir: '/a/not-registered', workspaceId: null });
    if (u.includes('/api/schedules/after/t8')) return json({ kind: 'ticket', id: 't8', title: 'Gone', status: 'canceled', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after-candidates')) return json({ runs: [{ pipelineId: 'p1', runId: 'r1', title: 'Refactor', status: 'running' }], tickets: [] });
    if (u.includes('/api/branches')) {
      const q = new URL(u, 'http://x').searchParams;
      const dir = decodeURIComponent(q.get('projectDir') || '');
      const b = BRANCHES[dir] || { branches: [], current: '', runs: [] };
      // withSync: the fresh list names a remote and HEAD's SyncBlock, as GET /api/branches?fresh=1 does.
      if (withSync && q.get('fresh') === '1' && b.current) {
        return slow({ ...b, remote: { name: 'origin', branches: b.branches }, sync: { base: b.current, remote: 'origin', state: 'behind', behind: 2, ahead: 0, stale: false, settings: { beforeRun: true, onDiverged: 'ask' } } });
      }
      return slow(b);
    }
    if (u.endsWith('/api/run') && opts && opts.method === 'POST' && runReply) { const body = JSON.parse(opts.body); runBodies.push(body); const r = runReply(body, runBodies.length); return json(r.data, r.status); }
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
  assert.equal(sel.querySelector('optgroup[label="Run branches"] option').textContent, 'worca/refactor-p1: Refactor · running');
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

test('the Branches row follows the pick without a change event, and Start now instead drops the pick and the previous-run option (#527)', async () => {
  const { window } = await boot('#new/after/p1', { withSync: true });
  const doc = window.document;
  await branchesReady(doc);
  await tick(40);
  await checkRows([
    { name: 'the Branches row follows the value the pick sets without a change event: the run before it, then back to HEAD (#527)', run: async () => {
      const mode = doc.getElementById('branches-mode-wrap');
      const text = () => doc.querySelector('#bt-project-outcome .bt-text')?.textContent || '';
      assert.equal(doc.getElementById('sourceBranch').value, '__previous__');
      assert.equal(mode.hidden, true, 'the previous run\'s branch is not HEAD\'s: nothing to sync');
      assert.equal(text(), 'Starts from the branch of the run before it');
      doc.getElementById('new-sched-clear').click();
      for (let i = 0; i < 100 && mode.hidden; i++) await tick(5);
      assert.equal(doc.getElementById('sourceBranch').value, 'main');
      assert.equal(mode.hidden, false, 'back on HEAD\'s branch: the choice returns');
      assert.equal(text(), 'Gets 2 new commits from origin first');
    } },
    { name: 'Start now instead drops the pick and the previous-run option', run: async () => {
      // The row above clicked "Start now instead"; click it here only if that row stopped before it.
      if (!doc.getElementById('new-sched').hidden) { doc.getElementById('new-sched-clear').click(); await tick(); }
      const sel = doc.getElementById('sourceBranch');
      assert.equal([...sel.options].some((o) => o.value === '__previous__'), false);
      assert.equal(sel.value, 'main', 'back to the current branch');
      assert.equal(doc.getElementById('start-btn-label').textContent, 'Start run');
    } },
  ]);
});

test('#new/after/g1: a predecessor whose branch is gone leaves "Branch of the run before it" out and submits a real source branch', async () => {
  const { window, runBodies } = await boot('#new/after/g1');
  const doc = window.document;
  await branchesReady(doc);
  assert.equal(doc.getElementById('new-sched-text').textContent, 'Starts when ‘Restored’ finishes · its branch is gone, so pick a source branch');
  const sel = doc.getElementById('sourceBranch');
  assert.equal([...sel.options].some((o) => o.value === '__previous__'), false, 'no option that can only fail at fire time');
  assert.equal(sel.value, 'main', 'HEAD’s branch stays selected');
  doc.getElementById('prompt').value = 'Follow up';
  doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal(runBodies.length, 1);
  assert.deepEqual(runBodies[0].after, { kind: 'pipeline', id: 'g1', title: 'Restored' }, 'the form hint never reaches the wire');
  assert.equal(runBodies[0].sourceFromPrevious, undefined);
  assert.equal(runBodies[0].sourceBranch, 'main');
});

test('a workspace predecessor never puts the previous-run option on a disabled or hidden control (g2 branches gone, w2 no members)', async () => {
  await checkRows([
    { name: '#new/after/g2: a workspace predecessor whose branches are gone keeps the switch hidden and off', run: async () => {
      const { window, runBodies } = await boot('#new/after/g2');
      const doc = window.document;
      await tick(30);
      assert.equal(doc.getElementById('ws-source-previous-row').classList.contains('hidden'), true);
      assert.equal(doc.getElementById('ws-source-previous').classList.contains('on'), false);
      assert.ok([...doc.querySelectorAll('#ws-source-branches select.ws-src-select')].every((s) => !s.disabled), 'the member picks stay the person’s');
      doc.getElementById('prompt').value = 'Follow up';
      doc.getElementById('start-btn').click();
      await tick(3);
      assert.equal(runBodies.length, 1);
      assert.equal(runBodies[0].sourceFromPrevious, undefined);
    } },
    { name: '#new/after/w2: a workspace without members keeps the previous-run option OFF the disabled stand-in select', run: async () => {
      const { window } = await boot('#new/after/w2');
      const doc = window.document;
      await tick(30);
      assert.equal(doc.getElementById('new-sched-badge').textContent, 'After run');
      assert.equal(doc.getElementById('ws-source-previous-row').classList.contains('hidden'), false, 'the switch row is the workspace-mode control');
      assert.equal([...doc.getElementById('sourceBranch').options].some((o) => o.value === '__previous__'), false, 'never on the stand-in the single select becomes in workspace mode');
    } },
  ]);
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

test('a predecessor that cannot be waited on is refused (t9 unregistered project, t8 already-ended ticket)', async () => {
  await checkRows([
    { name: '#new/after/t:t9: a predecessor in a project this worca does not know is refused', hash: '#new/after/t:t9', msg: 'That run’s project is not registered.' },
    { name: '#new/after/t:t8: a ticket predecessor that already ended is refused — nothing to wait for', hash: '#new/after/t:t8', msg: '‘Gone’ was canceled. Nothing to wait for.' },
  ].map(({ name, hash, msg }) => ({ name, run: async () => {
    const { window } = await boot(hash);
    const doc = window.document;
    await tick(30);
    assert.equal(doc.getElementById('new-sched').hidden, true, 'no pick is made');
    assert.equal(doc.getElementById('form-msg').textContent, msg);
  } })));
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

test('P5: "Branch off the run before it" needs git and a Git member — an all-Folder workspace, or git off, keeps the switch off and posts no sourceFromPrevious', async () => {
  const start = async (hash, opts) => {
    const { window, runBodies } = await boot(hash, opts);
    const doc = window.document;
    await tick(30);
    assert.equal(doc.getElementById('new-sched-badge').textContent, 'After run');
    const sw = doc.getElementById('ws-source-previous');
    const seen = { on: sw.classList.contains('on'), checked: sw.getAttribute('aria-checked'), rowHidden: doc.getElementById('ws-source-previous-row').classList.contains('hidden') };
    doc.getElementById('prompt').value = 'Follow up';
    doc.getElementById('start-btn').click();
    await tick(3);
    assert.equal(runBodies.length, 1);
    return { ...seen, body: runBodies[0] };
  };
  await checkRows([
    { name: '#new/after/w3: every member a Folder project', run: async () => {
      const r = await start('#new/after/w3');
      assert.deepEqual([r.on, r.checked, r.rowHidden], [false, 'false', true]);
      assert.equal(r.body.after.id, 'w3');
      assert.equal('sourceFromPrevious' in r.body, false);
    } },
    { name: '#new/after/w4: a Git member beside a Folder member keeps the switch on and the flag', run: async () => {
      const r = await start('#new/after/w4');
      assert.deepEqual([r.on, r.checked, r.rowHidden], [true, 'true', false]);
      assert.equal(r.body.sourceFromPrevious, true);
    } },
    { name: '#new/after/w4 with git off: no branch to start from', run: async () => {
      const r = await start('#new/after/w4', { gitOff: true });
      assert.deepEqual([r.on, r.checked, r.rowHidden], [false, 'false', true]);
      assert.equal('sourceFromPrevious' in r.body, false);
    } },
  ]);
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

// #555 §7.4: the Start flow reports through #start-btn, refusals through a card alert above the
// form's own action row, and "Run started" is a toast — never a line on a page the user has left (D6).
async function bootNew(runReply) {
  const ctx = await boot('#new', { runReply, seedProject: 'svc-iam' });
  await branchesReady(ctx.window.document);
  return ctx;
}
const settle = async (doc) => { for (let i = 0; i < 200 && doc.getElementById('start-btn').dataset.fbState === 'busy'; i++) await tick(5); };

test('a started run opens its page without a "Run started" toast (F-24), and repeated Starts each post and never leave the form stuck', async () => {
  const { window, runBodies } = await bootNew((body, n) => ({ data: { runId: `r-${n}` }, status: 200 }));
  const doc = window.document;
  const btn = doc.getElementById('start-btn');
  await checkRows([
    { name: 'F-24: a started run lands on its own page, so no "Run started" toast, and no line on #form-msg', run: async () => {
      doc.getElementById('prompt').value = 'Add tests';
      doc.getElementById('start-btn').click();
      await settle(doc);
      assert.equal(runBodies.length, 1);
      assert.match(window.location.hash, /^#running\/r-1/);   // the first call's runId
      assert.equal(doc.getElementById('form-msg').textContent, '');
      assert.equal(lastToast(doc), null, 'the run page is the confirmation');
      assert.equal(doc.getElementById('start-btn').dataset.fbState, 'done');
      assert.equal(doc.getElementById('start-btn').textContent.trim(), 'Started');
    } },
    { name: 'a second Start while the first still reads "Started" posts again and never leaves the form stuck', run: async () => {
      // The first Start is the row above's click.
      assert.equal(btn.dataset.fbState, 'done');
      doc.getElementById('prompt').value = 'Add more tests';   // #687: a started run clears the task
      doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await settle(doc);
      assert.equal(runBodies.length, 2, 'the second submit was not skipped');
      doc.getElementById('prompt').value = 'And more';
      doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await settle(doc);
      assert.equal(runBodies.length, 3, 'nor the third');
    } },
  ]);
});

test('a failed start never shows Started: a "Run not started" card alert sits directly above the form\'s own action row', async () => {
  const { window, runBodies } = await bootNew(() => ({ data: { error: 'disk full' }, status: 500 }));
  const doc = window.document;
  const btn = doc.getElementById('start-btn');
  let sawDone = false;
  new window.MutationObserver(() => { if (btn.classList.contains('is-done') || btn.dataset.fbState === 'done') sawDone = true; })
    .observe(btn, { attributes: true });
  doc.getElementById('prompt').value = 'Add tests';
  btn.click();
  await settle(doc);
  await tick(5);
  assert.equal(runBodies.length, 1);
  assert.equal(sawDone, false);
  assert.equal(btn.classList.contains('is-done'), false);
  assert.equal(btn.dataset.fbState, undefined, 'idle again');
  assert.equal(btn.disabled, false);
  const form = doc.getElementById('run-form');
  assert.deepEqual(cardAlertOf(form), { title: 'Run not started', detail: 'disk full' });
  const actions = form.querySelector('.card-alert').nextElementSibling;
  assert.equal(actions.parentElement, form);
  assert.ok(actions.matches('div.actions'));
  assert.ok(actions.contains(btn));
  assert.equal(doc.getElementById('start-btn-label').parentElement, btn, 'the cached label node is back inside the button');
  assert.equal(doc.getElementById('form-msg').textContent, '');
  // The next submit clears the alert.
  btn.click();
  await settle(doc);
  assert.equal(runBodies.length, 2);
  assert.equal(form.querySelectorAll('.card-alert').length, 1, 'one alert, replaced');
});

test('an empty prompt is a field error: no busy state on Start and no POST', async () => {
  const { window, runBodies } = await bootNew(() => ({ data: { runId: 'r-1' }, status: 200 }));
  const doc = window.document;
  const prompt = doc.getElementById('prompt');
  prompt.value = '';
  doc.getElementById('start-btn').click();
  await tick(5);
  assert.equal(runBodies.length, 0);
  assert.match(fieldErrorText(prompt), /prompt/i);
  assert.equal(prompt.getAttribute('aria-invalid'), 'true');
  assert.equal(doc.getElementById('start-btn').hasAttribute('data-fb-state'), false);
  assert.equal(doc.getElementById('form-msg').textContent, '');
});

test('a cancelled sync dialog never shows Started: a "Start cancelled" warn toast, Start idle again', async () => {
  const refusal = { error: 'diverged', code: 'sync-diverged', options: ['origin', 'cancel'],
    members: [{ base: 'main', remote: 'origin', ahead: 1, behind: 2 }] };
  const { window, runBodies } = await bootNew(() => ({ data: refusal, status: 409 }));
  const doc = window.document;
  const btn = doc.getElementById('start-btn');
  doc.getElementById('prompt').value = 'Add tests';
  btn.click();
  let cancel = null;
  for (let i = 0; i < 200 && !cancel; i++) { await tick(5); cancel = [...doc.querySelectorAll('.sync-modal .qpanel-foot button')].find((b) => b.textContent === 'Cancel'); }
  assert.ok(cancel, 'the sync dialog is up');
  assert.equal(btn.dataset.fbState, 'busy');
  cancel.click();
  await settle(doc);
  assert.equal(runBodies.length, 1);
  assert.equal(btn.dataset.fbState, undefined);
  assert.equal(btn.disabled, false);
  assert.deepEqual(lastToast(doc), { tone: 'warn', title: 'Start cancelled', detail: '', action: '' });
  assert.equal(cardAlertOf(doc.getElementById('run-form')), null);
  assert.equal(doc.getElementById('form-msg').textContent, '');
});
