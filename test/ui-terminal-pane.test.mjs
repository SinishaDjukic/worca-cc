// test/ui-terminal-pane.test.mjs — the Terminal tool of the tool panel (#573, #1064): a tab starts or reattaches its
// shell, checks out first, Enter restarts an ended shell, the pipes banner, the hosted message, and the panel's hooks
// (mount, unmount, close, onSessions). No Commands list: commands are recorded for the audit log only. xterm is faked
// (jsdom has no canvas). The panel's own rows are in test/ui-tool-panel.test.mjs; this tool inside the real panel is in
// test/ui-tool-panel-terminal.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTerminalTool } from '../ui/public/terminal-pane.mjs';
import { viewOf } from '../ui/public/tool-tabs.mjs';

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

/** The tool on its own, with a minimal panel api: `show(tab)` mounts like the panel does; `ctx` gives the view. */
function makeTool({ ctx, routes, url = 'http://localhost:4317/', env = {}, beforeCreate = null, confirm = null }) {
  const dom = new JSDOM('<!doctype html><body></body>', { url });
  if (beforeCreate) beforeCreate(dom.window);
  env.ctx ??= ctx;
  env.online ??= true;
  const sent = [];
  const calls = [];
  const fetch = async (u, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null });
    const h = routes[`${method} ${u.split('?')[0]}`];
    const v = typeof h === 'function' ? h(u, opts) : h;
    const status = v?.__status || (v === undefined ? 404 : 200);
    return { ok: status < 400, status, json: async () => v ?? {} };
  };
  const xt = fakeXterm();
  const tabs = new Map();
  const opened = [];
  const synced = [];
  let mounted = null;
  const api = {
    tab: (id) => tabs.get(id) || null,
    isMounted: (id) => mounted === id,
    scopeFor: (t) => { const side = viewOf(env.ctx)?.side; return side && side.type === t.scope.type && side.id === t.scope.id ? { ...side, ...t.scope } : t.scope; },
    setTabState: (id, p) => { const t = tabs.get(id); if (t) t.state = { ...t.state, ...p }; },
    openTab: (kind, scope, state) => { opened.push({ kind, scope, state }); return null; },
    close: () => {},
    view: () => viewOf(env.ctx),
  };
  const sendWs = (m) => { if (!env.online) return false; sent.push(m); return true; };
  const tool = createTerminalTool({ doc: dom.window.document, win: dom.window, fetch, sendWs, confirm, loadXterm: xt.load,
    onSessions: (list) => synced.push(list.map((s) => s.id)) });
  const doc = dom.window.document;
  const show = async (tab) => { tabs.set(tab.id, tab); mounted = tab.id; await tool.kind.mount(tab, doc.body, api); await tick(); return tab; };
  const hide = () => { mounted = null; tool.kind.unmount(); };
  const runTab = (state = {}) => ({ id: `tab_r${tabs.size + 1}`, kind: 'terminal', scope: viewOf(env.ctx).side, state });
  const projectTab = (state = {}) => ({ id: `tab_p${tabs.size + 1}`, kind: 'terminal', scope: { type: 'project', id: viewOf(env.ctx).project }, state });
  return { tool, show, hide, runTab, projectTab, tabs, doc, sent, calls, xt, env, opened, synced };
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
const posts = (calls, path) => calls.filter((c) => c.method === 'POST' && (!path || c.url.split('?')[0] === path));
const LIVE_MEMBER = { projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/runs/r1/repos/app',
  warning: 'This pipeline is still running and changing these files.' };
// ── shared terminal: Ask's tabs everywhere, the pane never follows Ask on its own, a card shows its tab ──────
const ASK = { ...SNAP, id: 't-a', scope: 'project', runId: null, member: null, projectKey: 'demo-0000bbbb', label: 'Ask · Fix tests · demo · main',
  createdBy: 'ask:ask_0000aaaa', createdAt: '2026-10-03T11:00:00.000Z', cwd: '/w/demo' };
const PROJ_CTX = { view: 'project-detail', projectKey: 'app-0000aaaa' };
const PROJ_SNAP = { ...SNAP, id: 't-p', scope: 'project', runId: null, member: null, projectKey: 'app-0000aaaa', label: 'app', cwd: '/p/app' };
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
const WS_CTX = { view: 'running', pipelineId: 'w1', workspaceId: 'wks-1' };
const WS_MEMBERS = [{ projectKey: 'api-0000bbbb', projectName: 'api', state: 'worktree', cwd: '/a' }, { projectKey: 'web-0000cccc', projectName: 'web', state: 'worktree', cwd: '/w' }];

test('a live run: a new tab starts a shell in its folder, with the member and size, attaches it and warns', async () => {
  const { show, runTab, doc, sent, calls } = makeTool({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [LIVE_MEMBER] },
    'POST /api/runs/r1/terminal': { session: { ...SNAP, cwd: LIVE_MEMBER.cwd }, warning: LIVE_MEMBER.warning },
  } });
  await show(runTab());
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

test('the tool renders no Commands control or list, and leaves recorded commands to the server', async () => {
  const { tool, show, runTab, doc, calls, xt } = makeTool({ ctx: RUN_CTX, url: 'http://localhost:4317/?terminal=t-1&block=1', routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  tool.onFrame({ type: 'term-block', sessionId: 't-1', block: { sessionId: 't-1', seq: 1, command: 'npm test', status: 'done', exitCode: 0 } });
  assert.equal(doc.querySelector('.term-cmds'), null);
  assert.equal(doc.querySelector('.term-blocks'), null);
  assert.equal(doc.querySelector('.term-block'), null);
  assert.doesNotMatch(doc.querySelector('.term-body').textContent, /Commands|Run again|Copy link/);
  assert.equal([...doc.querySelectorAll('.term-body [aria-label]')].some((n) => /command/i.test(n.getAttribute('aria-label'))), false);
  assert.equal(calls.some((c) => c.url.startsWith('/api/terminal/sessions/')), false, 'no blocks fetched');
  assert.doesNotMatch(xt.writes.join(''), /npm test/, 'a term-block frame is not drawn');
});

test('showing a tab again reattaches its running shell instead of starting another', async () => {
  const { show, hide, runTab, calls, sent } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  const tab = await show(runTab({ sessionId: 't-1' }));
  hide();
  await show(tab);
  assert.equal(posts(calls).length, 0);
  assert.deepEqual(sent.filter((m) => m.type === 'term-attach' || m.type === 'term-detach').map((m) => `${m.type} ${m.sessionId}`),
    ['term-attach t-1', 'term-detach t-1', 'term-attach t-1'], 'hidden, the tab lets go of its shell; shown again, it reattaches');
});

test('a project tab: the shell opens in the project\'s own folder (no branch in the request)', async () => {
  const PROJ = { ...SNAP, id: 't-p', scope: 'project', runId: null, member: null, projectKey: 'app-0000aaaa', branch: 'dev', cwd: '/p/app', label: 'app · dev', runLive: false };
  const { show, projectTab, doc, calls, sent } = makeTool({ ctx: { view: 'project-detail', projectKey: 'app-0000aaaa' }, routes: {
    'GET /api/terminal': INFO,
    'POST /api/projects/app-0000aaaa/terminal': { session: PROJ, warning: null },
  } });
  await show(projectTab());
  const p = posts(calls);
  assert.equal(p.length, 1);
  assert.equal(p[0].url, '/api/projects/app-0000aaaa/terminal');
  assert.deepEqual(p[0].body, { cols: 80, rows: 24 });
  assert.ok(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-p'));
  assert.equal(doc.querySelector('.term-folder').textContent, '/p/app');
  assert.equal(doc.querySelector('.term-warn'), null);
});

test('a project tab bound to the own-folder shell reattaches it, never the branch-folder one beside it', async () => {
  const PROJ = { ...SNAP, id: 't-p', scope: 'project', runId: null, projectKey: 'app-0000aaaa', cwd: '/p/app' };
  const BR = { ...PROJ, id: 't-b', scope: 'branch', cwd: '/home/terminal/worktrees/app/dev', createdAt: '2026-10-03T11:00:00.000Z' };
  const { show, projectTab, calls, sent } = makeTool({ ctx: { view: 'project-detail', projectKey: 'app-0000aaaa' }, routes: {
    'GET /api/terminal': { ...INFO, sessions: [PROJ, BR] },
  } });
  await show(projectTab({ sessionId: 't-p' }));
  assert.equal(posts(calls).length, 0);
  assert.deepEqual(sent.filter((m) => m.type === 'term-attach').map((m) => m.sessionId), ['t-p']);
});

// The start POST makes the checkout server-side. The pane must NOT ask POST /checkout for it: that route
// refuses a member the run did not change (409 NOT_AFFECTED), which turned "give me a shell" into
// "No changes in this project" and left such a member with no terminal at all.
test('a finished run without a checkout: the shell start makes it, and /checkout is never asked', async () => {
  let checkedOut = false;
  const DONE = { ...SNAP, runLive: false, cwd: '/home/checkouts/r1/app' };
  const { show, runTab, doc, calls, sent } = makeTool({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': () => ({ enabled: true, live: false, finished: true, workspace: false, sessions: [],
      members: [checkedOut ? { projectKey: 'app-0000aaaa', projectName: 'app', state: 'checkout', cwd: DONE.cwd }
        : { projectKey: 'app-0000aaaa', projectName: 'app', state: 'needs-checkout', cwd: null }] }),
    'POST /api/runs/r1/checkout': { __status: 409, error: 'No changes in this project', code: 'NOT_AFFECTED' },
    'POST /api/runs/r1/terminal': () => { checkedOut = true; return { session: DONE, warning: null }; },
  } });
  await show(runTab());
  const p = posts(calls);
  assert.deepEqual(p.map((c) => c.url), ['/api/runs/r1/terminal?projectDir=%2Fp%2Fapp']);
  assert.equal(p[0].body.member, 'app-0000aaaa');
  assert.ok(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-1'));
  assert.equal(doc.querySelector('.term-folder').textContent, DONE.cwd);
  // That start made a checkout, so the picker's 'needs-checkout' is stale: the pane re-reads the context.
  const i = calls.findIndex((c) => c.method === 'POST');
  assert.ok(calls.slice(i + 1).some((c) => c.method === 'GET' && c.url.startsWith('/api/runs/r1/terminal')),
    'the context is read again after the start');
});

test('a run with no folder shows the reason and starts nothing (no Enter line either)', async () => {
  const { show, runTab, doc, calls, xt } = makeTool({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [],
      members: [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'unavailable', cwd: null, reason: 'This run has no folder yet.' }] },
  } });
  await show(runTab());
  assert.equal(posts(calls).length, 0);
  assert.equal(doc.querySelector('.term-context').textContent, 'This run has no folder yet.');
  assert.doesNotMatch(xt.writes.join(''), /Press Enter/, 'no Enter line: there is nothing to start');
});

test('a workspace run: the member select, a shell started on the selected member, and the other member\'s shell in a tab of its own', async () => {
  const api = { ...SNAP, id: 't-a', runId: 'w1', member: 'api-0000bbbb', cwd: '/a', runLive: false };
  const web = { ...SNAP, id: 't-w', runId: 'w1', member: 'web-0000cccc', cwd: '/w', runLive: false };
  const { show, runTab, doc, calls, sent, opened } = makeTool({ ctx: WS_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/w1/terminal': { enabled: true, live: true, workspace: true, sessions: [], members: WS_MEMBERS },
    'POST /api/runs/w1/terminal': (url, opts) => ({ session: JSON.parse(opts.body).member === 'api-0000bbbb' ? api : web, warning: null }),
  } });
  const tab = await show(runTab());
  assert.deepEqual([...doc.querySelectorAll('.term-member option')].map((o) => o.textContent), ['api', 'web']);
  assert.deepEqual(posts(calls).map((c) => c.body.member), ['api-0000bbbb']);
  assert.equal(posts(calls)[0].url, '/api/runs/w1/terminal?workspaceId=wks-1');
  const sel = doc.querySelector('.term-member');
  sel.value = 'web-0000cccc';
  sel.dispatchEvent(new doc.defaultView.Event('change'));
  await tick();
  assert.deepEqual(posts(calls).map((c) => c.body.member), ['api-0000bbbb'], 'a running shell keeps its folder: no second POST from this tab');
  assert.deepEqual(opened, [{ kind: 'terminal', scope: tab.scope, state: { member: 'web-0000cccc' } }]);
  await show({ id: 'tab_w', kind: 'terminal', scope: opened[0].scope, state: opened[0].state });   // the panel shows the new tab
  assert.deepEqual(posts(calls).map((c) => c.body.member), ['api-0000bbbb', 'web-0000cccc']);
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-a'));
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-w');
  await show(tab);
  assert.equal(posts(calls).length, 2, 'back on api\'s tab: its running shell is reattached, not a new one');
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
});

test('a warning belongs to its terminal: shown with it, gone once another member\'s shell is attached', async () => {
  const api = { ...SNAP, id: 't-a', scope: 'run', runId: 'w1', member: 'api-0000bbbb', runLive: true };
  const web = { ...SNAP, id: 't-w', scope: 'run', runId: 'w1', member: 'web-0000cccc', runLive: false };
  const { show, runTab, doc, opened } = makeTool({ ctx: WS_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/w1/terminal': { enabled: true, live: true, workspace: true, sessions: [], members: WS_MEMBERS },
    'POST /api/runs/w1/terminal': (url, opts) => (JSON.parse(opts.body).member === 'api-0000bbbb'
      ? { session: api, warning: 'API is still changing.' } : { session: web, warning: null }),
  } });
  await show(runTab());
  assert.equal(doc.querySelector('.term-context .term-warn')?.textContent, 'API is still changing.');
  assert.equal(doc.querySelector('.term-context .term-error'), null, 'a warning is not shown as an error');
  const sel = doc.querySelector('.term-member');
  sel.value = 'web-0000cccc';
  sel.dispatchEvent(new doc.defaultView.Event('change'));
  await tick();
  await show({ id: 'tab_w', kind: 'terminal', scope: opened[0].scope, state: opened[0].state });
  assert.equal(doc.querySelector('.term-context .term-warn'), null);
});

test('never two shells for one tab: showing it again while its start is in flight posts once; another run\'s tab waits', async () => {
  const env = {};
  let release;
  const gate = new Promise((r) => { release = r; });
  const { show, runTab, tabs, calls, sent } = makeTool({ ctx: RUN_CTX, env, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [LIVE_MEMBER] },
    'GET /api/runs/r2/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [{ ...LIVE_MEMBER, cwd: '/r2' }] },
    'POST /api/runs/r1/terminal': () => gate.then(() => ({ session: SNAP, warning: null })),
    'POST /api/runs/r2/terminal': () => gate.then(() => ({ session: { ...SNAP, id: 't-2', runId: 'r2' }, warning: null })),
  } });
  const t1 = runTab();
  const shown = [show(t1), show(t1)];
  await tick();
  env.ctx = { ...RUN_CTX, pipelineId: 'r2' };
  const t2 = { ...runTab(), id: 'tab_r2' };
  shown.push(show(t2));
  await tick();
  env.ctx = RUN_CTX;
  shown.push(show(t1));
  await tick();
  release();
  await Promise.all(shown);
  await tick(12);
  assert.deepEqual(posts(calls).map((c) => c.url.split('?')[0]), ['/api/runs/r1/terminal', '/api/runs/r2/terminal']);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1', 'the tab on screen gets its shell');
  assert.equal(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-2'), false, 'r2\'s shell is bound to its tab and waits');
  assert.equal(tabs.get('tab_r2').state.sessionId, 't-2');
  await show(t1);
  assert.equal(posts(calls).length, 2, 'showing the tab again reattaches');
});

test('an exited shell is not replaced on its own: a dim line, then Enter (only) starts one', async () => {
  const T2 = { ...SNAP, id: 't-2', createdAt: '2026-10-03T11:00:00.000Z' };
  const { tool, show, hide, runTab, calls, sent, xt, tabs } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes({
    'POST /api/runs/r1/terminal': { session: T2, warning: null },
  }) });
  const tab = await show(runTab({ sessionId: 't-1' }));
  tool.onFrame({ type: 'term-status', snapshot: { ...SNAP, status: 'exited', exitCode: 0 } });
  await tick();
  assert.match(xt.writes.join(''), /\x1b\[2m\[shell exited with code 0\. Press Enter for a new one\]/);
  hide();
  await show(tab);
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
  assert.equal(tabs.get(tab.id).state.sessionId, 't-2', 'the tab is bound to its new shell');
});

test('a tab\'s × closes an unused terminal without asking', async () => {
  const T2 = { ...SNAP, id: 't-2', commands: 0, createdAt: '2026-10-03T11:00:00.000Z' };
  const asked = [];
  const { tool, show, runTab, sent, calls } = makeTool({ ctx: RUN_CTX, confirm: async (o) => { asked.push(o); return true; }, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [SNAP, T2] },
    'DELETE /api/terminal/sessions/t-2': { ok: true },
  }) });
  const tab = await show(runTab({ sessionId: 't-2' }));
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
  assert.equal(await tool.kind.close(tab), true, 'the panel drops the tab');
  assert.equal(asked.length, 0, 'no command ran there: no question');
  assert.deepEqual(deletes(calls), ['/api/terminal/sessions/t-2']);
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-2'));
  tool.onFrame({ type: 'term-status', snapshot: { ...T2, status: 'closed' } });
  assert.equal(await tool.kind.close({ ...tab, state: { sessionId: 'never-started' } }), true, 'a tab with no live shell just leaves');
  assert.deepEqual(deletes(calls), ['/api/terminal/sessions/t-2']);
});

test('a tab\'s × on a terminal that ran a command asks first; No keeps it, Yes closes it', async () => {
  const used = { ...SNAP, commands: 2, currentBlock: { seq: 2, command: 'npm test' } };
  let answer = false;
  const asked = [];
  const { tool, show, runTab, calls } = makeTool({ ctx: RUN_CTX, confirm: async (o) => { asked.push(o); return answer; }, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [used] },
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [used], members: MEMBERS },
    'DELETE /api/terminal/sessions/t-1': { ok: true },
  }) });
  const tab = await show(runTab({ sessionId: 't-1' }));
  assert.equal(await tool.kind.close(tab), false, 'No keeps the tab');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].danger, undefined, 'nothing is lost: a plain button, not a red one');
  assert.match(asked[0].message, /2 commands have run in r1 · app/);
  assert.match(asked[0].message, /npm test is still running/);
  assert.deepEqual(deletes(calls), [], 'No: nothing is closed');
  answer = true;
  assert.equal(await tool.kind.close(tab), true);
  assert.deepEqual(deletes(calls), ['/api/terminal/sessions/t-1']);
  assert.equal(posts(calls).length, 0, 'no new shell unasked');
});

test('a failed close keeps the tab attached and says why', async () => {
  const { tool, show, runTab, doc, sent } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes({
    'DELETE /api/terminal/sessions/t-1': { __status: 404, error: 'No running terminal with that id.' },
  }) });
  const tab = await show(runTab({ sessionId: 't-1' }));
  assert.equal(await tool.kind.close(tab), false);
  assert.ok(!sent.some((m) => m.type === 'term-detach'));
  assert.match(doc.querySelector('.term-error').textContent, /No running terminal/);
});

test('pipes mode: Ctrl+C typed in the terminal calls the stop API', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const { show, runTab, calls, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes], members: MEMBERS },
    'POST /api/terminal/sessions/t-1/stop': { ok: true, blockSeq: 1 },
  }) });
  await show(runTab({ sessionId: 't-1' }));
  xt.type('\x03');
  await tick();
  assert.deepEqual(posts(calls).map((c) => c.url), ['/api/terminal/sessions/t-1/stop']);
});

test('pty mode: Ctrl+C goes to the shell as a keystroke, not to the stop API', async () => {
  const { show, runTab, calls, sent, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  xt.type('\x03');
  await tick();
  assert.equal(posts(calls).length, 0);
  assert.ok(sent.some((m) => m.type === 'term-input' && m.data === '\x03'));
});

test('pipes mode: the banner, local echo, and a line sent on Enter', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const { show, runTab, doc, sent, xt } = makeTool({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': { ...INFO, pty: { available: false, reason: 'node-pty is not installed on this server (MODULE_NOT_FOUND)' }, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes],
      members: [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/x' }] },
  } });
  await show(runTab({ sessionId: 't-1' }));
  assert.match(doc.querySelector('.term-banners').textContent, /Full-screen programs \(vim, top, less\) do not work here/);
  xt.type('ls\r');
  assert.ok(xt.writes.includes('ls\r\n'));
  assert.ok(sent.some((m) => m.type === 'term-input' && m.data === 'ls\n'));
});

test('hosted and off: the tool says how to turn it on, starts nothing, and the kind says why it is unavailable', async () => {
  const { tool, show, runTab, doc, calls } = makeTool({ ctx: RUN_CTX, routes: { 'GET /api/terminal': { ...INFO, enabled: false } } });
  assert.equal(tool.kind.unavailable(), null, 'unknown until the first list');
  await show(runTab());
  assert.match(doc.querySelector('.term-context').textContent, /WORCA_TERMINAL_REMOTE=1/);
  assert.equal(posts(calls).length, 0);
  assert.equal(calls.some((c) => c.url.startsWith('/api/runs/')), false, 'no run lookup while the terminal is off');
  assert.match(tool.kind.unavailable(), /turned off on this hosted deployment/);
});

test('replay then data: duplicates by seq are dropped', async () => {
  const { tool, show, runTab, xt } = makeTool({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': { ...INFO, sessions: [SNAP] },
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [SNAP], members: [{ projectKey: 'app-0000aaaa', projectName: 'app', state: 'worktree', cwd: '/x' }] },
  } });
  await show(runTab({ sessionId: 't-1' }));
  tool.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2 });
  tool.onFrame({ type: 'term-data', sessionId: 't-1', data: 'B', seq: 2 });
  tool.onFrame({ type: 'term-data', sessionId: 't-1', data: 'C', seq: 3 });
  assert.equal(xt.writes.join(''), 'ABC');
});

test('xterm opens in an unpadded host inside the framed screen, so FitAddon does not count the frame (finding 1)', async () => {
  const { show, runTab, doc, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  assert.equal(xt.made.openedIn, doc.querySelector('.term-body > .term-screen > .term-host'));
});

test('attach fits and sends the size, so a session opened at another width gets this one (finding 5)', async () => {
  const { show, runTab, sent } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(sent.some((m) => m.type === 'term-resize' && m.sessionId === 't-1' && m.cols === 80 && m.rows === 24));
});

test('moving to another run lets go of the previous shell and starts that run\'s own (finding 3)', async () => {
  const env = {};
  const T2 = { ...SNAP, id: 't-2', runId: 'r2', cwd: '/runs/r2' };
  let releaseT2;
  const t2Gate = new Promise((r) => { releaseT2 = r; });
  const { tool, show, hide, runTab, doc, sent, xt, calls } = makeTool({ ctx: RUN_CTX, env, routes: attachedRoutes({
    'GET /api/runs/r2/terminal': { enabled: true, live: false, workspace: false, sessions: [], members: [{ ...MEMBERS[0], cwd: '/runs/r2' }] },
    'POST /api/runs/r2/terminal': () => t2Gate.then(() => ({ session: T2, warning: null })),
  }) });
  await show(runTab({ sessionId: 't-1' }));
  tool.onFrame({ type: 'term-data', sessionId: 't-1', data: 'old output', seq: 1 });
  hide();                                                   // the panel unmounts r1's tab when the view moves to r2
  env.ctx = { ...RUN_CTX, pipelineId: 'r2' };
  const shown = show(runTab());
  await tick();
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'));
  assert.deepEqual(xt.writes, [], 'the old screen is cleared');
  assert.match(doc.querySelector('.term-context').textContent, /\/runs\/r2/);
  const before = sent.length;
  xt.type('rm -rf build\r');
  assert.equal(sent.slice(before).filter((m) => m.type === 'term-input').length, 0, 'no keystroke reaches the other run\'s shell');
  releaseT2();
  await shown;
  assert.deepEqual(posts(calls).map((c) => c.url.split('?')[0]), ['/api/runs/r2/terminal']);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
});

test('an open select survives unrelated updates (finding 6)', async () => {
  const api = { ...SNAP, runId: 'w1', member: 'api-0000bbbb' };
  const other = { ...SNAP, id: 't-9', runId: 'r9', member: 'x', label: 'other', createdAt: '2026-10-03T09:00:00.000Z' };
  const { tool, show, runTab, doc } = makeTool({ ctx: WS_CTX, routes: {
    'GET /api/terminal': { ...INFO, sessions: [api, other] },
    'GET /api/runs/w1/terminal': { enabled: true, live: true, workspace: true, sessions: [api], members: WS_MEMBERS },
  } });
  await show(runTab({ sessionId: 't-1' }));
  const member = doc.querySelector('.term-member');
  assert.ok(member);
  tool.onFrame({ type: 'term-status', snapshot: { ...api, currentBlock: { seq: 1, command: 'cmd 1' } } });
  tool.onFrame({ type: 'term-status', snapshot: { ...other, currentBlock: { seq: 1, command: 'cmd 2' } } });
  assert.equal(doc.querySelector('.term-member'), member, 'the member select is not rebuilt by a status frame');
});

test('xterm gets all 16 ANSI colours, each from its --term-ansi-* token (finding 7)', async () => {
  const { show, runTab, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes(), beforeCreate: (win) => {
    const real = win.getComputedStyle.bind(win);
    // jsdom resolves no var(): answer with the token name each probe asks for.
    win.getComputedStyle = (el) => {
      const v = el.style?.getPropertyValue?.('color') || '';
      return v.startsWith('var(') ? { color: v.slice(4, -1) } : real(el);
    };
  } });
  await show(runTab({ sessionId: 't-1' }));
  const t = xt.made.options.theme;
  assert.equal(t.red, '--term-ansi-red');
  assert.equal(t.brightWhite, '--term-ansi-bright-white');
  assert.equal(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].flatMap((c) => [c, `bright${c[0].toUpperCase()}${c.slice(1)}`])
    .filter((k) => t[k]).length, 16);
});

test('a server restart forgets the shell and its screen, and starts a new one only on Enter (finding 9)', async () => {
  const T2 = { ...SNAP, id: 't-2' };
  const routes = attachedRoutes({ 'POST /api/runs/r1/terminal': { session: T2, warning: null } });
  const { tool, show, runTab, doc, sent, xt, calls, synced, tabs } = makeTool({ ctx: RUN_CTX, routes });
  tool.onHello({ type: 'hello', bootId: 'boot-a' });
  const tab = await show(runTab({ sessionId: 't-1' }));
  tool.onFrame({ type: 'term-data', sessionId: 't-1', data: 'before', seq: 1 });
  routes['GET /api/terminal'] = { ...INFO, sessions: [] };
  routes['GET /api/runs/r1/terminal'] = { enabled: true, live: true, workspace: false, sessions: [], members: MEMBERS };
  tool.onHello({ type: 'hello', bootId: 'boot-b' });
  await tick(12);
  assert.doesNotMatch(xt.writes.join(''), /before/);
  assert.match(xt.writes.join(''), /\[the worca server restarted\. Press Enter for a new one\]/);
  assert.deepEqual(synced.at(-1), [], 'the panel hears the empty list: every other terminal tab leaves');
  assert.match(doc.querySelector('.term-context').textContent, /server restarted/);
  assert.equal(posts(calls).length, 0, 'no respawn');
  const before = sent.length;
  xt.type('ls');
  assert.equal(sent.slice(before).filter((m) => m.type === 'term-input').length, 0);
  xt.type('\r');
  await tick();
  assert.equal(posts(calls).length, 1);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
  assert.equal(tabs.get(tab.id).state.sessionId, 't-2');
});

test('onSessions drops sessions the server no longer lists', async () => {
  const routes = { 'GET /api/terminal': { ...INFO, sessions: [SNAP, { ...SNAP, id: 't-2', label: 'gone', createdAt: '2026-10-03T09:00:00.000Z' }] } };
  const { tool, synced } = makeTool({ ctx: { view: 'stats' }, routes });
  await tool.refreshInfo();
  assert.deepEqual(synced.at(-1), ['t-1', 't-2']);
  routes['GET /api/terminal'] = { ...INFO, sessions: [SNAP] };
  await tool.refreshInfo();
  assert.deepEqual(synced.at(-1), ['t-1']);
  assert.deepEqual(tool.sessions().map((s) => s.id), ['t-1']);
});

test('while /ws reconnects the tool says so and does not echo a line it could not send (finding 10)', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const env = {};
  const { tool, show, runTab, doc, sent, xt } = makeTool({ ctx: RUN_CTX, env, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes], members: MEMBERS },
  }) });
  await show(runTab({ sessionId: 't-1' }));
  env.online = false;
  tool.onConnection(false);
  assert.match(doc.querySelector('.term-banners').textContent, /Reconnecting to the worca server\. Keys typed now are not sent\./);
  xt.type('ls\r');
  assert.equal(xt.writes.join(''), '', 'no local echo of keys that go nowhere');
  env.online = true;
  tool.onHello({ type: 'hello', bootId: null });
  assert.doesNotMatch(doc.querySelector('.term-banners').textContent, /Reconnecting/);
  xt.type('ls\r');
  assert.ok(sent.some((m) => m.type === 'term-input' && m.data === 'ls\n'));
});

test('after a /ws drop the list is read again: shells that opened or closed meanwhile reach the panel', async () => {
  const routes = attachedRoutes();
  const { tool, show, runTab, synced } = makeTool({ ctx: RUN_CTX, routes });
  await show(runTab({ sessionId: 't-1' }));
  tool.onConnection(false);
  routes['GET /api/terminal'] = { ...INFO, sessions: [SNAP, { ...SNAP, id: 't-5', createdAt: '2026-10-03T12:00:00.000Z' }] };
  tool.onHello({ type: 'hello', bootId: null });
  await tick();
  assert.deepEqual(synced.at(-1), ['t-1', 't-5']);
});

test('a send that fails mid-line (the socket just dropped) shows the reconnecting state and says the line was not sent', async () => {
  const pipes = { ...SNAP, mode: 'pipes' };
  const env = {};
  const { show, runTab, doc, xt } = makeTool({ ctx: RUN_CTX, env, routes: attachedRoutes({
    'GET /api/terminal': { ...INFO, sessions: [pipes] },
    'GET /api/runs/r1/terminal': { enabled: true, live: false, workspace: false, sessions: [pipes], members: MEMBERS },
  }) });
  await show(runTab({ sessionId: 't-1' }));
  xt.type('ls');
  env.online = false;
  xt.type('\r');
  assert.match(xt.writes.join(''), /\[not sent: reconnecting\]/);
  assert.match(doc.querySelector('.term-banners').textContent, /Reconnecting/);
});

test('hiding and showing a tab whose shell exited: one Enter line, and Enter starts one new shell', async () => {
  const T2 = { ...SNAP, id: 't-2' };
  const routes = attachedRoutes({
    'POST /api/runs/r1/terminal': { session: T2, warning: null },
  });
  const { tool, show, hide, runTab, calls, sent, xt } = makeTool({ ctx: RUN_CTX, routes });
  const tab = await show(runTab({ sessionId: 't-1' }));
  const ended = { ...SNAP, status: 'exited', exitCode: 0 };
  tool.onFrame({ type: 'term-status', snapshot: ended });
  routes['GET /api/terminal'] = { ...INFO, sessions: [ended] };
  routes['GET /api/runs/r1/terminal'] = { enabled: true, live: true, workspace: false, sessions: [ended], members: MEMBERS };
  hide();
  await show(tab);
  assert.equal(posts(calls).length, 0, 'showing an ended shell\'s tab starts nothing on its own');
  assert.equal(xt.writes.join('').match(/Press Enter for a new one/g)?.length, 1);
  xt.type('\r');
  await tick();
  assert.equal(posts(calls).length, 1);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-2');
});

test('a chat\'s agent-mode shell (#574): its chat tab attaches it and takes its label', async () => {
  const { tool, show, doc, sent, calls } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes({ 'GET /api/terminal': { ...INFO, sessions: [SNAP, ASK] } }) });
  const tab = await show({ id: 'tab_c1', kind: 'terminal', scope: { type: 'chat', id: 'ask_0000aaaa', projectKey: 'demo-0000bbbb' }, state: { sessionId: 't-a' } });
  assert.equal(posts(calls).length, 0);
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-a');
  assert.equal(tool.kind.title(tab), 'Ask · Fix tests · demo · main');
  assert.equal(doc.querySelector('.term-folder').textContent, '/w/demo');
});

test('a project tab still starts the project\'s own shell while a chat\'s agent shell runs in that project', async () => {
  const { show, projectTab, calls, sent, synced } = makeTool({ ctx: PROJ_CTX, routes: {
    'GET /api/terminal': { ...INFO, sessions: [ASK] },
    'POST /api/projects/app-0000aaaa/terminal': { session: PROJ_SNAP, warning: null },
  } });
  await show(projectTab());
  assert.equal(posts(calls).length, 1, 'the project\'s own shell starts: a chat\'s shell is not this tab\'s');
  assert.equal(sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-p');
  assert.deepEqual(synced.at(-1), ['t-a', 't-p'], 'the panel keeps a tab for each');
});

test('a replay is drawn at the width the shell wrote it for, then fitted to the tool (xterm reflows it)', async () => {
  const { tool, show, runTab, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  xt.made.log = [];
  // zsh wrapped a long command at its PTY's 100 columns (` \r\e[K`): drawn at another width it erases the line start.
  tool.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2, snapshot: { ...SNAP, cols: 100, rows: 30 } });
  assert.deepEqual(xt.made.log, ['resize:100x30', 'write:AB', 'fit']);
  xt.made.log = [];
  tool.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'CD', seq: 3 });             // no size known: as before
  assert.deepEqual(xt.made.log, ['write:CD']);
});

test('replay segments: each part is drawn at its own width, then the screen fits the tool', async () => {
  const { tool, show, runTab, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  xt.made.log = [];
  tool.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2, snapshot: { ...SNAP, cols: 140, rows: 40 },
    segments: [{ cols: 100, rows: 30, data: 'A' }, { cols: 140, rows: 40, data: 'B' }] });
  assert.deepEqual(xt.made.log, ['resize:100x30', 'write:A', 'resize:140x40', 'write:B', 'fit']);
});

test('replay segments: live data that arrives while the replay is still being drawn waits for it', async () => {
  const { tool, show, runTab, xt } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  xt.made.held = [];                                         // xterm has not parsed the writes yet: callbacks wait
  tool.onFrame({ type: 'term-replay', sessionId: 't-1', data: 'AB', seq: 2, segments: [{ cols: 100, rows: 30, data: 'A' }, { cols: 140, rows: 40, data: 'B' }] });
  tool.onFrame({ type: 'term-data', sessionId: 't-1', data: 'C', seq: 3 });
  assert.equal(xt.writes.join(''), 'A', 'the second part waits for the first one\'s parse; the live chunk waits too');
  while (xt.made.held.length) xt.made.held.shift()();
  assert.equal(xt.writes.join(''), 'ABC');
});

test('a chat tab starts its shell through the chat route and binds it to the tab', async () => {
  const ctx = { view: 'chat', chatId: 'ask_1', chatProjectKey: 'app-0000aaaa' };
  const { show, calls, sent, tabs } = makeTool({ ctx, routes: {
    'GET /api/terminal': INFO,
    'POST /api/ask/threads/ask_1/terminal': { session: { ...SNAP, id: 't-c', scope: 'chat', chatId: 'ask_1' }, warning: null },
  } });
  const tab = await show({ id: 'tab_c1', kind: 'terminal', scope: { type: 'chat', id: 'ask_1', projectKey: 'app-0000aaaa' }, state: {} });
  assert.equal(posts(calls).length, 1);
  assert.equal(tabs.get(tab.id).state.sessionId, 't-c');
  assert.ok(sent.some((m) => m.type === 'term-attach' && m.sessionId === 't-c'));
});

test('onSessions is held while a tab starts, then fires once with the new shell (no second tab for it)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tool, show, synced } = makeTool({ ctx: PROJ_CTX, routes: {
    'GET /api/terminal': INFO,
    'POST /api/projects/app-0000aaaa/terminal': () => gate.then(() => ({ session: { ...SNAP, id: 't-n', scope: 'project', projectKey: 'app-0000aaaa' }, warning: null })),
  } });
  const p = show({ id: 'tab_p1', kind: 'terminal', scope: { type: 'project', id: 'app-0000aaaa' }, state: {} });
  await tick();
  const before = synced.length;
  tool.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-n', scope: 'project', projectKey: 'app-0000aaaa' } });
  assert.equal(synced.length, before, 'held during the start');
  release();
  await p;
  assert.ok(synced.at(-1).includes('t-n'));
});

test('hiding a tab detaches its shell; it keeps running (no DELETE, no stop)', async () => {
  const { show, hide, sent, calls, runTab } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  await show(runTab({ sessionId: 't-1' }));
  hide();
  assert.ok(sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'));
  assert.equal(calls.filter((c) => c.method === 'DELETE' || c.url.endsWith('/stop')).length, 0);
});

// ── guards the mutation sweep found unpinned ────────────────────────────────────────────────────────────────────────
test('D14: a term-status frame before the first list never reaches onSessions (restored tabs are not pruned by it)', async () => {
  const { tool, synced } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes() });
  tool.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-x' } });
  assert.equal(synced.length, 0);
  await tool.refreshInfo();
  assert.deepEqual(synced, [['t-1']], 'the first list goes out: the server\'s list is the truth');
});

test('a second × while the close is under way does nothing (one DELETE)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tool, show, runTab, calls } = makeTool({ ctx: RUN_CTX, routes: attachedRoutes({
    'DELETE /api/terminal/sessions/t-1': () => gate.then(() => ({ ok: true })),
  }) });
  const tab = await show(runTab({ sessionId: 't-1' }));
  const first = tool.kind.close(tab);
  const second = tool.kind.close(tab);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, false], 'the second click keeps the tab: the first one decides');
  assert.deepEqual(deletes(calls), ['/api/terminal/sessions/t-1']);
});

test('a fresh list without the attached shell marks it closed: keys no longer go to it', async () => {
  const routes = attachedRoutes();
  const { tool, show, runTab, sent, xt, synced } = makeTool({ ctx: RUN_CTX, routes });
  await show(runTab({ sessionId: 't-1' }));
  routes['GET /api/terminal'] = { ...INFO, sessions: [] };     // its term-status frame was missed (a /ws drop)
  await tool.refreshInfo();
  assert.equal(tool.sessions().find((s) => s.id === 't-1')?.status, 'closed');
  assert.deepEqual(synced.at(-1), ['t-1'], 'the panel hears it as not running, so only the tab on screen stays');
  const before = sent.length;
  xt.type('ls');
  assert.equal(sent.slice(before).filter((m) => m.type === 'term-input').length, 0);
});

test('a tab that leaves the screen while the first list loads starts nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { show, projectTab, calls, sent } = makeTool({ ctx: PROJ_CTX, routes: {
    'GET /api/terminal': () => gate.then(() => INFO),
    'POST /api/projects/app-0000aaaa/terminal': { session: PROJ_SNAP, warning: null },
  } });
  const a = show(projectTab());
  const b = show({ ...projectTab(), id: 'tab_p2' });
  release();
  await Promise.all([a, b]);
  assert.equal(posts(calls).length, 1, 'only the tab on screen starts its shell');
  assert.deepEqual(sent.filter((m) => m.type === 'term-attach').map((m) => m.sessionId), ['t-p']);
});

test('a run lookup that answers after its tab was hidden never lands on the next tab\'s context line', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tool, show, hide, runTab, projectTab, doc, env } = makeTool({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': () => gate.then(() => ({ enabled: true, live: true, workspace: false, sessions: [], members: [LIVE_MEMBER] })),
    'POST /api/projects/app-0000aaaa/terminal': () => new Promise(() => {}),   // the project's shell is still starting
  } });
  const r = show(runTab());
  await tick();
  hide();
  env.ctx = PROJ_CTX;
  show(projectTab());                                       // its start never answers: the tab stays shell-less
  await tick();
  release();
  await r;
  tool.onFrame({ type: 'term-status', snapshot: { ...SNAP, id: 't-z', runId: 'r9' } });   // any later redraw
  await tick();
  assert.equal(doc.querySelector('.term-folder'), null, 'r1\'s folder is not shown on the project tab');
  assert.doesNotMatch(doc.querySelector('.term-context').textContent, /still running/);
});
