// test/api-terminal.test.mjs — the terminal's HTTP + WS contract (issue #573). Pipes mode
// (WORCA_TERMINAL_PTY=0) so it runs anywhere bash does; the PTY path is covered by terminal-pty.test.mjs.
// Every response body is consumed: an unread body keeps a keep-alive socket open and srv.close() hangs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { existsSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { insertSession, startBlock, listBranchWorktrees } from '../src/core/terminal/store.mjs';
import { branchCheckoutName } from '../src/core/terminal/worktrees.mjs';
import { branchWorktreeRoot } from '../src/core/terminal/paths.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_TERMINAL_PTY', 'SHELL', 'WORCA_FLAGS'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const created = [];
const BASH = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).status === 0;
let homeDir, repo, key, srv, port, base, wsBase, wt;
let chatId, bareChat, wt2, runsMap;
let tabChatId;   // the tab mirror rows' own pinned chat (issue 1064 slice 3): 'archiving a chat closes its shells' archives chatId

function freshRepo(prefix) {
  const dir = realpathSync(templateRepo('apiterm', { branch: 'main', user: true, prefix }));
  created.push(dir);
  return dir;
}
const getJson = async (p) => (await fetch(`${base}${p}`)).json();
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** fetch() drops a caller-set Host and Origin; this sends them as given. */
function raw(method, p, headers, body) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...headers,
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
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
const q = () => `projectKey=${encodeURIComponent(key)}`;
const openRunTerminal = async () => {
  const r = await post(`/api/runs/run-live/terminal?${q()}`, { cols: 90, rows: 20 });
  assert.equal(r.status, 201);
  return (await r.json()).session;
};
const closeSession = async (id) => (await fetch(`${base}/api/terminal/sessions/${id}`, { method: 'DELETE' })).json();

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-home-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_TERMINAL_PTY: '0', SHELL: '/bin/bash', WORCA_FLAGS: 'toolPanel' });
  _resetForTests();
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  repo = await freshRepo('worca-cc-apiterm-');
  mkdirSync(join(repo, 'src')); writeFileSync(join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  mkdirSync(join(repo, 'deck')); writeFileSync(join(repo, 'deck', 'deck.html'), '<script src="deck-stage.js"></script>\n');
  writeFileSync(join(repo, 'deck', 'deck-stage.js'), 'void 0;\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: repo });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'src'], { cwd: repo });
  await addProject({ name: basename(repo), path: repo });
  key = projectKey(repo);
  wt = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-wt-')));
  created.push(wt);
  seedPipelineRow({ id: 'run-live', projectKey: key, status: 'paused', branch: { feature: 'worca/f', worktreeDir: wt } });
  seedPipelineRow({ id: 'run-done', projectKey: key, status: 'done', branch: { feature: 'worca/g' } });
  wt2 = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-wt-')));
  created.push(wt2);
  const askStore = await import('../src/core/ask/store.mjs');
  chatId = askStore.createThread({ title: 'tools chat' }).id;
  askStore.updateThread(chatId, { context: { pinned: true, projectKey: key } });
  bareChat = askStore.createThread({ title: 'no project' }).id;
  tabChatId = askStore.createThread({ title: 'tabs chat' }).id;
  askStore.updateThread(tabChatId, { context: { pinned: true, projectKey: key } });
  seedPipelineRow({ id: 'run-arch', projectKey: key, status: 'paused', branch: { feature: 'worca/a', worktreeDir: wt2 } });
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  runsMap = mod.runs;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  const { sessions } = await getJson('/api/terminal');
  for (const s of sessions.filter((x) => x.status === 'running')) await closeSession(s.id);
  await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  for (const d of created) await rm(d, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});


const pq = () => `scope=project&projectKey=${encodeURIComponent(key)}`;

test('GET /api/tools/files: a project folder, one level, .git hidden; a sub folder by path', async () => {
  const r = await getJson(`/api/tools/files?${pq()}`);
  assert.equal(r.root.scope, 'project');
  assert.ok(r.entries.some((e) => e.name === 'src' && e.type === 'dir'));
  assert.ok(!r.entries.some((e) => e.name === '.git'));
  const sub = await getJson(`/api/tools/files?${pq()}&path=src`);
  assert.deepEqual(sub.entries, [{ name: 'a.js', type: 'file', size: 20 }]);
});

test('GET /api/tools/file: text from inside the folder; climbing and .git are 400 BAD_PATH', async () => {
  const r = await getJson(`/api/tools/file?${pq()}&path=src/a.js`);
  assert.equal(r.text, 'export const a = 1;\n');
  for (const bad of ['../x', '.git/config', '/etc/hosts']) {
    const res = await fetch(`${base}/api/tools/file?${pq()}&path=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, bad);
    assert.equal((await res.json()).code, 'BAD_PATH');
  }
});

test('GET /api/tools/raw/<scope>/<path>: bytes with the raw rules; relative assets resolve under the same scope; the same refusals', async () => {
  const seg = encodeURIComponent(pq());
  const js = await fetch(`${base}/api/tools/raw/${seg}/src/a.js`);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await js.text(), 'export const a = 1;\n');
  const dl = await fetch(`${base}/api/tools/raw/${seg}/src/a.js?download=1`);
  assert.match(dl.headers.get('content-disposition'), /^attachment;/);
  await dl.arrayBuffer();
  for (const bad of ['..%2Fx', '.git/config']) {
    const r = await fetch(`${base}/api/tools/raw/${seg}/${bad}`);
    assert.equal(r.status, 400, bad);
    assert.equal((await r.json()).code, 'BAD_PATH');
  }
  const deck = await fetch(`${base}/api/tools/raw/${seg}/deck/deck.html`);
  assert.equal(deck.status, 200);
  assert.match(deck.headers.get('content-security-policy') || '', /sandbox allow-scripts/, 'the raw rules\' sandbox CSP');
  await deck.arrayBuffer();
  const v16 = await raw('GET', `/api/tools/raw/${seg}/deck/deck-stage.js`, { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'script' });
  assert.equal(v16.status, 403, 'V16 carried over through sendRawFile: no same-origin script load of a folder file');
  const unknown = await fetch(`${base}/api/tools/raw/${encodeURIComponent('scope=nope')}/src/a.js`);
  assert.equal(unknown.status, 400);
  await unknown.arrayBuffer();
  const foreign = await raw('GET', `/api/tools/raw/${seg}/src/a.js`, { origin: 'http://127.0.0.1:4401' });
  assert.equal(foreign.status, 403, 'only pages of this Worca');
});

test('the tool routes answer only pages of this Worca (403 cross-origin) and need a known scope (400)', async () => {
  const cross = await raw('GET', `/api/tools/files?${pq()}`, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port + 1}` });
  assert.equal(cross.status, 403);
  const bad = await fetch(`${base}/api/tools/files?scope=nope`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'BAD_SCOPE');
});

test('chat scope: the project folder when the chat has no worktree; No project is 409; unknown is 404 SCOPE_GONE', async () => {
  const r = await getJson(`/api/tools/files?scope=chat&threadId=${chatId}`);
  assert.equal(r.root.scope, 'chat');
  assert.ok(r.entries.some((e) => e.name === 'src'));
  const none = await fetch(`${base}/api/tools/files?scope=chat&threadId=${bareChat}`);
  assert.equal(none.status, 409);
  assert.equal((await none.json()).code, 'NO_PROJECT');
  const gone = await fetch(`${base}/api/tools/files?scope=chat&threadId=ask_00000000`);
  assert.ok([400, 404].includes(gone.status));
  await gone.body?.cancel();
});

test('run scope: a live (paused) run member folder; an archived run is 404 SCOPE_GONE', async () => {
  const r = await getJson(`/api/tools/files?scope=run&runId=run-live&projectKey=${encodeURIComponent(key)}`);
  assert.equal(r.root.scope, 'run');
  assert.ok(Array.isArray(r.entries));
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-01-01T00:00:00Z' WHERE id = 'run-done'").run();
  try {
    const gone = await fetch(`${base}/api/tools/files?scope=run&runId=run-done&projectKey=${encodeURIComponent(key)}`);
    assert.equal(gone.status, 404);
    assert.equal((await gone.json()).code, 'SCOPE_GONE');
  } finally {
    getDb().prepare("UPDATE pipelines SET archived_at = NULL WHERE id = 'run-done'").run();   // later rows read run-done
  }
});

test('GET /api/tools/changes: a project folder\'s uncommitted work against HEAD, as source working-tree', async () => {
  writeFileSync(join(repo, 'src', 'a.js'), 'export const a = 2;\n');
  writeFileSync(join(repo, 'new.txt'), 'n\n');
  try {
    const r = await getJson(`/api/tools/changes?${pq()}`);
    assert.equal(r.source, 'working-tree');
    assert.equal(r.results.summary.filesChanged, 1);
    assert.equal(r.results.summary.filesNew, 1);
    assert.match(r.patch, /a\/src\/a\.js/);
  } finally {
    spawnSync('git', ['checkout', '--', 'src/a.js'], { cwd: repo });
    rmSync(join(repo, 'new.txt'), { force: true });
  }
});

test('GET /api/tools/changes: a finished run reads its saved diff (source run-final)', async () => {
  const r = await getJson(`/api/tools/changes?scope=run&runId=run-done&projectKey=${encodeURIComponent(key)}`);
  assert.equal(r.source, 'run-final');
  assert.equal(r.patch, '');
});

test('GET /api/tools/changes: a paused run still driven here shows its live diff, as the History Diff tab does; a done one its saved diff', async () => {
  const liveDiff = async () => ({ results: { summary: { filesChanged: 1 } }, patch: 'diff --git a/x b/x\n', untrackedCapped: false });
  runsMap.set('uuid-paused', { id: 'uuid-paused', pipelineId: 'run-live', kind: 'run', status: 'paused', orch: { liveDiff } });
  runsMap.set('uuid-done', { id: 'uuid-done', pipelineId: 'run-done', kind: 'run', status: 'done', orch: { liveDiff } });
  try {
    const paused = await getJson(`/api/tools/changes?scope=run&runId=run-live&projectKey=${encodeURIComponent(key)}`);
    assert.equal(paused.source, 'run-live');
    assert.equal(paused.results.summary.filesChanged, 1);
    const done = await getJson(`/api/tools/changes?scope=run&runId=run-done&projectKey=${encodeURIComponent(key)}`);
    assert.equal(done.source, 'run-final');
  } finally {
    runsMap.delete('uuid-paused');
    runsMap.delete('uuid-done');
  }
});

test('POST /api/ask/threads/:id/terminal: a shell in the chat folder, owned by the chat (chatId), scope chat', async () => {
  const res = await post(`/api/ask/threads/${chatId}/terminal`, { cols: 80, rows: 20 });
  assert.equal(res.status, 201);
  const { session } = await res.json();
  assert.equal(session.scope, 'chat');
  assert.equal(session.chatId, chatId);
  assert.equal(realpathSync(session.cwd), realpathSync(repo));
  const listed = (await getJson('/api/terminal')).sessions.find((s) => s.id === session.id);
  assert.equal(listed.chatId, chatId);
  const raw1 = await post(`/api/ask/threads/${chatId}/terminal`, { cwd: '/tmp' });
  assert.equal(raw1.status, 400);
  await raw1.body?.cancel();
  const none = await post(`/api/ask/threads/${bareChat}/terminal`, {});
  assert.equal(none.status, 409);
  await none.body?.cancel();
});

test('archiving a chat closes its shells', async () => {
  const { session } = await (await post(`/api/ask/threads/${chatId}/terminal`, {})).json();
  const r = await fetch(`${base}/api/ask/threads/${chatId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
  assert.equal(r.status, 200);
  await r.json();
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((s) => s.id === session.id)?.status !== 'running');
  const gone = await fetch(`${base}/api/tools/files?scope=chat&threadId=${chatId}`);
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).code, 'SCOPE_GONE');
});

test('archiving a run closes its shells', async () => {
  const s = await post(`/api/runs/run-arch/terminal?projectKey=${encodeURIComponent(key)}`, { cols: 80, rows: 20 });
  assert.equal(s.status, 201);
  const { session } = await s.json();
  const r = await fetch(`${base}/api/runs/run-arch?projectKey=${encodeURIComponent(key)}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  await r.json();
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((x) => x.id === session.id)?.status !== 'running');
});

test('chat scope: another signed-in person\'s chat is 404 SCOPE_GONE (the tool routes sit outside the thread owner guard)', async () => {
  const askStore = await import('../src/core/ask/store.mjs');
  const theirs = askStore.createThread({ title: 'theirs', createdBy: 'alice@x.test' }).id;
  askStore.updateThread(theirs, { context: { pinned: true, projectKey: key } });
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // the in-process server's callers are loopback
  try {
    const own = await fetch(`${base}/api/tools/files?scope=chat&threadId=${theirs}`, { headers: { 'x-test-user': 'alice@x.test' } });
    assert.equal(own.status, 200);
    await own.json();
    for (const p of ['files', 'file?path=src/a.js', 'changes']) {
      const sep = p.includes('?') ? '&' : '?';
      const other = await fetch(`${base}/api/tools/${p}${sep}scope=chat&threadId=${theirs}`, { headers: { 'x-test-user': 'bob@x.test' } });
      assert.equal(other.status, 404, p);
      assert.equal((await other.json()).code, 'SCOPE_GONE', p);
    }
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});

test('GET /api/tools/changes: a folder that is not a git repository is 409 NOT_A_REPO', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const plain = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apitools-plain-')));
  created.push(plain);
  writeFileSync(join(plain, 'x.txt'), 'x\n');
  await addProject({ name: basename(plain), path: plain });
  const res = await fetch(`${base}/api/tools/changes?scope=project&projectKey=${encodeURIComponent(projectKey(plain))}`);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'NOT_A_REPO');
});

test('bulk archive closes the run\'s shells', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-wt-')));
  created.push(dir);
  seedPipelineRow({ id: 'run-bulk', projectKey: key, status: 'interrupted', branch: { feature: 'worca/b', worktreeDir: dir } });   // bulk Archive takes ended or interrupted runs
  const s = await post(`/api/runs/run-bulk/terminal?projectKey=${encodeURIComponent(key)}`, { cols: 80, rows: 20 });
  assert.equal(s.status, 201);
  const { session } = await s.json();
  const r = await post('/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'run-bulk' }] });
  assert.equal(r.status, 200);
  await r.json();
  assert.ok(getDb().prepare("SELECT archived_at FROM pipelines WHERE id = 'run-bulk'").get().archived_at, 'the run is archived');
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((x) => x.id === session.id)?.status !== 'running');
});

test('the retention sweep closes the shells of the runs it archives (dev #1067 archives there too)', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-wt-')));
  created.push(dir);
  seedPipelineRow({ id: 'run-old', projectKey: key, status: 'interrupted', branch: { feature: 'worca/old-gone', worktreeDir: dir } });
  const s = await post(`/api/runs/run-old/terminal?projectKey=${encodeURIComponent(key)}`, { cols: 80, rows: 20 });
  assert.equal(s.status, 201);
  const { session } = await s.json();
  getDb().prepare("UPDATE pipelines SET status = 'done', updated_at = '2020-01-01T00:00:00Z', started_at = '2020-01-01T00:00:00Z' WHERE id = 'run-old'").run();
  const { _testing } = await import('../ui/server.mjs');
  const out = await _testing.sweepRunRetention(1);
  assert.deepEqual(out.archived, ['run-old']);
  assert.ok(getDb().prepare("SELECT archived_at FROM pipelines WHERE id = 'run-old'").get().archived_at, 'the run is archived');
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((x) => x.id === session.id)?.status !== 'running');
});

test('archiving a chat group closes its chats\' shells', async () => {
  const askStore = await import('../src/core/ask/store.mjs');
  const gchat = askStore.createThread({ title: 'grouped' }).id;
  askStore.updateThread(gchat, { context: { pinned: true, projectKey: key } });
  const sh = await post(`/api/ask/threads/${gchat}/terminal`, {});
  assert.equal(sh.status, 201);
  const { session } = await sh.json();
  const g = await post('/api/ask/groups', { name: 'tools group', threadIds: [gchat] });
  assert.equal(g.status, 201);
  const { group } = await g.json();
  const a = await post(`/api/ask/groups/${group.id}/archive`, { archived: true });
  assert.equal(a.status, 200);
  await a.json();
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((x) => x.id === session.id)?.status !== 'running');
});

test('deleting a chat closes its shells', async () => {
  const askStore = await import('../src/core/ask/store.mjs');
  const dchat = askStore.createThread({ title: 'to delete' }).id;
  askStore.updateThread(dchat, { context: { pinned: true, projectKey: key } });
  const sh = await post(`/api/ask/threads/${dchat}/terminal`, {});
  assert.equal(sh.status, 201);
  const { session } = await sh.json();
  const d = await fetch(`${base}/api/ask/threads/${dchat}`, { method: 'DELETE' });
  assert.equal(d.status, 200);
  await d.json();
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((x) => x.id === session.id)?.status !== 'running');
});

test('deleting a chat whose mirrored tabs cannot be dropped still deletes it (never stuck as being deleted)', async () => {
  const askStore = await import('../src/core/ask/store.mjs');
  const { _testing } = await import('../ui/server.mjs');
  const dchat = askStore.createThread({ title: 'to delete, mirror failing' }).id;
  const real = _testing.toolTabs.dropScope;
  _testing.toolTabs.dropScope = () => { throw new Error('database is locked'); };
  try {
    const d = await fetch(`${base}/api/ask/threads/${dchat}`, { method: 'DELETE' });
    assert.equal(d.status, 200);
    await d.json();
  } finally { _testing.toolTabs.dropScope = real; }
  const g = await fetch(`${base}/api/ask/threads/${dchat}`);
  assert.equal(g.status, 404);
  await g.json();
});

// ── The tool panel's tabs for the chat (issue 1064 slice 3) ──
/** A loopback page Worca did not start, in a range of its own: minting probes the port (another Worca is refused), so
 *  these tests never depend on what this machine runs on 4400–4499. */
async function withQuietPort(fn) {
  const quiet = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('quiet'); });
  await new Promise((r) => quiet.listen(0, '127.0.0.1', r));
  const p = quiet.address().port;
  assert.equal((await post('/api/settings', { actions: { portLow: p, portHigh: p } })).status, 200);
  try { return await fn(p); } finally {
    await post('/api/settings', { actions: { portLow: 4400, portHigh: 4499 } });
    quiet.closeAllConnections();
    await new Promise((r) => quiet.close(r));
  }
}

const tabsQ = (id) => `scope=chat&threadId=${id}`;
const put = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('the tab mirror: PUT/GET per chat and project; cross-origin, run scopes and archived chats are refused', async () => {
  const r = await put(`/api/tools/tabs?${tabsQ(tabChatId)}`, { tabs: [{ id: 'tab_m1', kind: 'browser', url: 'http://localhost:4400/' }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).tabs.map((t) => t.id), ['tab_m1']);
  assert.deepEqual((await getJson(`/api/tools/tabs?${tabsQ(tabChatId)}`)).tabs.map((t) => [t.id, t.openedBy]), [['tab_m1', 'user']]);
  const cross = await raw('PUT', `/api/tools/tabs?${tabsQ(tabChatId)}`, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port + 1}` }, { tabs: [] });
  assert.equal(cross.status, 403);
  const crossGet = await raw('GET', `/api/tools/tabs?${tabsQ(tabChatId)}`, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port + 1}` });
  assert.equal(crossGet.status, 403, 'another local page cannot read the tab list (terminalCallerOk)');
  const run = await fetch(`${base}/api/tools/tabs?scope=run&runId=run-live`);
  assert.equal(run.status, 400); await run.json();
  const g = await fetch(`${base}/api/tools/tabs?${tabsQ('ask_ffffffff')}`);   // no such chat
  assert.equal(g.status, 404); await g.json();
  // An archived chat: archive it through its own route, the way the page does.
  const askStore = await import('../src/core/ask/store.mjs');
  const arch = askStore.createThread({ title: 'to archive' }).id;
  const pre = await put(`/api/tools/tabs?${tabsQ(arch)}`, { tabs: [{ id: 'tab_ar1', kind: 'files' }] });
  assert.equal(pre.status, 200); await pre.json();
  const pa = await fetch(`${base}/api/ask/threads/${arch}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
  assert.equal(pa.status, 200); await pa.json();
  const ga = await fetch(`${base}/api/tools/tabs?${tabsQ(arch)}`);
  assert.equal(ga.status, 404, 'an archived chat'); await ga.json();
  const { _testing } = await import('../ui/server.mjs');
  assert.deepEqual(_testing.toolTabs.list('', `chat:${arch}`), [], 'archiving dropped its mirrored tabs');
});

test('the tab bridge: loopback only, a live token, ops by name; open_tab lands undelivered and tells the page', async () => {
  const mod = await import('../ui/server.mjs');
  const b = mod._testing.askTabBridge({ threadId: tabChatId });
  try {
    const call = (op, input, token = b.token) => raw('POST', '/api/ask/tabs', { host: `127.0.0.1:${port}`, 'x-worca-ask-tabs': token }, { op, input });
    assert.equal((await call('open', { kind: 'files' }, 'nope')).status, 403);
    assert.equal((await call('constructor', {})).status, 400, 'an inherited property is no op');
    const { msgs, ws, opened } = openWs();
    await opened;
    const o = await call('open', { kind: 'files' });
    assert.equal(o.status, 200);
    const id = o.body.result.tabId;
    await waitFor(() => msgs.some((m) => m.type === 'ask-tool-tabs' && m.threadId === tabChatId));
    ws.close();
    const listed = (await getJson(`/api/tools/tabs?${tabsQ(tabChatId)}`)).tabs.find((t) => t.id === id);
    assert.deepEqual([listed.openedBy, listed.delivered], ['assistant', false]);
    assert.equal((await call('open', { kind: 'files' })).status, 200);
    const bare = mod._testing.askTabBridge({ threadId: bareChat });
    assert.equal((await raw('POST', '/api/ask/tabs', { host: `127.0.0.1:${port}`, 'x-worca-ask-tabs': bare.token }, { op: 'open', input: { kind: 'files' } })).body.code, 'NO_PROJECT');
    bare.dispose();
  } finally { b.dispose(); }
  assert.equal((await raw('POST', '/api/ask/tabs', { host: `127.0.0.1:${port}`, 'x-worca-ask-tabs': b.token }, { op: 'open', input: {} })).status, 403, 'a finished turn');
});

test('screenshot_tab through the bridge: the proxied URL, Worca\'s API blocked, a files-card result with a real attachment', async () => {
  const mod = await import('../ui/server.mjs');
  const askStore = await import('../src/core/ask/store.mjs');
  await withQuietPort(async (qp) => {
    let seen = null;
    mod._testing.setPageCapture({ capture: async (o) => { seen = o; return { note: null, painted: true, png: Buffer.from('\x89PNG\r\n\x1a\nfake'), width: 1280, height: 800, title: 'T', text: 'hi', console: ['boom'] }; }, close: async () => {} });
    await put(`/api/tools/tabs?${tabsQ(tabChatId)}`, { tabs: [{ id: 'tab_q1', kind: 'browser', url: `http://localhost:${qp}/a` }] });
    const b = mod._testing.askTabBridge({ threadId: tabChatId });
    const tokens0 = mod._testing.previewTokens.size();
    try {
      const r = await raw('POST', '/api/ask/tabs', { host: `127.0.0.1:${port}`, 'x-worca-ask-tabs': b.token }, { op: 'screenshot', input: { tabId: 'tab_q1' } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(mod._testing.previewTokens.size(), tokens0, 'the capture\'s preview token is revoked when it ends');
      assert.match(seen.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/preview/${qp}/[A-Za-z0-9_-]+/a$`));
      assert.equal(await seen.allow(`http://127.0.0.1:${port}/api/settings`, false), false);
      const att = askStore.getAttachment(tabChatId, r.body.result.items[0].attId);
      assert.equal(att.mime, 'image/png');
      const rd = await raw('POST', '/api/ask/tabs', { host: `127.0.0.1:${port}`, 'x-worca-ask-tabs': b.token }, { op: 'read', input: { tabId: 'tab_q1' } });
      assert.deepEqual([rd.body.result.text, rd.body.result.consoleErrors], ['hi', ['boom']]);
    } finally { b.dispose(); mod._testing.setPageCapture(null); }
  });
});

test('pick: same origin, Actions on, local previews only', async () => {
  const cross = await raw('POST', '/api/tools/browser/pick', { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port + 1}` }, { url: 'http://localhost:4400/', selector: 'h1' });
  assert.equal(cross.status, 403);
  const ext = await post('/api/tools/browser/pick', { url: 'https://example.com/', selector: 'h1' });
  assert.equal(ext.status, 409);
  assert.equal((await ext.json()).code, 'NOT_LOCAL');
});

test('the tab mirror: another signed-in person\'s chat is 404 SCOPE_GONE (askThreadVisible)', async () => {
  const askStore = await import('../src/core/ask/store.mjs');
  const theirs = askStore.createThread({ title: 'theirs tabs', createdBy: 'alice@x.test' }).id;
  askStore.updateThread(theirs, { context: { pinned: true, projectKey: key } });
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // the in-process server's callers are loopback
  try {
    const own = await put(`/api/tools/tabs?${tabsQ(theirs)}`, { tabs: [{ id: 'tab_al1', kind: 'files' }] }, { 'x-test-user': 'alice@x.test' });
    assert.equal(own.status, 200);
    await own.json();
    const other = await fetch(`${base}/api/tools/tabs?${tabsQ(theirs)}`, { headers: { 'x-test-user': 'bob@x.test' } });
    assert.equal(other.status, 404);
    assert.equal((await other.json()).code, 'SCOPE_GONE');
    const write = await put(`/api/tools/tabs?${tabsQ(theirs)}`, { tabs: [] }, { 'x-test-user': 'bob@x.test' });
    assert.equal(write.status, 404);
    await write.json();
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});
