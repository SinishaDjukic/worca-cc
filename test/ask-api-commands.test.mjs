// test/ask-api-commands.test.mjs — Ask agent mode's server half (#574): the loopback command bridge
// (POST /api/ask/commands), the status route, real commands in a real bash over pipes, the finish event turn
// (and its skip when a tool already showed the end), the audit trail and the live ask-command frame.
// Every response body is consumed: an unread body keeps a keep-alive socket open and srv.close() hangs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { _resetForTests } from '../src/core/db.mjs';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_TERMINAL_PTY', 'SHELL', 'WORCA_MOCK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const BASH = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).status === 0;
let homeDir, repo, key, srv, port, base, mod;

const getJson = async (p) => (await fetch(`${base}${p}`)).json();
async function bridge(token, op, input) {
  const r = await fetch(`${base}/api/ask/commands`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-worca-ask-command': token } : {}) }, body: JSON.stringify({ op, input }) });
  return { status: r.status, body: await r.json() };
}
const idle = async () => {
  for (let i = 0; i < 1000 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};
async function waitFor(pred, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function newThread() {
  const r = await fetch(`${base}/api/ask/threads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const { thread } = await r.json();
  // P4: run_command acts only in the chat's project
  const p = await fetch(`${base}/api/ask/threads/${thread.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: { pinned: true, projectKey: key } }) });
  assert.equal(p.status, 200, await p.text());
  return thread;
}
const userRows = async (tid) => (await getJson(`/api/ask/threads/${tid}`)).messages.filter((m) => m.role === 'user');

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askcmd-home-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_TERMINAL_PTY: '0', SHELL: '/bin/bash', WORCA_MOCK: '1' });
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  _resetForTests();
  repo = await realpath(await mkdtemp(join(tmpdir(), 'askcmd-repo-')));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  await addProject({ name: basename(repo), path: repo });
  key = projectKey(repo);
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await idle();
  const { sessions } = await getJson('/api/terminal');
  for (const s of sessions.filter((x) => x.status === 'running')) await (await fetch(`${base}/api/terminal/sessions/${s.id}`, { method: 'DELETE' })).json();
  mod._testing.askCommands.dispose();
  await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  _resetForTests();
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(repo, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true, maxRetries: 3 });
});

test('the bridge: no token, an unknown token, or a non-loopback Host is refused', async () => {
  assert.equal((await bridge(null, 'list', {})).status, 403);
  assert.equal((await bridge('nope', 'list', {})).status, 403);
  const t = await newThread();
  const b = mod._testing.askCommandBridge({ threadId: t.id });
  try {
    const status = await new Promise((res, rej) => {
      const data = JSON.stringify({ op: 'list', input: {} });
      const r = http.request({ host: '127.0.0.1', port, path: '/api/ask/commands', method: 'POST', headers: {
        host: 'worca.example.com', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-worca-ask-command': b.token } }, (resp) => {
        resp.resume(); resp.on('end', () => res(resp.statusCode));
      });
      r.on('error', rej); r.write(data); r.end();
    });
    assert.equal(status, 403);
    assert.equal((await bridge(b.token, 'nope', {})).status, 400);
  } finally { b.dispose(); }
  assert.equal((await bridge(b.token, 'list', {})).status, 403, 'a finished turn\'s token is gone');
});

test('status: enabled on a local Worca; off under agent isolation', async () => {
  assert.deepEqual(await getJson('/api/ask/commands/status'), { enabled: true });
  assert.equal(mod._testing.askCommandsEnabled(), true);
  process.env.WORCA_AGENT_USER = 'worca-agent'; process.env.WORCA_AGENT_HOME = '/home/worca-agent';
  try {
    assert.equal(mod._testing.askCommandsEnabled(), false);
    assert.equal(mod._testing.askCommandBridge({ threadId: 'ask_00000000' }), null);
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
});

test('run + wait in the project folder; a blocked command is a 409; the block, the audit and the live frame say Ask', { skip: !BASH }, async () => {
  await idle();
  const t = await newThread();
  const b = mod._testing.askCommandBridge({ threadId: t.id });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* binary */ } });
  await new Promise((r) => ws.once('open', r));
  try {
    const blocked = await bridge(b.token, 'run', { command: 'git push --force', projectKey: key });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /blocked/);
    const run = await bridge(b.token, 'run', { command: 'echo hi-574', projectKey: key });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    const { blockId, sessionId } = run.body.result;
    assert.match(blockId, /^t-[0-9a-f]{10}:1$/);
    const w = await bridge(b.token, 'wait', { blockId, timeoutSec: 10 });
    assert.equal(w.body.result.status, 'done');
    assert.equal(w.body.result.exitCode, 0);
    assert.match(w.body.result.tail, /hi-574/);
    const audit = (await getJson(`/api/terminal/audit?sessionId=${sessionId}`)).audit;
    assert.ok(audit.some((a) => a.action === 'open' && a.actor === `ask:${t.id}`));
    assert.ok(audit.some((a) => a.action === 'command' && a.actor === `ask:${t.id}` && a.detail === 'echo hi-574'));
    const listed = await bridge(b.token, 'list', { projectKey: key });
    const row = listed.body.result.blocks.find((x) => x.blockId === blockId);
    assert.equal(row.by, 'ask');
    assert.equal(row.mine, true);
    await waitFor(() => frames.some((f) => f.type === 'ask-command' && f.threadId === t.id && f.command.blockId === blockId && f.command.status === 'done'));
    const view = await getJson(`/api/ask/threads/${t.id}/commands/${encodeURIComponent(blockId)}`);
    assert.equal(view.status, 'done');
    assert.match(view.tail, /hi-574/);
  } finally { b.dispose(); ws.close(); }
  await idle();
});

test('an end no tool showed starts one event turn; an end a wait_for returned is skipped at start time', { skip: !BASH }, async () => {
  await idle();
  const t = await newThread();
  const b = mod._testing.askCommandBridge({ threadId: t.id });
  try {
    const run = await bridge(b.token, 'run', { command: 'echo ev-574', projectKey: key });
    const { blockId } = run.body.result;
    const row = await waitFor(async () => (await userRows(t.id)).find((m) => /^\[worca event\] terminal block /.test(m.text)));
    assert.match(row.text, new RegExp(`^\\[worca event\\] terminal block ${blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} exited 0; "echo ev-574"`));
    await idle();

    // A turn in flight: the end is deferred, the wait shows it, and the drain skips the starter silently.
    const before = (await userRows(t.id)).length;
    mod._testing.askJobs.set(t.id, { status: 'running' });
    try {
      const run2 = await bridge(b.token, 'run', { command: 'sleep 0.3; echo ev2-574', projectKey: key });
      const w = await bridge(b.token, 'wait', { blockId: run2.body.result.blockId, timeoutSec: 10 });
      assert.equal(w.body.result.status, 'done');
      assert.equal(mod._testing.askCommands.seen(run2.body.result.blockId), true);
    } finally { mod._testing.askJobs.delete(t.id); }
    await mod._testing.drainAskDeferred(t.id);
    await idle();
    const msgs = (await getJson(`/api/ask/threads/${t.id}`)).messages;
    assert.equal(msgs.filter((m) => m.role === 'user').length, before, 'no second event turn');
    assert.ok(!msgs.some((m) => m.role === 'system' && /could not reply/.test(m.text)), 'and no failure notice');
  } finally { b.dispose(); }
});

test('shared terminal: the user\'s command in Ask\'s tab never wakes the chat; the next user turn takes it for its context line', { skip: !BASH }, async () => {
  await idle();
  const t = await newThread();
  const b = mod._testing.askCommandBridge({ threadId: t.id });
  const svc = mod._testing.askCommands;
  const realTake = svc.takePersonCommands;
  const taken = [];
  svc.takePersonCommands = (id) => { const r = realTake(id); taken.push({ id, r }); return r; };
  try {
    const run = await bridge(b.token, 'run', { command: 'echo mine-574', projectKey: key });
    const { sessionId } = run.body.result;
    await waitFor(async () => (await userRows(t.id)).some((m) => /^\[worca event\] terminal block /.test(m.text)));
    await idle();
    assert.equal(taken.length, 0, 'an event turn takes nothing');
    const before = (await userRows(t.id)).length;
    mod._testing.terminals.write(sessionId, 'echo theirs-574\n', 'local');
    await waitFor(() => getJson(`/api/terminal/audit?sessionId=${sessionId}`).then((r) => r.audit.some((a) => a.detail === 'echo theirs-574')));
    await new Promise((r) => setTimeout(r, 300));
    await idle();
    assert.equal((await userRows(t.id)).length, before, 'the person command started no turn');
    const r = await fetch(`${base}/api/ask/threads/${t.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'continue', model: 'claude-opus-5-5', effort: 'high' }) });
    assert.ok(r.status < 300, String(r.status)); await r.json();
    await idle();
    const mine = taken.filter((x) => x.id === t.id);
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0].r.map((x) => x.command), ['echo theirs-574']);
  } finally { svc.takePersonCommands = realTake; b.dispose(); }
});
