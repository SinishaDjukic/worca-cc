// test/readiness-routes.test.mjs
// The agent-readiness routes in ui/server.mjs: GET /api/projects/:key/readiness (kill switch, 404,
// missing folder, ?refresh=1), the cache-only `readiness` summary on GET /api/projects, and the
// readiness-changed WebSocket frame bridged from the cache's `changed` event.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { templateRepo } from './helpers/git-dir.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { cache as readinessCache } from '../src/core/repo-readiness/cache.mjs';
import { projectSyncEvents } from '../src/core/project-sync.mjs';

useTempHome(after);

let srv, base, wsBase, prevMock, prevKill;
const JSONH = { 'Content-Type': 'application/json' };
const created = [];

before(async () => {
  prevMock = process.env.WORCA_MOCK;
  prevKill = process.env.WORCA_READINESS;
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_READINESS;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(async () => {
  if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevKill === undefined) delete process.env.WORCA_READINESS; else process.env.WORCA_READINESS = prevKill;
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
let seq = 0;
async function addProject(dir) {
  const name = `readiness-api-${++seq}`;
  const res = await call('POST', '/api/projects', { name, path: dir });
  assert.equal(res.status, 200);
  const { projects } = await res.json();
  return projects.find((p) => p.name === name);
}
function freshRepo(files = {}) {
  const dir = templateRepo('readiness-routes', { branch: 'main', user: true, files: { 'README.md': '# hi\n', ...files } });
  created.push(dir);
  return dir;
}
function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 5000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

test('GET /api/projects/:key/readiness returns {readiness: report} for a registered repo', async () => {
  const p = await addProject(freshRepo());
  const res = await call('GET', `/api/projects/${p.key}/readiness`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.readiness, 'a report is returned');
  assert.equal(typeof body.readiness.catalogVersion, 'number');
  assert.ok(body.readiness.engines.claude, 'the claude engine is evaluated');
  assert.ok(Array.isArray(body.readiness.checks));
});

test('GET /api/projects/:key/readiness answers 404 for an unknown project and 400 for a bad key', async () => {
  const missing = await call('GET', '/api/projects/no-such-project-00000000/readiness');
  assert.equal(missing.status, 404);
  const bad = await call('GET', '/api/projects/bad%20key/readiness');
  assert.equal(bad.status, 400);
});

test('GET /api/projects/:key/readiness returns {disabled: true} when the kill switch is off', async () => {
  const p = await addProject(freshRepo());
  process.env.WORCA_READINESS = '0';
  try {
    const res = await call('GET', `/api/projects/${p.key}/readiness`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { disabled: true });
    const list = await (await call('GET', '/api/projects')).json();
    assert.equal(list.projects.find((x) => x.key === p.key).readiness, null, 'no summary while disabled');
  } finally {
    delete process.env.WORCA_READINESS;
  }
});

test('GET /api/projects/:key/readiness returns {readiness: null} when the folder is gone', async () => {
  const dir = freshRepo();
  const p = await addProject(dir);
  await rm(dir, { recursive: true, force: true });
  const res = await call('GET', `/api/projects/${p.key}/readiness`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { readiness: null });
});

test('GET /api/projects carries a cache-only readiness summary, null until a report is cached', async () => {
  // Added with the kill switch off, so the on-add background evaluation leaves the cache cold.
  process.env.WORCA_READINESS = '0';
  let p;
  try { p = await addProject(freshRepo()); } finally { delete process.env.WORCA_READINESS; }
  const cold = await (await call('GET', '/api/projects')).json();
  assert.equal(cold.projects.find((x) => x.key === p.key).readiness, null, 'listing never evaluates');

  await call('GET', `/api/projects/${p.key}/readiness`);
  const warm = await (await call('GET', '/api/projects')).json();
  const summary = warm.projects.find((x) => x.key === p.key).readiness;
  assert.ok(summary, 'summary appears once cached');
  assert.deepEqual(Object.keys(summary).sort(), ['applicable', 'failingCount', 'level', 'mustFix', 'passed', 'shouldFix']);
  assert.equal(typeof summary.level, 'string');
  assert.equal(typeof summary.failingCount, 'number');
});

test('?refresh=1 re-evaluates instead of returning the cached report object', async () => {
  const p = await addProject(freshRepo());
  const first = await (await call('GET', `/api/projects/${p.key}/readiness`)).json();
  const again = await (await call('GET', `/api/projects/${p.key}/readiness?refresh=1`)).json();
  assert.ok(again.readiness);
  assert.deepEqual(again.readiness.engines, first.readiness.engines);
});

test('a cache `changed` event is broadcast as a readiness-changed frame carrying the project key', async () => {
  const c = openWs();
  await c.opened;
  try {
    readinessCache.emit('changed', { projectKey: 'frame-proj' });
    const frame = await waitFor(() => c.msgs.find((m) => m.type === 'readiness-changed'));
    assert.equal(frame.action, 'frame-proj');
  } finally {
    c.ws.close();
  }
});

test('adding a project evaluates it in the background: a readiness-changed frame, a warm summary and a not-ready nudge', async () => {
  const c = openWs();
  await c.opened;
  try {
    const p = await addProject(freshRepo());
    const frame = await waitFor(() => c.msgs.find((m) => m.type === 'readiness-changed' && m.action === p.key));
    assert.equal(frame.action, p.key);
    const list = await (await call('GET', '/api/projects')).json();
    assert.ok(list.projects.find((x) => x.key === p.key).readiness, 'summary is cached without any GET …/readiness');
    const added = await waitFor(() => c.msgs.find((m) => m.type === 'readiness-added' && m.projectKey === p.key));
    assert.equal(added.engine, 'Claude Code');
    assert.equal(added.name, p.name);
  } finally {
    c.ws.close();
  }
});

test('a project-sync change re-evaluates an already-evaluated project whose HEAD moved', async () => {
  const dir = freshRepo();
  const p = await addProject(dir);
  const first = await (await call('GET', `/api/projects/${p.key}/readiness`)).json();
  assert.equal(first.readiness.engines.claude.level, 'not-ready');
  const c = openWs();
  await c.opened;
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\nRun `npm test` to test.\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    execSync('git add -A && git commit -q -m instructions', { cwd: dir, stdio: 'ignore' });
    c.msgs.length = 0;
    projectSyncEvents.emit('changed', { projectKey: p.key });
    await waitFor(() => c.msgs.find((m) => m.type === 'readiness-changed' && m.action === p.key));
    const list = await (await call('GET', '/api/projects')).json();
    assert.notEqual(list.projects.find((x) => x.key === p.key).readiness.level, 'not-ready');
  } finally {
    c.ws.close();
  }
});

test('PATCH readiness.tools emits readiness-changed and the summary follows', async () => {
  const p = await addProject(freshRepo({ 'CLAUDE.md': '# c\n' }));
  await call('GET', `/api/projects/${p.key}/readiness`);
  const ready = (await (await call('GET', '/api/projects')).json()).projects.find((x) => x.key === p.key).readiness;
  assert.equal(ready.level, 'ready');
  const c = openWs();
  await c.opened;
  try {
    const res = await call('PATCH', `/api/projects/${p.key}/settings`, { 'readiness.tools': { codex: 'used' } });
    assert.equal(res.status, 200);
    await waitFor(() => c.msgs.find((m) => m.type === 'readiness-changed' && m.action === p.key));
    const s = (await (await call('GET', '/api/projects')).json()).projects.find((x) => x.key === p.key).readiness;
    assert.equal(s.level, 'not-ready');
    assert.equal(s.failingCount, 1);
  } finally {
    c.ws.close();
  }
});

test('GET …/readiness judges only used tools: a fresh repo with CLAUDE.md is ready, Codex is unused', async () => {
  const p = await addProject(freshRepo({ 'CLAUDE.md': '# c\n' }));
  const { readiness } = await (await call('GET', `/api/projects/${p.key}/readiness`)).json();
  assert.equal(readiness.level, 'ready');
  assert.equal(readiness.engines.claude.used, true);
  assert.equal(readiness.engines.codex.level, 'unused');
  assert.equal(typeof readiness.checkedAt, 'string');
});

test('changing the project Run engine re-judges readiness: a readiness-changed frame and the new engine in the summary', async () => {
  const p = await addProject(freshRepo({ 'CLAUDE.md': '# c\n' }));
  await call('GET', `/api/projects/${p.key}/readiness`);
  assert.equal((await (await call('GET', '/api/projects')).json()).projects.find((x) => x.key === p.key).readiness.level, 'ready');
  const c = openWs();
  await c.opened;
  try {
    const res = await call('PATCH', `/api/projects/${p.key}/settings`, { 'run.engine': 'codex' });
    assert.equal(res.status, 200);
    await waitFor(() => c.msgs.find((m) => m.type === 'readiness-changed' && m.action === p.key));
    const s = (await (await call('GET', '/api/projects')).json()).projects.find((x) => x.key === p.key).readiness;
    assert.equal(s.level, 'not-ready', 'OpenAI Codex has no AGENTS.md');
  } finally {
    c.ws.close();
  }
});
