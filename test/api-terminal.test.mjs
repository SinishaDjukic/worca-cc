// test/api-terminal.test.mjs — the terminal's HTTP + WS contract (issue #573). Pipes mode
// (WORCA_TERMINAL_PTY=0) so it runs anywhere bash does; the PTY path is covered by terminal-pty.test.mjs.
// Every response body is consumed: an unread body keeps a keep-alive socket open and srv.close() hangs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
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

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_TERMINAL_PTY', 'SHELL'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const created = [];
const BASH = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).status === 0;
let homeDir, repo, key, srv, port, base, wsBase, wt;

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
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_TERMINAL_PTY: '0', SHELL: '/bin/bash' });
  _resetForTests();
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  repo = await freshRepo('worca-cc-apiterm-');
  await addProject({ name: basename(repo), path: repo });
  key = projectKey(repo);
  wt = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-apiterm-wt-')));
  created.push(wt);
  seedPipelineRow({ id: 'run-live', projectKey: key, status: 'paused', branch: { feature: 'worca/f', worktreeDir: wt } });
  seedPipelineRow({ id: 'run-done', projectKey: key, status: 'done', branch: { feature: 'worca/g' } });
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
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

test('GET /api/terminal: enabled locally, says why there is no PTY', async () => {
  const r = await getJson('/api/terminal');
  assert.equal(r.enabled, true);
  assert.deepEqual(r.pty, { available: false, reason: 'turned off with WORCA_TERMINAL_PTY=0' });
});

test('a body naming a folder is refused', async () => {
  const r = await post(`/api/runs/run-live/terminal?${q()}`, { cwd: '/' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'RAW_FIELD');
});

test('an unknown member is refused', async () => {
  const r = await post(`/api/runs/run-live/terminal?${q()}`, { member: 'nope-00000000' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'MEMBER_REQUIRED');
});

test('a body-less DELETE on branch worktrees answers 400, not a crash', async () => {
  const r = await fetch(`${base}/api/projects/${key}/terminal/worktrees`, { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'BAD_BRANCH');
  const r2 = await getJson('/api/terminal');
  assert.equal(r2.enabled, true, 'the server is still up');
});

test('a non-string branch on DELETE worktrees answers 400, not a crash', async () => {
  for (const branch of [{ feature: 'x' }, ['x'], true, 1]) {
    const r = await fetch(`${base}/api/projects/${key}/terminal/worktrees`, { method: 'DELETE',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branch }) });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'BAD_BRANCH');
  }
  const r2 = await getJson('/api/terminal');
  assert.equal(r2.enabled, true, 'the server is still up');
});

// run-done is a raw row with no store meta, so its member has no project dir: the start's own checkout
// reports no-branch and the refusal stands (its wording now says so instead of "check out this run first").
test('a finished run without a checkout answers 409', async () => {
  const r = await post(`/api/runs/run-done/terminal?${q()}`, {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'NOT_CHECKED_OUT');
  const t = await getJson(`/api/runs/run-done/terminal?${q()}`);
  assert.equal(t.members[0].state, 'needs-checkout');
});

// terminalTargets offers EVERY finished git member and never consults `affected`, while POST /checkout
// refuses a member the run did not change (409 NOT_AFFECTED). So the start must make its own checkout,
// or such a member has no terminal left by any route.
test('a finished run the project did not change: the start checks it out itself and opens a shell there',
  { skip: !BASH }, async () => {
    const { seedPipeline } = await import('./helpers/db-seed.mjs');
    spawnSync('git', ['branch', 'worca/cold'], { cwd: repo, encoding: 'utf8' });   // a branch with no commits of its own
    const cold = await seedPipeline(repo, { title: 'cold', status: 'done',
      branch: { source: 'main', feature: 'worca/cold', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
    const refused = await post(`/api/runs/${cold.id}/checkout?${q()}`, { members: [key] });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'NOT_AFFECTED', 'the checkout route is a dead end for it');

    const r = await post(`/api/runs/${cold.id}/terminal?${q()}`, {});
    assert.equal(r.status, 201);
    const { session } = await r.json();
    assert.equal(session.runId, cold.id);
    assert.ok(existsSync(session.cwd), `the shell opened in a checkout the start made: ${session.cwd}`);
    const t = await getJson(`/api/runs/${cold.id}/terminal?${q()}`);
    assert.equal(t.members[0].state, 'checkout');
    await closeSession(session.id);
    const del = await fetch(`${base}/api/runs/${cold.id}/checkout?${q()}`, { method: 'DELETE',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) });
    await del.json();
  });

// The start's own checkout can fail, and the terminal's error map knows none of the checkout codes:
// each one has to come back as itself, not as a 500.
test('a start whose checkout cannot be made answers with that checkout error, not a 500', async () => {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  spawnSync('git', ['switch', '-q', '-c', 'worca/held'], { cwd: repo, encoding: 'utf8' });   // the person's own folder has it
  try {
    const held = await seedPipeline(repo, { title: 'held', status: 'done',
      branch: { source: 'main', feature: 'worca/held', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
    const r = await post(`/api/runs/${held.id}/terminal?${q()}`, {});
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, 'BRANCH_CHECKED_OUT');
    assert.equal(await realpath(body.holder), repo);
  } finally {
    spawnSync('git', ['switch', '-q', 'main'], { cwd: repo, encoding: 'utf8' });
  }
});

test('open, attach, type, get a block with its author, stop, close', { skip: !BASH }, async () => {
  const session = await openRunTerminal();
  assert.equal(session.cwd, wt);
  assert.equal(session.mode, 'pipes');
  assert.equal(session.runId, 'run-live');

  const { ws, msgs, opened } = openWs();
  await opened;
  ws.send(JSON.stringify({ type: 'term-attach', sessionId: session.id }));
  await waitFor(() => msgs.find((m) => m.type === 'term-replay' && m.sessionId === session.id));
  ws.send(JSON.stringify({ type: 'term-input', sessionId: session.id, data: 'echo "$WORCA_RUN_ID-$WORCA_BRANCH"\n' }));
  const blk = await waitFor(() => msgs.find((m) => m.type === 'term-block' && m.block.status === 'done'));
  assert.equal(blk.block.runBy, 'local');
  const full = await getJson(`/api/terminal/sessions/${session.id}/blocks/${blk.block.seq}`);
  assert.match(full.output, /run-live-worca\/f/);

  ws.send(JSON.stringify({ type: 'term-input', sessionId: session.id, data: 'sleep 30\n' }));
  await waitFor(() => msgs.find((m) => m.type === 'term-block' && m.block.command === 'sleep 30'));
  const stop = await post(`/api/terminal/sessions/${session.id}/stop`, {});
  assert.equal(stop.status, 200);
  await stop.json();
  await waitFor(() => msgs.find((m) => m.type === 'term-block' && m.block.command === 'sleep 30' && m.block.status === 'stopped'));

  const audit = await getJson(`/api/terminal/audit?sessionId=${session.id}`);
  assert.deepEqual(audit.audit.map((a) => a.action).slice(0, 4), ['open', 'command', 'command', 'stop']);
  assert.ok(getDb().prepare("SELECT 1 FROM pipeline_events WHERE pipeline_id = 'run-live' AND text LIKE 'Terminal opened%'").get());

  assert.deepEqual(await closeSession(session.id), { ok: true });
  await waitFor(() => msgs.find((m) => m.type === 'term-status' && m.snapshot.id === session.id && m.snapshot.status === 'closed'));
  ws.close();
});

test('a page on another local port can neither open nor drive a terminal (D13)', { skip: !BASH }, async () => {
  const foreign = { host: `127.0.0.1:${port}`, origin: 'http://127.0.0.1:4401' };
  const r = await raw('POST', `/api/runs/run-live/terminal?${q()}`, foreign, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'TERMINAL_CROSS_ORIGIN');
  assert.equal((await raw('GET', '/api/terminal', foreign)).body.enabled, false);

  const session = await openRunTerminal();
  const marker = join(wt, 'pwned');
  const { ws, msgs, opened } = openWs(foreign);
  await opened;
  ws.send(JSON.stringify({ type: 'term-attach', sessionId: session.id }));
  ws.send(JSON.stringify({ type: 'term-input', sessionId: session.id, data: `touch ${marker}\n` }));
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(msgs.some((m) => typeof m.type === 'string' && m.type.startsWith('term-')), false);
  assert.equal(existsSync(marker), false);
  assert.equal((await raw('POST', `/api/terminal/sessions/${session.id}/stop`, foreign, {})).status, 403);
  ws.close();
  await closeSession(session.id);
});

test('a page that stops reading gets one term-replay, not an unbounded backlog (D15)', { skip: !BASH }, async () => {
  const session = await openRunTerminal();
  const { ws, msgs, opened } = openWs();
  await opened;
  ws.send(JSON.stringify({ type: 'term-attach', sessionId: session.id }));
  await waitFor(() => msgs.find((m) => m.type === 'term-replay' && m.sessionId === session.id));
  ws._socket.pause();                                             // the tab stops reading (a slow browser)
  ws.send(JSON.stringify({ type: 'term-input', sessionId: session.id, data: 'head -c 40000000 /dev/zero | tr "\\0" x; echo; echo END-OF-FLOOD\n' }));
  await waitFor(async () => (await getJson(`/api/terminal/sessions/${session.id}`)).blocks.some((b) => b.command.startsWith('head -c') && b.status === 'done'), 60000);
  ws._socket.resume();
  await waitFor(() => msgs.filter((m) => m.type === 'term-replay').length >= 2, 30000);
  assert.match(msgs.filter((m) => m.type === 'term-replay').at(-1).data, /END-OF-FLOOD/);
  const sent = msgs.filter((m) => m.type === 'term-data').reduce((n, m) => n + m.data.length, 0);
  assert.ok(sent < 40000000, `only part of the flood was queued for the page (${sent} chars)`);
  ws.close();
  await closeSession(session.id);
});

test('the xterm assets are served from node_modules', async () => {
  for (const [p, type] of [['/vendor/xterm/xterm.mjs', 'javascript'], ['/vendor/xterm/addon-fit.mjs', 'javascript'], ['/vendor/xterm/xterm.css', 'css']]) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), new RegExp(type));
    await r.arrayBuffer();
  }
});

test('a session with more than 200 commands lists its newest 200, oldest first, and says how many there are', async () => {
  insertSession({ id: 't-long', scope: 'run', runId: 'run-done', cwd: wt, shell: '/bin/bash', shellKind: 'bash', mode: 'pipes',
    status: 'exited', createdAt: new Date().toISOString() });
  for (let seq = 1; seq <= 230; seq++) startBlock({ sessionId: 't-long', seq, command: `echo ${seq}`, runId: 'run-done' });
  const r = await getJson('/api/terminal/sessions/t-long');
  assert.equal(r.blocks.length, 200);
  assert.deepEqual([r.blocks[0].seq, r.blocks.at(-1).seq], [31, 230]);
  assert.equal(r.totalBlocks, 230);
  const tail = await getJson('/api/terminal/sessions/t-long?after=225');
  assert.deepEqual(tail.blocks.map((b) => b.seq), [226, 227, 228, 229, 230]);
  assert.equal(tail.totalBlocks, 5);
});

test('a branch terminal that cannot start leaves no new folder behind', { skip: !BASH }, async () => {
  spawnSync('git', ['branch', 'feat/leak'], { cwd: repo });
  const opened = [];
  for (;;) {                                                   // fill every terminal slot
    const r = await post(`/api/runs/run-live/terminal?${q()}`, {});
    const body = await r.json();
    if (r.status !== 201) { assert.equal(body.code, 'TOO_MANY_SESSIONS'); break; }
    opened.push(body.session.id);
  }
  try {
    const r = await post(`/api/projects/${key}/terminal`, { branch: 'feat/leak' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'TOO_MANY_SESSIONS');
    assert.equal(listBranchWorktrees(key).some((w) => w.branch === 'feat/leak'), false, 'no row');
    assert.equal(existsSync(join(branchWorktreeRoot(worcaHome()), key, branchCheckoutName('feat/leak'))), false, 'no folder');
    assert.equal(spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' }).stdout.includes(branchCheckoutName('feat/leak')), false);
  } finally {
    for (const id of opened) await closeSession(id);
  }
});

test('a project terminal without a branch opens in the project\'s own folder, and closing it removes nothing', { skip: !BASH }, async () => {
  const before = spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' }).stdout;
  const r = await post(`/api/projects/${key}/terminal`, { cols: 80, rows: 20 });
  assert.equal(r.status, 201);
  const { session, warning } = await r.json();
  assert.equal(warning, null);
  assert.deepEqual([session.scope, session.cwd, session.branch, session.runId], ['project', repo, 'main', null]);
  const ctx = await getJson(`/api/projects/${key}/terminal`);
  assert.equal(ctx.dir, repo);
  assert.ok(ctx.sessions.some((s) => s.id === session.id && s.scope === 'project'));
  assert.equal(listBranchWorktrees(key).some((w) => w.dir === repo), false, 'the project folder is not a worca folder');
  const audit = await getJson(`/api/terminal/audit?sessionId=${session.id}`);
  assert.deepEqual(audit.audit.map((a) => [a.action, a.detail]), [['open', repo]]);
  assert.deepEqual(await closeSession(session.id), { ok: true });
  await waitFor(async () => (await getJson('/api/terminal')).sessions.find((s) => s.id === session.id)?.status === 'closed');
  await new Promise((res) => setTimeout(res, 200));        // the status listener's release runs async
  assert.ok(existsSync(join(repo, '.git')), 'the project folder is still there');
  assert.equal(spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' }).stdout, before);
});

test('a project terminal has the same gates as the others: raw fields and other origins are refused', async () => {
  const r = await post(`/api/projects/${key}/terminal`, { cwd: '/' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'RAW_FIELD');
  const foreign = await raw('POST', `/api/projects/${key}/terminal`, { host: `127.0.0.1:${port}`, origin: 'http://127.0.0.1:4401' }, {});
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'TERMINAL_CROSS_ORIGIN');
});
