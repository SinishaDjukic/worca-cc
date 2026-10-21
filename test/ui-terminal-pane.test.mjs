// test/ui-terminal-pane.test.mjs — the right-side terminal pane (#573): follows the page, starts or
// reattaches its shell on open (once), checks out first, Enter restarts an ended shell, the pipes banner,
// the hosted message. No Commands list: commands are recorded for the audit log only. xterm is faked (jsdom has no canvas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTerminalPane, paneTargetOf } from '../ui/public/terminal-pane.mjs';

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function fakeXterm() {
  const writes = [];
  let onKeys = null;
  const made = {};
  class Terminal {
    constructor(o) { this.options = { ...o }; this.cols = 80; this.rows = 24; made.options = this.options; }
    loadAddon() {} open(el) { made.openedIn = el; } focus() { made.focus = (made.focus || 0) + 1; } dispose() {}
    write(d, cb) { writes.push(d); made.log?.push(`write:${d}`); if (cb) { if (made.held) made.held.push(cb); else cb(); } } reset() { writes.length = 0; }
    resize(c, r) { this.cols = c; this.rows = r; made.log?.push(`resize:${c}x${r}`); }
    onData(cb) { onKeys = cb; return { dispose() {} }; }
  }
  class FitAddon { fit() { made.log?.push('fit'); } }
  return { load: async () => ({ Terminal, FitAddon }), writes, made, type: (d) => onKeys(d) };
}

function makePane({ ctx, routes, url = 'http://localhost:4317/', env = {}, beforeCreate = null, confirm = null }) {
  const dom = new JSDOM('<!doctype html><body></body>', { url });
  if (beforeCreate) beforeCreate(dom.window);
  env.ctx ??= ctx;
  env.online ??= true;
  const sent = [];
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null });
    const h = routes[`${method} ${url.split('?')[0]}`];
    const v = typeof h === 'function' ? h(url, opts) : h;
    const status = v?.__status || (v === undefined ? 404 : 200);
    return { ok: status < 400, status, json: async () => v ?? {} };
  };
  const xt = fakeXterm();
  // Like app.js: false while /ws is down, and then nothing is sent.
  const sendWs = (m) => { if (!env.online) return false; sent.push(m); return true; };
  const pane = createTerminalPane({ doc: dom.window.document, win: dom.window, fetch, sendWs,
    getPageContext: () => env.ctx, confirm, storage: null, loadXterm: xt.load });
  dom.window.document.body.append(pane.root);
  return { pane, doc: dom.window.document, sent, calls, xt, env };
}

const INFO = { enabled: true, pty: { available: true, reason: null }, maxSessions: 16, sessions: [] };
const RUN_CTX = { view: 'running', runId: 'uuid-1', pipelineId: 'r1', projectDir: '/p/app' };
const SNAP = { id: 't-1', scope: 'run', label: 'r1 · app', runId: 'r1', member: 'app-0000aaaa', mode: 'pty', integration: true,
  status: 'running', runLive: true, folder: 'ok', currentBlock: null, createdAt: '2026-10-03T10:00:00.000Z' };

const MEMBERS = [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/x' }];
const attachedRoutes = (extra = {}) => ({
  'GET /api/terminal': { ...INFO, sessions: [SNAP] },
  'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [SNAP], members: MEMBERS },
  ...extra,
});

test('paneTargetOf follows the page', () => {
  assert.deepEqual(paneTargetOf(RUN_CTX), { kind: 'run', runId: 'r1', query: 'projectDir=%2Fp%2Fapp' });
  assert.deepEqual(paneTargetOf({ view: 'history-detail', pipelineId: 'r2', workspaceId: 'wks-1' }), { kind: 'run', runId: 'r2', query: 'workspaceId=wks-1' });
  assert.deepEqual(paneTargetOf({ view: 'project-detail', projectKey: 'app-0000aaaa' }), { kind: 'project', projectKey: 'app-0000aaaa' });
  assert.deepEqual(paneTargetOf({ view: 'stats' }), { kind: 'other' });
  assert.deepEqual(paneTargetOf({ view: 'running', runId: 'live-1', pipelineId: 'r3', workspaceId: 'workspaces/wks-2' }),
    { kind: 'run', runId: 'r3', query: 'workspaceId=wks-2' });
  assert.deepEqual(paneTargetOf({ view: 'running', runId: 'live-1' }), { kind: 'pending' });
});

const posts = (calls, path) => calls.filter((c) => c.method === 'POST' && (!path || c.url.split('?')[0] === path));
const LIVE_MEMBER = { projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/runs/r1/repos/app',
  warning: 'This pipeline is still running and changing these files.' };

test('a live run: opening the pane starts a shell in its folder, with the member and size, attaches it and warns', async () => {
  const { pane, doc, sent, calls } = makePane({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [LIVE_MEMBER] },
    'POST /api/runs/r1/terminal': { session: { ...SNAP, cwd: LIVE_MEMBER.cwd }, warning: LIVE_MEMBER.warning },
  } });
  await pane.open();
  await tick();
  assert.equal(doc.body.classList.contains('term-open'), true);
  const [post] = posts(calls);
  assert.equal(posts(calls).length, 1);
  assert.equal(post.url, '/api/runs/r1/terminal?projectDir=%2Fp%2Fapp');
  assert.deepEqual(post.body, { member: 'app-0000aaaa', cols: 80, rows: 24 });
  assert.ok(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-1'));
  const ctx = doc.querySelector('.term-context');
  assert.equal(ctx.querySelector('.term-folder').textContent, '/runs/r1/repos/app');
  assert.match(ctx.querySelector('.term-warn').textContent, /still running and changing these files/);
  assert.equal(ctx.querySelector('button'), null, 'no buttons in the context line');
});

test('the header: the title and the hide button; no Stop, Close, Open or branch controls', async () => {
  const { pane, doc } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  const labels = [...doc.querySelectorAll('.term-head button')].map((b) => b.getAttribute('aria-label') || b.textContent);
  assert.deepEqual(labels, ['Hide the terminal pane']);
  assert.equal(doc.querySelector('.term-head .term-title').textContent, 'Terminal');
  for (const gone of ['.term-stop', '.term-close-session', '.term-checkout', '.term-branch', '.term-sessions', '.term-wt-remove']) {
    assert.equal(doc.querySelector(gone), null, gone);
  }
});

test('the page header buttons (.term-opener) say whether the pane is open; the pane adds no opener of its own', async () => {
  const { pane, doc } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  const opener = doc.createElement('button');
  opener.className = 'term-opener';
  opener.setAttribute('aria-expanded', 'false');
  doc.body.append(opener);
  assert.equal(pane.handle, undefined);
  await pane.open();
  await tick();
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.body.getAttribute('aria-expanded'), null);   // body.term-open is not an opener
  pane.close();
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
});

test('the pane renders no Commands control or list, and leaves recorded commands to the server', async () => {
  const { pane, doc, calls, xt } = makePane({ ctx: RUN_CTX, url: 'http://localhost:4317/?terminal=t-1&block=1', routes: attachedRoutes() });
  await pane.open();
  await tick();
  pane.onFrame({ type: 'term-block', sessionId: 't-1', block: { sessionId: 't-1', seq: 1, command: 'npm test', status: 'done', exitCode: 0 } });
  assert.equal(doc.querySelector('.term-cmds'), null);
  assert.equal(doc.querySelector('.term-blocks'), null);
  assert.equal(doc.querySelector('.term-block'), null);
  assert.doesNotMatch(doc.querySelector('.term-pane').textContent, /Commands|Run again|Copy link/);
  assert.equal([...doc.querySelectorAll('.term-pane [aria-label]')].some((n) => /command/i.test(n.getAttribute('aria-label'))), false);
  assert.equal(calls.some((c) => c.url.startsWith('/api/terminal/sessions/')), false, 'no blocks fetched');
  assert.doesNotMatch(xt.writes.join(''), /npm test/, 'a term-block frame is not drawn');
});

test('reopening the pane on the same page reattaches its running shell instead of starting another', async () => {
  const routes = attachedRoutes();
  const { pane, calls, sent } = makePane({ ctx: RUN_CTX, routes });
  await pane.open();
  await tick();
  pane.close();
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 0);
  assert.equal(sent.filter((m) => m.type === 'term-detach').length, 0, 'hiding the pane keeps the shell attached');
});

test('a project page: the shell opens in the project\'s own folder (no branch in the request)', async () => {
  const PROJ = { ...SNAP, id: 't-p', scope: 'project', runId: null, member: null, projectKey: 'app-0000aaaa', branch: 'dev', cwd: '/p/app', label: 'app · dev', runLive: false };
  const { pane, doc, calls, sent } = makePane({ ctx: { view: 'project-detail', projectKey: 'app-0000aaaa' }, routes: {
    'GET /api/terminal': INFO,
    'GET /api/projects/app-0000aaaa/terminal': { enabled: true, sessions: [], dir: '/p/app', branches: ['dev'], current: 'dev', worktrees: [] },
    'POST /api/projects/app-0000aaaa/terminal': { session: PROJ, warning: null },
  } });
  await pane.open();
  await tick();
  const p = posts(calls);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].body, { cols: 80, rows: 24 });
  assert.ok(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-p'));
  assert.equal(doc.querySelector('.term-folder').textContent, '/p/app');
  assert.equal(doc.querySelector('.term-warn'), null);
});

test('a project page reattaches its own-folder shell, never a branch-folder one opened through the API', async () => {
  const PROJ = { ...SNAP, id: 't-p', scope: 'project', runId: null, projectKey: 'app-0000aaaa', cwd: '/p/app' };
  const BR = { ...PROJ, id: 't-b', scope: 'branch', cwd: '/home/terminal/worktrees/app/dev', createdAt: '2026-10-03T11:00:00.000Z' };
  const { pane, calls, sent } = makePane({ ctx: { view: 'project-detail', projectKey: 'app-0000aaaa' }, routes: {
    'GET /api/terminal': { ...INFO, sessions: [PROJ, BR] },
    'GET /api/projects/app-0000aaaa/terminal': { enabled: true, sessions: [PROJ, BR], dir: '/p/app', branches: [], current: 'dev', worktrees: [] },
  } });
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 0);
  assert.equal(sent.find((m) => m.type === 'term-attach').sessionId, 't-p');
});

test('a finished run without a checkout: the checkout is made first, then the shell starts in it', async () => {
  let checkedOut = false;
  const DONE = { ...SNAP, runLive: false, cwd: '/home/checkouts/r1/app' };
  const { pane, doc, calls, sent } = makePane({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': () => ({ enabled: true, live: false, finished: true, workspace: false, sessions: [],
      members: [checkedOut ? { projectKey: 'app-0000aaaa', projectName: 'app', state: 'checkout', cwd: DONE.cwd }
        : { projectKey: 'app-0000aaaa', projectName: 'app', state: 'needs-checkout', cwd: null }] }),
    'POST /api/runs/r1/checkout': () => { checkedOut = true; return { members: [] }; },
    'POST /api/runs/r1/terminal': { session: DONE, warning: null },
  } });
  await pane.open();
  await tick();
  const p = posts(calls);
  assert.deepEqual(p.map((c) => c.url), ['/api/runs/r1/checkout?projectDir=%2Fp%2Fapp', '/api/runs/r1/terminal?projectDir=%2Fp%2Fapp']);
  assert.deepEqual(p[0].body, { members: ['app-0000aaaa'] });
  assert.ok(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-1'));
  assert.equal(doc.querySelector('.term-folder').textContent, DONE.cwd);
});

test('a run with no folder shows the reason and starts nothing', async () => {
  const { pane, doc, calls } = makePane({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [],
      members: [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'unavailable', cwd: null, reason: 'This run has no folder yet.' }] },
  } });
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 0);
  assert.equal(doc.querySelector('.term-context').textContent, 'This run has no folder yet.');
});

test('a starting run (no pipeline id yet) starts nothing and says it opens in a moment', async () => {
  const { pane, doc, calls } = makePane({ ctx: { view: 'running', runId: 'live-1' }, routes: { 'GET /api/terminal': INFO } });
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 0);
  assert.match(doc.querySelector('.term-context').textContent, /starting/);
  pane.destroy();
});

test('other pages start nothing: the hint with no terminals, else the newest running one', async () => {
  const one = makePane({ ctx: { view: 'stats' }, routes: { 'GET /api/terminal': INFO } });
  await one.pane.open();
  await tick();
  assert.equal(posts(one.calls).length, 0);
  assert.equal(one.doc.querySelector('.term-context').textContent, 'Open a run or a project to start a terminal.');

  const older = { ...SNAP, id: 't-old', createdAt: '2026-10-03T09:00:00.000Z' };
  const newer = { ...SNAP, id: 't-new', createdAt: '2026-10-03T12:00:00.000Z' };
  const ended = { ...SNAP, id: 't-end', status: 'exited', createdAt: '2026-10-03T13:00:00.000Z' };
  const two = makePane({ ctx: { view: 'stats' }, routes: { 'GET /api/terminal': { ...INFO, sessions: [older, ended, newer] } } });
  await two.pane.open();
  await tick();
  assert.equal(posts(two.calls).length, 0);
  assert.equal(two.sent.find((m) => m.type === 'term-attach').sessionId, 't-new');
  assert.doesNotMatch(two.doc.querySelector('.term-context').textContent, /Open a run/, 'no hint while a shell is attached');
});

test('a workspace run: the member select, a shell started on the selected member, and one more on the other member', async () => {
  const api = { ...SNAP, id: 't-a', runId: 'w1', member: 'api-0000bbbb', cwd: '/a', runLive: false };
  const web = { ...SNAP, id: 't-w', runId: 'w1', member: 'web-0000cccc', cwd: '/w', runLive: false };
  const { pane, doc, calls, sent } = makePane({ ctx: { view: 'running', pipelineId: 'w1', workspaceId: 'wks-1' }, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/w1/terminal': { enabled: true, live: true, workspace: true, sessions: [], members: [
      { projectKey: 'api-0000bbbb', projectName: 'api', state: 'worktree', cwd: '/a' }, { projectKey: 'web-0000cccc', projectName: 'web', state: 'worktree', cwd: '/w' }] },
    'POST /api/runs/w1/terminal': (url, opts) => ({ session: JSON.parse(opts.body).member === 'api-0000bbbb' ? api : web, warning: null }),
  } });
  await pane.open();
  await tick();
  assert.deepEqual([...doc.querySelectorAll('.term-member option')].map((o) => o.textContent), ['api', 'web']);
  assert.deepEqual(posts(calls).map((c) => c.body.member), ['api-0000bbbb']);
  const sel = doc.querySelector('.term-member');
  sel.value = 'web-0000cccc';
  sel.dispatchEvent(new doc.defaultView.Event('change'));
  await tick();
  assert.deepEqual(posts(calls).map((c) => c.body.member), ['api-0000bbbb', 'web-0000cccc']);
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-a'));
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-w');
  const sel2 = doc.querySelector('.term-member');
  sel2.value = 'api-0000bbbb';
  sel2.dispatchEvent(new doc.defaultView.Event('change'));
  await tick();
  assert.equal(posts(calls).length, 2, 'back on api: its running shell is reattached, not a new one');
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
});

test('a warning belongs to its terminal: shown with it, gone once another member\'s shell is attached', async () => {
  const api = { ...SNAP, id: 't-a', scope: 'run', runId: 'w1', member: 'api-0000bbbb', runLive: true };
  const web = { ...SNAP, id: 't-w', scope: 'run', runId: 'w1', member: 'web-0000cccc', runLive: false };
  const { pane, doc } = makePane({ ctx: { view: 'running', pipelineId: 'w1', workspaceId: 'wks-1' }, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/w1/terminal': { enabled: true, live: true, workspace: true, sessions: [], members: [
      { projectKey: 'api-0000bbbb', projectName: 'api', state: 'worktree', cwd: '/a' }, { projectKey: 'web-0000cccc', projectName: 'web', state: 'worktree', cwd: '/w' }] },
    'POST /api/runs/w1/terminal': (url, opts) => (JSON.parse(opts.body).member === 'api-0000bbbb'
      ? { session: api, warning: 'API is still changing.' } : { session: web, warning: null }),
  } });
  await pane.open();
  await tick();
  assert.equal(doc.querySelector('.term-context .term-warn')?.textContent, 'API is still changing.');
  assert.equal(doc.querySelector('.term-context .term-error'), null, 'a warning is not shown as an error');
  const sel = doc.querySelector('.term-member');
  sel.value = 'web-0000cccc';
  sel.dispatchEvent(new doc.defaultView.Event('change'));
  await tick();
  assert.equal(doc.querySelector('.term-context .term-warn'), null);
});

test('never two shells for one page: quick context changes while the start is in flight post once', async () => {
  const env = {};
  let release;
  const gate = new Promise((r) => { release = r; });
  const { pane, calls, sent } = makePane({ ctx: RUN_CTX, env, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [LIVE_MEMBER] },
    'GET /api/runs/r2/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [{ ...LIVE_MEMBER, cwd: '/r2' }] },
    'POST /api/runs/r1/terminal': () => gate.then(() => ({ session: SNAP, warning: null })),
    'POST /api/runs/r2/terminal': () => gate.then(() => ({ session: { ...SNAP, id: 't-2', runId: 'r2' }, warning: null })),
  } });
  const opening = pane.open();
  pane.onContextChange();
  pane.onContextChange();
  await tick();
  env.ctx = { ...RUN_CTX, pipelineId: 'r2' };
  pane.onContextChange();
  await tick();
  env.ctx = RUN_CTX;
  pane.onContextChange();
  await tick();
  release();
  await opening;
  await tick(12);
  assert.deepEqual(posts(calls).map((c) => c.url.split('?')[0]), ['/api/runs/r1/terminal', '/api/runs/r2/terminal']);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1', 'the page in view gets its shell; r2\'s waits in the picker');
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 2, 'a forced refresh on the same page reattaches');
});

test('an exited shell is not replaced on its own: a dim line, then Enter (only) starts one', async () => {
  const T2 = { ...SNAP, id: 't-2', createdAt: '2026-10-03T11:00:00.000Z' };
  const { pane, calls, sent, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes({
    'POST /api/runs/r1/terminal': { session: T2, warning: null },
  }) });
  await pane.open();
  await tick();
  pane.onFrame({ type: 'term-status', snapshot: { ...SNAP, status: 'exited', exitCode: 0 } });
  await tick();
  assert.match(xt.writes.join(''), /\x1b\[2m\[shell exited with code 0\. Press Enter for a new one\]/);
  pane.onContextChange();
  await tick();
  assert.equal(posts(calls).length, 0, 'no respawn');
  xt.type('ls');
  await tick();
  assert.equal(posts(calls).length, 0, 'other keys do nothing');
  assert.equal(sent.filter((m) => m.type === 'term-input').length, 0);
  xt.type('\r');
  xt.type('\r');
  await tick();
  assert.equal(posts(calls).length, 1, 'one Enter, one shell');
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
  assert.equal(sent.filter((m) => m.type === 'term-input').length, 0, 'the Enter itself is not sent');
});

const tabTexts = (doc) => [...doc.querySelectorAll('.term-tabs .term-tab')].map((t) => t.getAttribute('aria-label') || t.textContent);

test('the tabs: this page\'s open terminals, then a small (+) tab; other pages\' and ended shells are not tabs', async () => {
  const { pane, doc } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  assert.equal(doc.querySelector('.term-tabs').hidden, false);
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal']);
  assert.equal(doc.querySelector('.term-tab[aria-selected="true"]').textContent, 'r1 · app');
  pane.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-9', label: 'other', runId: 'r9' } });
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal'], 'another run\'s shell is not a tab here');
  pane.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-3', createdAt: '2026-10-03T11:00:00.000Z' } });
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'r1 · app 2', 'New terminal'], 'a second shell of the folder: numbered, on the right');
  pane.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-3', createdAt: '2026-10-03T11:00:00.000Z', status: 'exited' } });
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal'], 'an ended terminal that is not attached leaves');
});

const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').map((c) => c.url);

test('a tab\'s × closes an unused terminal without asking and hands over to the page\'s next one', async () => {
  const T2 = { ...SNAP, id: 't-2', commands: 0, createdAt: '2026-10-03T11:00:00.000Z' };
  const asked = [];
  const { pane, doc, sent, calls } = makePane({ ctx: RUN_CTX, confirm: async (o) => { asked.push(o); return true; }, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [SNAP, T2] },
    'DELETE /api/terminal/sessions/t-2': { ok: true },
  }) });
  await pane.open();
  await tick();
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2', 'the newest is attached');
  assert.deepEqual([...doc.querySelectorAll('.term-tab-close')].map((b) => b.getAttribute('aria-label')), ['Close r1 · app', 'Close r1 · app 2']);
  doc.querySelectorAll('.term-tab-close')[1].click();
  await tick();
  assert.equal(asked.length, 0, 'no command ran there: no question');
  assert.deepEqual(deletes(calls), ['/api/terminal/sessions/t-2']);
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-2'));
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1');
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal']);
  pane.onFrame({ type: 'term-status', snapshot: { ...T2, status: 'closed' } });
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal']);
});

test('a tab\'s × on a terminal that ran a command asks first; No keeps it, Yes closes it and offers Enter', async () => {
  const used = { ...SNAP, commands: 2, currentBlock: { seq: 2, command: 'npm test' } };
  let answer = false;
  const asked = [];
  const { pane, doc, calls, xt } = makePane({ ctx: RUN_CTX, confirm: async (o) => { asked.push(o); return answer; }, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [used] },
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [used], members: MEMBERS },
    'DELETE /api/terminal/sessions/t-1': { ok: true },
  }) });
  await pane.open();
  await tick();
  doc.querySelector('.term-tab-close').click();
  await tick();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].danger, undefined, 'nothing is lost: a plain button, not a red one');
  assert.match(asked[0].message, /2 commands have run in r1 · app/);
  assert.match(asked[0].message, /npm test is still running/);
  assert.deepEqual(deletes(calls), [], 'No: nothing is closed');
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal']);
  answer = true;
  doc.querySelector('.term-tab-close').click();
  await tick();
  assert.deepEqual(deletes(calls), ['/api/terminal/sessions/t-1']);
  assert.deepEqual(tabTexts(doc), ['New terminal']);
  assert.match(xt.writes.join(''), /terminal closed\. Press Enter for a new one/);
  assert.equal(posts(calls).length, 0, 'no new shell unasked');
});

test('a failed close keeps the tab attached and says why', async () => {
  const { pane, doc, sent } = makePane({ ctx: RUN_CTX, routes: attachedRoutes({
    'DELETE /api/terminal/sessions/t-1': { __status: 404, error: 'No running terminal with that id.' },
  }) });
  await pane.open();
  await tick();
  doc.querySelector('.term-tab-close').click();
  await tick();
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'New terminal']);
  assert.equal(doc.querySelector('.term-tab[aria-selected="true"]').textContent, 'r1 · app');
  assert.ok(!sent.some((m) => m.type === 'term-detach'));
  assert.match(doc.querySelector('.term-error').textContent, /No running terminal/);
});

test('the (+) tab starts another shell in the same folder and attaches it; a tab click switches back', async () => {
  const T2 = { ...SNAP, id: 't-2', createdAt: '2026-10-03T11:00:00.000Z' };
  const { pane, doc, sent, calls } = makePane({ ctx: RUN_CTX, routes: attachedRoutes({ 'POST /api/runs/r1/terminal': { session: T2, warning: null } }) });
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 0, 'the running shell is reattached');
  doc.querySelector('.term-tab-add').click();
  await tick();
  const [post] = posts(calls);
  assert.equal(posts(calls).length, 1);
  assert.deepEqual(post.body, { member: 'app-0000aaaa', cols: 80, rows: 24 });
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'));
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'r1 · app 2', 'New terminal']);
  assert.equal(doc.querySelector('.term-tab[aria-selected="true"]').textContent, 'r1 · app 2');
  doc.querySelector('.term-tab').click();
  await tick();
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1');
  assert.equal(doc.querySelector('.term-tab[aria-selected="true"]').textContent, 'r1 · app');
  assert.equal(posts(calls).length, 1, 'switching starts nothing');
});

test('a page that starts no shell has no (+) tab', async () => {
  const { pane, doc } = makePane({ ctx: { view: 'stats' }, routes: { 'GET /api/terminal': { ...INFO, sessions: [SNAP] } } });
  await pane.open();
  await tick();
  assert.deepEqual(tabTexts(doc), ['r1 · app']);
});

test('pipes mode: Ctrl+C typed in the pane calls the stop API', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const { pane, calls, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes], members: MEMBERS },
    'POST /api/terminal/sessions/t-1/stop': { ok: true, blockSeq: 1 },
  }) });
  await pane.open();
  await tick();
  xt.type('\x03');
  await tick();
  assert.deepEqual(posts(calls).map((c) => c.url), ['/api/terminal/sessions/t-1/stop']);
});

test('pty mode: Ctrl+C goes to the shell as a keystroke, not to the stop API', async () => {
  const { pane, calls, sent, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  xt.type('\x03');
  await tick();
  assert.equal(posts(calls).length, 0);
  assert.ok(sent.some((m) => m.type === 'term-input' && m.data === '\x03'));
});

test('pipes mode: the banner, local echo, and a line sent on Enter', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const { pane, doc, sent, xt } = makePane({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': { ...INFO, pty: { available: false, reason: 'node-pty is not installed on this server (MODULE_NOT_FOUND)' }, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes],
      members: [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/x' }] },
  } });
  await pane.open();
  await tick();
  assert.match(doc.querySelector('.term-banners').textContent, /Full-screen programs \(vim, top, less\) do not work here/);
  xt.type('ls\r');
  assert.ok(xt.writes.includes('ls\r\n'));
  assert.ok(sent.some((m) => m.type === 'term-input' && m.data === 'ls\n'));
});

test('hosted and off: the pane says how to turn it on', async () => {
  const { pane, doc } = makePane({ ctx: RUN_CTX, routes: { 'GET /api/terminal': { ...INFO, enabled: false } } });
  await pane.open();
  await tick();
  assert.match(doc.querySelector('.term-context').textContent, /WORCA_TERMINAL_REMOTE=1/);
});

test('replay then data: duplicates by seq are dropped', async () => {
  const { pane, xt } = makePane({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': { ...INFO, sessions: [SNAP] },
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [SNAP], members: [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/x' }] },
  } });
  await pane.open();
  await tick();
  pane.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2 });
  pane.onFrame({ type: 'term-data', sessionId: 't-1', data: 'B', seq: 2 });
  pane.onFrame({ type: 'term-data', sessionId: 't-1', data: 'C', seq: 3 });
  assert.equal(xt.writes.join(''), 'ABC');
});

test('Ctrl+` toggles the pane even from inside the terminal, where xterm stops the event', async () => {
  const { pane, doc } = makePane({ ctx: { view: 'stats' }, routes: { 'GET /api/terminal': INFO } });
  const inner = doc.createElement('textarea');
  inner.addEventListener('keydown', (e) => e.stopPropagation());
  pane.root.querySelector('.term-screen').appendChild(inner);
  inner.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }));
  await tick();
  assert.equal(pane.isOpen(), true);
});

test('xterm opens in an unpadded host inside the framed screen, so FitAddon does not count the frame (finding 1)', async () => {
  const { pane, doc, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  assert.equal(xt.made.openedIn, doc.querySelector('.term-screen > .term-host'));
});

test('attach fits and sends the size, so a session opened at another width gets this one (finding 5)', async () => {
  const { pane, sent } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(sent.some((m) => m.type === 'term-resize' && m.sessionId === 't-1' && m.cols === 80 && m.rows === 24));
});

test('moving to another run lets go of the previous shell and starts that run\'s own (finding 3)', async () => {
  const env = {};
  const T2 = { ...SNAP, id: 't-2', runId: 'r2', cwd: '/runs/r2' };
  let releaseT2;
  const t2Gate = new Promise((r) => { releaseT2 = r; });
  const { pane, doc, sent, xt, calls } = makePane({ ctx: RUN_CTX, env, routes: attachedRoutes({
    'GET /api/runs/r2/terminal': { enabled: true, live: false, workspace: false, sessions: [], members: [{ ...MEMBERS[0], cwd: '/runs/r2' }] },
    'POST /api/runs/r2/terminal': () => t2Gate.then(() => ({ session: T2, warning: null })),
  }) });
  await pane.open();
  await tick();
  pane.onFrame({ type: 'term-data', sessionId: 't-1', data: 'old output', seq: 1 });
  env.ctx = { ...RUN_CTX, pipelineId: 'r2' };
  pane.onContextChange();
  await tick();
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'));
  assert.deepEqual(xt.writes, [], 'the old screen is cleared');
  assert.match(doc.querySelector('.term-context').textContent, /\/runs\/r2/);
  const before = sent.length;
  xt.type('rm -rf build\r');
  assert.equal(sent.slice(before).filter((m) => m.type === 'term-input').length, 0, 'no keystroke reaches the other run\'s shell');
  releaseT2();
  await tick();
  assert.deepEqual(posts(calls).map((c) => c.url.split('?')[0]), ['/api/runs/r2/terminal']);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
});
test('a page change while the pane is closed also lets go of the shell', async () => {
  const env = {};
  const { pane, sent } = makePane({ ctx: RUN_CTX, env, routes: attachedRoutes() });
  await pane.open();
  await tick();
  pane.close();
  env.ctx = { view: 'project-detail', projectKey: 'web-0000cccc' };
  pane.onContextChange();
  await tick();
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'));
});

test('an open select survives unrelated updates (finding 6)', async () => {
  const api = { ...SNAP, runId: 'w1', member: 'api-0000bbbb' };
  const other = { ...SNAP, id: 't-9', runId: 'r9', member: 'x', label: 'other', createdAt: '2026-10-03T09:00:00.000Z' };
  const { pane, doc } = makePane({ ctx: { view: 'running', pipelineId: 'w1', workspaceId: 'wks-1' }, routes: {
    'GET /api/terminal': { ...INFO, sessions: [api, other] },
    'GET /api/runs/w1/terminal': { enabled: true, live: true, workspace: true, sessions: [api], members: [
      { projectKey: 'api-0000bbbb', projectName: 'api', state: 'worktree', cwd: '/a' }, { projectKey: 'web-0000cccc', projectName: 'web', state: 'worktree', cwd: '/w' }] },
  } });
  await pane.open();
  await tick();
  const member = doc.querySelector('.term-member');
  const tabEls = [...doc.querySelectorAll('.term-tabs .term-tab')];
  pane.onFrame({ type: 'term-status', snapshot: { ...api, currentBlock: { seq: 1, command: 'cmd 1' } } });
  assert.equal(doc.querySelector('.term-member'), member, 'the member select is not rebuilt by a status frame');
  assert.deepEqual([...doc.querySelectorAll('.term-tabs .term-tab')], tabEls, 'nor are the tabs');
});
test('xterm gets all 16 ANSI colours, each from its --term-ansi-* token (finding 7)', async () => {
  const { pane, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes(), beforeCreate: (win) => {
    const real = win.getComputedStyle.bind(win);
    // jsdom resolves no var(): answer with the token name each probe asks for.
    win.getComputedStyle = (el) => {
      const v = el.style?.getPropertyValue?.('color') || '';
      return v.startsWith('var(') ? { color: v.slice(4, -1) } : real(el);
    };
  } });
  await pane.open();
  await tick();
  const t = xt.made.options.theme;
  assert.equal(t.red, '--term-ansi-red');
  assert.equal(t.brightWhite, '--term-ansi-bright-white');
  assert.equal(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].flatMap((c) => [c, `bright${c[0].toUpperCase()}${c.slice(1)}`])
    .filter((k) => t[k]).length, 16);
});

test('a server restart forgets the shell and its screen, and starts a new one only on Enter (finding 9)', async () => {
  const T2 = { ...SNAP, id: 't-2' };
  const routes = attachedRoutes({ 'POST /api/runs/r1/terminal': { session: T2, warning: null } });
  const { pane, doc, sent, xt, calls } = makePane({ ctx: RUN_CTX, routes });
  pane.onHello({ type: 'hello', bootId: 'boot-a' });
  await pane.open();
  await tick();
  pane.onFrame({ type: 'term-data', sessionId: 't-1', data: 'before', seq: 1 });
  routes['GET /api/terminal'] = { ...INFO, sessions: [] };
  routes['GET /api/runs/r1/terminal'] = { enabled: true, live: true, workspace: false, sessions: [], members: MEMBERS };
  pane.onHello({ type: 'hello', bootId: 'boot-b' });
  await tick(12);
  assert.doesNotMatch(xt.writes.join(''), /before/);
  assert.match(xt.writes.join(''), /\[the worca server restarted\. Press Enter for a new one\]/);
  assert.deepEqual(tabTexts(doc), ['New terminal'], 'the gone shell\'s tab leaves');
  assert.match(doc.querySelector('.term-context').textContent, /server restarted/);
  assert.equal(posts(calls).length, 0, 'no respawn');
  const before = sent.length;
  xt.type('ls');
  assert.equal(sent.slice(before).filter((m) => m.type === 'term-input').length, 0);
  xt.type('\r');
  await tick();
  assert.equal(posts(calls).length, 1);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
});
test('the tabs drop sessions the server no longer lists', async () => {
  const routes = { 'GET /api/terminal': { ...INFO, sessions: [SNAP, { ...SNAP, id: 't-2', label: 'gone', createdAt: '2026-10-03T09:00:00.000Z' }] } };
  const { pane, doc } = makePane({ ctx: { view: 'stats' }, routes });
  await pane.open();
  await tick();
  assert.deepEqual(tabTexts(doc), ['gone', 'r1 · app']);
  pane.close();
  routes['GET /api/terminal'] = { ...INFO, sessions: [SNAP] };
  await pane.open();
  await tick();
  assert.deepEqual(tabTexts(doc), ['r1 · app']);
});
test('while /ws reconnects the pane says so and does not echo a line it could not send (finding 10)', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const env = {};
  const { pane, doc, sent, xt } = makePane({ ctx: RUN_CTX, env, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes], members: MEMBERS },
  }) });
  await pane.open();
  await tick();
  env.online = false;
  pane.onConnection(false);
  assert.match(doc.querySelector('.term-banners').textContent, /Reconnecting to the worca server\. Keys typed now are not sent\./);
  xt.type('ls\r');
  assert.equal(xt.writes.join(''), '', 'no local echo of keys that go nowhere');
  env.online = true;
  pane.onHello({ type: 'hello', bootId: null });
  assert.doesNotMatch(doc.querySelector('.term-banners').textContent, /Reconnecting/);
  xt.type('ls\r');
  assert.ok(sent.some((m) => m.type === 'term-input' && m.data === 'ls\n'));
});

test('a send that fails mid-line (the socket just dropped) shows the reconnecting state and says the line was not sent', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const env = {};
  const { pane, doc, xt } = makePane({ ctx: RUN_CTX, env, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes], members: MEMBERS },
  }) });
  await pane.open();
  await tick();
  xt.type('ls');
  env.online = false;
  xt.type('\r');
  assert.match(xt.writes.join(''), /\[not sent: reconnecting\]/);
  assert.match(doc.querySelector('.term-banners').textContent, /Reconnecting/);
});

test('hiding and reopening the pane after the shell exited starts one new shell (an open shows a live shell)', async () => {
  const T2 = { ...SNAP, id: 't-2' };
  const routes = attachedRoutes({
    'POST /api/runs/r1/terminal': { session: T2, warning: null },
  });
  const { pane, calls, sent } = makePane({ ctx: RUN_CTX, routes });
  await pane.open();
  await tick();
  const ended = { ...SNAP, status: 'exited', exitCode: 0 };
  pane.onFrame({ type: 'term-status', snapshot: ended });
  routes['GET /api/terminal'] = { ...INFO, sessions: [ended] };
  routes['GET /api/runs/r1/terminal'] = { enabled: true, live: true, workspace: false, sessions: [ended], members: MEMBERS };
  pane.close();
  await pane.open();
  await tick();
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 1);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
});

test('an Ask session on this run (agent mode, #574) is an ordinary tab with its own label', async () => {
  const { pane, doc } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  pane.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-a', label: 'Ask · Fix tests · demo · main', createdBy: 'ask:ask_0000aaaa',
    createdAt: '2026-10-03T11:00:00.000Z' } });
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'Ask · Fix tests · demo · main', 'New terminal']);
});

// ── shared terminal: Ask's tabs everywhere, the pane never follows Ask on its own, a card shows its tab ──────
const ASK = { ...SNAP, id: 't-a', scope: 'project', runId: null, member: null, projectKey: 'demo-0000bbbb', label: 'Ask · Fix tests · demo · main',
  createdBy: 'ask:ask_0000aaaa', createdAt: '2026-10-03T11:00:00.000Z', cwd: '/w/demo' };
const PROJ_CTX = { view: 'project-detail', projectKey: 'app-0000aaaa' };
const PROJ_SNAP = { ...SNAP, id: 't-p', scope: 'project', runId: null, member: null, projectKey: 'app-0000aaaa', label: 'app', cwd: '/p/app' };

test('Ask\'s tabs show on every page, next to the page\'s own shell, which the page still starts', async () => {
  const { pane, doc, calls, sent } = makePane({ ctx: PROJ_CTX, routes: {
    'GET /api/terminal': { ...INFO, sessions: [ASK] },
    'GET /api/projects/app-0000aaaa/terminal': { enabled: true, dir: '/p/app', sessions: [] },
    'POST /api/projects/app-0000aaaa/terminal': { session: PROJ_SNAP, warning: null },
  } });
  await pane.open();
  await tick();
  assert.equal(posts(calls).length, 1, 'the project\'s own shell starts: an Ask tab is not this page\'s shell');
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-p');
  assert.deepEqual(tabTexts(doc), ['app', 'Ask · Fix tests · demo · main', 'New terminal']);
  const run = makePane({ ctx: RUN_CTX, routes: attachedRoutes({ 'GET /api/terminal': { ...INFO, sessions: [SNAP, ASK] } }) });
  await run.pane.open();
  await tick();
  assert.deepEqual(tabTexts(run.doc), ['r1 · app', 'Ask · Fix tests · demo · main', 'New terminal']);
  assert.equal(run.sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1');
});

test('showSession takes no auto mode: an Ask command never opens or switches the pane, so only a card click calls it', async () => {
  const { pane, doc, sent, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes({ 'GET /api/terminal': { ...INFO, sessions: [SNAP, ASK] } }) });
  await pane.open();
  await tick();
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1', 'opening the pane shows the page\'s own shell');
  assert.deepEqual(tabTexts(doc), ['r1 · app', 'Ask · Fix tests · demo · main', 'New terminal'], 'Ask\'s session is an ordinary tab');
  const focus = xt.made.focus || 0;
  await pane.showSession('t-a');                            // the card click: the one caller
  await tick();
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
  assert.ok((xt.made.focus || 0) > focus, 'a card click focuses the tab');
});

test('a card click opens the pane on that tab and focuses it, even after the user closed the pane', async () => {
  const { pane, sent, xt } = makePane({ ctx: { view: 'stats' }, routes: { 'GET /api/terminal': { ...INFO, sessions: [ASK] } } });
  await pane.showSession('t-a');
  await tick();
  pane.close();
  await pane.showSession('t-a');
  await tick();
  assert.equal(pane.isOpen(), true);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
  assert.ok(xt.made.focus >= 1);
  await pane.showSession('t-gone');                         // a session the server no longer has: nothing happens
  await tick();
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
});

test('moving to another page after a card click showed Ask\'s tab: that page\'s own shell is attached; Ask\'s tab stays a tab', async () => {
  const { pane, doc, sent, env } = makePane({ ctx: RUN_CTX, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [SNAP, ASK, PROJ_SNAP] },
    'GET /api/projects/app-0000aaaa/terminal': { enabled: true, dir: '/p/app', sessions: [PROJ_SNAP] },
  }) });
  await pane.showSession('t-a');
  await tick();
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
  env.ctx = PROJ_CTX;
  pane.onContextChange();
  await tick(12);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-p');
  assert.deepEqual(tabTexts(doc), ['app', 'Ask · Fix tests · demo · main', 'New terminal']);
});

test('a replay is drawn at the width the shell wrote it for, then fitted to the pane (xterm reflows it)', async () => {
  const { pane, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  xt.made.log = [];
  // zsh wrapped a long command at its PTY's 100 columns (` \r\e[K`): drawn at another width it erases the line start.
  pane.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2, snapshot: { ...SNAP, cols: 100, rows: 30 } });
  assert.deepEqual(xt.made.log, ['resize:100x30', 'write:AB', 'fit']);
  xt.made.log = [];
  pane.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'CD', seq: 3 });             // no size known: as before
  assert.deepEqual(xt.made.log, ['write:CD']);
});

test('replay segments: each part is drawn at its own width, then the screen fits the pane', async () => {
  const { pane, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  xt.made.log = [];
  pane.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2, snapshot: { ...SNAP, cols: 140, rows: 40 },
    segments: [{ cols: 100, rows: 30, data: 'A' }, { cols: 140, rows: 40, data: 'B' }] });
  assert.deepEqual(xt.made.log, ['resize:100x30', 'write:A', 'resize:140x40', 'write:B', 'fit']);
});

test('replay segments: live data that arrives while the replay is still being drawn waits for it', async () => {
  const { pane, xt } = makePane({ ctx: RUN_CTX, routes: attachedRoutes() });
  await pane.open();
  await tick();
  xt.made.held = [];                                         // xterm has not parsed the writes yet: callbacks wait
  pane.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2, segments: [{ cols: 100, rows: 30, data: 'A' }, { cols: 140, rows: 40, data: 'B' }] });
  pane.onFrame({ type: 'term-data', sessionId: 't-1', data: 'C', seq: 3 });
  assert.equal(xt.writes.join(''), 'A', 'the second part waits for the first one\'s parse; the live chunk waits too');
  while (xt.made.held.length) xt.made.held.shift()();
  assert.equal(xt.writes.join(''), 'ABC');
});
