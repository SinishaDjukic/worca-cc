// test/ui-tool-panel-terminal.test.mjs — the Terminal tool inside the real tool panel (issue 1064): createTerminalTool's
// kind registered in createToolRegistry, driven by createToolPanel and createTabModel. Pins the seams the two test files
// of each side cannot see alone: the first open reads the server's shells before it picks a tab, a view change lets go
// of the shell, a shell started elsewhere gets its tab through onSessions, and Ctrl+` works from inside xterm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTerminalTool } from '../ui/public/terminal-pane.mjs';
import { createTabModel } from '../ui/public/tool-tabs.mjs';
import { createToolRegistry } from '../ui/public/tool-kinds.mjs';
import { createToolPanel } from '../ui/public/tool-panel.mjs';

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

// ── the real panel: the Terminal kind registered in createToolRegistry, driven by createToolPanel ─────────────────────
function bootPanel({ ctx, routes }) {
  const dom = new JSDOM('<!doctype html><body><div class="app"></div></body>', { url: 'http://localhost:4317/' });
  const win = dom.window;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const env = { ctx };
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
  let panel = null;
  const tool = createTerminalTool({ doc: win.document, win, fetch, sendWs: (m) => { sent.push(m); return true; }, loadXterm: xt.load,
    onSessions: (list) => panel?.syncSessions(list) });
  const registry = createToolRegistry();
  registry.register(tool.kind);
  const model = createTabModel({ storage: null });
  panel = createToolPanel({ doc: win.document, win, registry, model, getPageContext: () => env.ctx, refreshSessions: () => tool.refreshInfo() });
  win.document.body.append(panel.root);
  const go = async (next) => { env.ctx = next; panel.onContextChange(); await tick(12); };
  const done = () => { panel.destroy(); tool.destroy(); win.close(); };
  return { win, doc: win.document, panel, tool, model, env, sent, calls, xt, go, done };
}

test('in the real panel: the Terminal action starts a shell in the run, another run detaches it, a shell started elsewhere gets a tab', async () => {
  const R2 = { ...SNAP, id: 't-9', runId: 'r2', label: 'r2 · app', createdAt: '2026-10-03T12:00:00.000Z' };
  const b = bootPanel({ ctx: RUN_CTX, routes: {
    'GET /api/terminal': INFO,
    'GET /api/runs/r1/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: MEMBERS },
    'GET /api/runs/r2/terminal': { enabled: true, live: true, workspace: false, sessions: [], members: [{ ...MEMBERS[0], cwd: '/r2' }] },
    'POST /api/runs/r1/terminal': { session: SNAP, warning: null },
  } });
  try {
    assert.equal(b.calls.length, 0, 'no network before the panel opens (D14)');
    await b.panel.showKind('terminal');
    await tick();
    assert.deepEqual(posts(b.calls).map((c) => c.url), ['/api/runs/r1/terminal?projectDir=%2Fp%2Fapp']);
    assert.equal(b.sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1');
    assert.deepEqual(b.model.tabs().map((t) => [t.kind, t.scope.type, t.scope.id, t.state.sessionId]), [['terminal', 'run', 'r1', 't-1']],
      'one tab, bound to its shell: its own term-status frame made no second tab');
    assert.equal(b.doc.querySelector('.tool-tab-text').textContent, 'r1 · app');
    assert.ok(b.xt.made.focus >= 1, 'the panel focuses the terminal once the mount resolved');
    b.tool.onFrame({ type: 'term-status', snapshot: { ...SNAP, currentBlock: { seq: 1, command: 'ls' } } });
    assert.equal(b.model.tabs().length, 1);

    await b.go({ ...RUN_CTX, pipelineId: 'r2' });
    assert.ok(b.sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'), 'the run\'s tab left the screen: its shell is let go');
    assert.equal(b.calls.some((c) => c.method === 'DELETE' || c.url.endsWith('/stop')), false, 'and keeps running');

    b.tool.onFrame({ type: 'term-status', snapshot: R2 });   // another browser tab opened a shell on r2
    await tick(12);
    const r2tab = b.model.tabs().find((t) => t.state.sessionId === 't-9');
    assert.deepEqual(r2tab?.scope, { type: 'run', id: 'r2' });
    assert.equal(b.sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-9', 'r2 had no tab on screen: the new one shows');

    await b.go(RUN_CTX);
    assert.equal(b.sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1', 'back on r1: its tab reattaches');
    assert.equal(posts(b.calls).length, 1, 'nothing new started');
    assert.equal(await b.panel.showSession('t-gone'), false);
  } finally { b.done(); }
});

test('in the real panel: Ctrl+` from inside the terminal hides the panel (capture phase; xterm stops the event) and lets go of the shell', async () => {
  const b = bootPanel({ ctx: RUN_CTX, routes: { ...attachedRoutes(), 'GET /api/terminal': { ...INFO, sessions: [SNAP] } } });
  try {
    await b.panel.showKind('terminal');
    await tick();
    assert.equal(posts(b.calls).length, 0, 'the shell the list showed has its tab already: it is reattached');
    assert.equal(b.sent.filter((m) => m.type === 'term-attach').at(-1).sessionId, 't-1');
    const inner = b.doc.createElement('textarea');
    inner.addEventListener('keydown', (e) => e.stopPropagation());
    b.doc.querySelector('.term-screen').appendChild(inner);
    inner.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }));
    await tick();
    assert.equal(b.panel.isOpen(), false);
    assert.ok(b.sent.some((m) => m.type === 'term-detach' && m.sessionId === 't-1'));
  } finally { b.done(); }
});

test('in the real app: a reload with the panel open on a project page shows the project\'s tabs once the projects list lands', async () => {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const KEY = 'app-0000aaaa';
  let release;
  const held = new Promise((r) => { release = r; });
  const tools = { v: 1, tabs: [{ id: 'tab_proj1', kind: 'files', scope: { type: 'project', id: KEY }, state: {}, at: 1 }], active: {}, prefs: { open: true, width: 460 } };
  const ctx = await bootChat({ url: `http://localhost:4317/#projects/${KEY}`, local: { 'worca-cc.tools': JSON.stringify(tools) },
    arms: (url) => (url.split('?')[0].endsWith('/api/projects')
      ? held.then(() => ok({ projects: [{ key: KEY, name: 'app', path: '/tmp/app' }] }))
      : null) });
  const doc = ctx.window.document;
  const tabs = () => [...doc.querySelectorAll('.tool-panel .tool-tab-text')].map((n) => n.textContent);
  await ctx.settle(6);
  assert.deepEqual(tabs(), [], 'precondition: no context before the list answers');
  release();
  await ctx.settle(10);
  assert.deepEqual(tabs(), ['Files']);
});
