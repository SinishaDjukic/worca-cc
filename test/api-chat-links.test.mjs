// test/api-chat-links.test.mjs — chat links on the in-process server (issue 1064 §1–§3): the resolve route, a run's
// branch root through the Files routes, the "chat links that run" check, the default root's fallback, open_tab files
// over the tab bridge (refusals, the per-turn cap, dispose), bring-forward frames, the frame check and the setting.
// Every response body is consumed: an unread body keeps a keep-alive socket open and srv.close() hangs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { WebSocket } from 'ws';
import { _resetForTests } from '../src/core/db.mjs';
import { makeLinkRepo } from './helpers/link-repo.mjs';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_TERMINAL_PTY', 'SHELL'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, fx, key, srv, port, base, wsBase, mod, askStore, A, B, C, pid;

const getJson = async (p) => (await fetch(`${base}${p}`)).json();
/** fetch() drops a caller-set Host and Origin; this sends them as given. */
function raw(method, p, headers, body) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...headers,
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function openWs(headers = { host: '127.0.0.1', origin: 'http://127.0.0.1' }) {
  const ws = new WebSocket(wsBase, { headers });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  const opened = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, msgs, opened };
}
async function waitFor(pred, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const H = () => ({ host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` });
const post = (p, body) => raw('POST', p, H(), body);
const get = (p) => raw('GET', p, H());
const resolveFiles = (threadId, paths) => post('/api/ask/files/resolve', { threadId, paths });
const bridge = (threadId) => {
  const b = mod._testing.askTabBridge({ threadId });
  return { b, call: (op, input) => raw('POST', '/api/ask/tabs', { host: `127.0.0.1:${port}`, 'x-worca-ask-tabs': b.token }, { op, input }) };
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apilinks-home-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_TERMINAL_PTY: '0', SHELL: '/bin/bash' });
  _resetForTests();
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  fx = makeLinkRepo('worca-cc-apilinks-');
  await addProject({ name: basename(fx.repo), path: fx.repo });
  key = projectKey(fx.repo);
  askStore = await import('../src/core/ask/store.mjs');
  const pinned = (title) => { const id = askStore.createThread({ title }).id; askStore.updateThread(id, { context: { pinned: true, projectKey: key } }); return id; };
  A = pinned('chat A'); B = pinned('chat B'); C = pinned('chat C');
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  ({ id: pid } = await seedPipeline(fx.repo, { status: 'done', branch: { source: 'dev', feature: 'feat', worktreeRemoved: true, branchKept: true } }));
  askStore.linkRun(B, { runId: pid, pipelineId: pid, cardId: null, status: 'done' });
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(fx.repo, { recursive: true, force: true });
  await rm(fx.outside, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

test('1. resolve: confirmed paths of the chat\'s folder; refused, missing and ambiguous bare names are {ok:false}', async () => {
  const r = await resolveFiles(A, ['src/a.js', 'app.js', '.env', 'nope.js', 'src/']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { root: null, paths: { 'src/a.js': { ok: true, path: 'src/a.js', type: 'file', lines: 10 }, 'app.js': { ok: false },
    '.env': { ok: false }, 'nope.js': { ok: false }, 'src/': { ok: true, path: 'src', type: 'dir' } } });
});

test('2. resolve: bad input is 400; an unknown chat is 404 SCOPE_GONE', async () => {
  for (const paths of [undefined, [], Array.from({ length: 51 }, (_, i) => `f${i}.js`), [1], ['x'.repeat(1025)]]) {
    const r = await post('/api/ask/files/resolve', { threadId: A, ...(paths === undefined ? {} : { paths }) });
    assert.equal(r.status, 400, JSON.stringify(paths)?.slice(0, 40));
  }
  const g = await resolveFiles('ask_ffffffff', ['src/a.js']);
  assert.equal(g.status, 404);
  assert.equal(g.body.code, 'SCOPE_GONE');
});

test('3. a chat that follows a finished run (worktree removed) resolves and reads its branch', async () => {
  const r = await resolveFiles(B, ['src/only-on-branch.js']);
  assert.equal(r.body.root, `run:${pid}`);
  assert.deepEqual(r.body.paths['src/only-on-branch.js'], { ok: true, path: 'src/only-on-branch.js', type: 'file', lines: 2 });
  const q = `scope=chat&threadId=${B}&root=run:${pid}`;
  const f = await get(`/api/tools/file?${q}&path=src/only-on-branch.js`);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.text, 'x\ny\n');
  const l = await get(`/api/tools/files?${q}&path=src`);
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.ok(l.body.entries.some((e) => e.name === 'only-on-branch.js' && e.type === 'file'));
  const seg = encodeURIComponent(q);
  const rr = await get(`/api/tools/raw/${seg}/src/only-on-branch.js`);
  assert.equal(rr.status, 200);
  assert.equal(rr.body, 'x\ny\n');
});

test('4. a run root the chat does not link is 403 ROOT_REFUSED', async () => {
  for (const root of [`run:${pid}`, 'run:zzzz']) {
    const r = await get(`/api/tools/file?scope=chat&threadId=${A}&root=${root}&path=src/a.js`);
    assert.equal(r.status, 403, root);
    assert.equal(r.body.code, 'ROOT_REFUSED');
  }
});

test('5. a deleted branch: the default root falls back to the chat\'s folder; the explicit run root is 409 ROOT_GONE', async () => {
  const before0 = await resolveFiles(B, ['src/only-on-branch.js', 'src/a.js']);
  assert.equal(before0.body.root, `run:${pid}`);
  assert.equal(before0.body.paths['src/only-on-branch.js'].ok, true);
  const sha = fx.sh('rev-parse', 'feat').trim();
  fx.sh('branch', '-D', 'feat');
  try {
    const r = await resolveFiles(B, ['src/only-on-branch.js', 'src/a.js']);
    assert.deepEqual(r.body, { root: null, paths: { 'src/only-on-branch.js': { ok: false }, 'src/a.js': { ok: true, path: 'src/a.js', type: 'file', lines: 10 } } });
    const e = await get(`/api/tools/file?scope=chat&threadId=${B}&root=run:${pid}&path=src/a.js`);
    assert.equal(e.status, 409);
    assert.equal(e.body.code, 'ROOT_GONE');
  } finally { fx.sh('branch', 'feat', sha); }
});

test('6. open_tab files over the bridge: the target is mirrored; refusals are errors that do not count; 3 per turn; dispose forgets', async () => {
  const { b, call } = bridge(A);
  try {
    const o = await call('open', { kind: 'files', path: 'src/a.js', line: 3 });
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.equal(o.body.result.path, 'src/a.js');
    const tabs = (await get(`/api/tools/tabs?scope=chat&threadId=${A}`)).body.tabs;
    assert.deepEqual(tabs.find((t) => t.id === o.body.result.tabId).target, { path: 'src/a.js', line: 3 });
    const env = await call('open', { kind: 'files', path: '.env' });
    assert.deepEqual([env.status, env.body.code], [409, 'REFUSED']);
    const bad = await call('open', { kind: 'files', path: 'src/a.js', line: 99 });
    assert.deepEqual([bad.status, bad.body.code], [409, 'BAD_LINE']);
    assert.equal((await call('open', { kind: 'files', path: 'uniq.md' })).status, 200);
    assert.equal((await call('open', { kind: 'files', path: 'lib/app.js' })).status, 200);
    const cap = await call('open', { kind: 'files', path: 'src/' });
    assert.deepEqual([cap.status, cap.body.code], [409, 'TOO_MANY']);
  } finally { b.dispose(); }
  assert.equal(mod._testing.tabTools.openCounts(), 0);
  const again = bridge(A);
  try { assert.equal((await again.call('open', { kind: 'files', path: 'src/' })).status, 200); } finally { again.b.dispose(); }
});

test('7. the same file twice is brought forward, with a focus frame carrying the new line', async () => {
  const { msgs, ws, opened } = openWs();
  await opened;
  const { b, call } = bridge(C);
  try {
    const one = await call('open', { kind: 'files', path: 'src/a.js', line: 2 });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    const two = await call('open', { kind: 'files', path: 'src/a.js', line: 5 });
    assert.equal(two.status, 200, JSON.stringify(two.body));
    assert.equal(two.body.result.focused, true);
    assert.equal(two.body.result.tabId, one.body.result.tabId);
    await waitFor(() => msgs.find((m) => m.type === 'ask-tool-tabs' && m.threadId === C && m.focus === one.body.result.tabId
      && m.target?.path === 'src/a.js' && m.target?.line === 5));
  } finally { b.dispose(); ws.close(); }
});

test('8. the frame check refuses before any request', async () => {
  const lo = await post('/api/tools/frame-check', { url: 'http://localhost/' });
  assert.deepEqual([lo.status, lo.body.framable, lo.body.reason], [200, null, 'loopback']);
  const lp = await post('/api/tools/frame-check', { url: 'http://localhost:5173/' });   // any non-default port is refused first
  assert.deepEqual([lp.status, lp.body.framable, lp.body.reason], [200, null, 'port']);
  assert.equal((await post('/api/tools/frame-check', { url: '' })).status, 400);
  const login = await post('/api/tools/frame-check', { url: 'https://u:p@example.org/' });
  assert.equal(login.body.reason, 'login');
});

test('9. the chatLinksInPanel setting: POST false shows in GET, with a settings-changed frame', async () => {
  const { msgs, ws, opened } = openWs();
  await opened;
  try {
    const r = await post('/api/settings', { chatLinksInPanel: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await getJson('/api/settings')).chatLinksInPanel, false);
    await waitFor(() => msgs.some((m) => m.type === 'settings-changed'));
  } finally {
    await post('/api/settings', { chatLinksInPanel: true });
    ws.close();
  }
});

test('extra: a chat with no project resolves nothing; changes of a branch root is 409; a long frame-check url is 400', async () => {
  const bare = askStore.createThread({ title: 'bare' }).id;
  const r = await resolveFiles(bare, ['src/a.js']);
  assert.deepEqual(r.body, { root: null, paths: { 'src/a.js': { ok: false } } });
  const c = await get(`/api/tools/changes?scope=chat&threadId=${B}&root=run:${pid}`);
  assert.deepEqual([c.status, c.body.code], [409, 'NO_FOLDER']);
  assert.equal((await post('/api/tools/frame-check', { url: `https://example.org/${'a'.repeat(2049)}` })).status, 400);
});

test('extra: a deleted run is never a root: skipped as the default, 409 when asked', async () => {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const D = askStore.createThread({ title: 'chat D' }).id;
  askStore.updateThread(D, { context: { pinned: true, projectKey: key } });
  const { id: gone } = await seedPipeline(fx.repo, { status: 'done', branch: { source: 'dev', feature: 'feat', worktreeRemoved: true, branchKept: true } });
  getDb().prepare("UPDATE pipelines SET deleted_at = '2026-11-05T00:00:00Z' WHERE id = ?").run(gone);
  askStore.linkRun(D, { runId: pid, pipelineId: pid, cardId: null, status: 'done' });
  await new Promise((r) => setTimeout(r, 20));
  askStore.linkRun(D, { runId: gone, pipelineId: gone, cardId: null, status: 'done' });
  assert.equal((await resolveFiles(D, ['src/only-on-branch.js'])).body.root, `run:${pid}`);
  const e = await get(`/api/tools/file?scope=chat&threadId=${D}&root=run:${gone}&path=src/a.js`);
  assert.deepEqual([e.status, e.body.code], [409, 'ROOT_GONE']);
});
