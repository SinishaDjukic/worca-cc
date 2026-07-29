// test/server-counts-broadcast.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact, writeStoreMeta } from '../src/core/artifacts.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

let srv, httpBase, wsBase, homeDir, prevHome;
const created = []; // throwaway git repos to clean up

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-bcast-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  httpBase = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
  for (const dir of created) await rm(dir, { recursive: true, force: true });
});

function waitFor(pred, timeoutMs = 4000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => { const v = pred(); if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15); };
    tick();
  });
}
function connect() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  return { ws, msgs };
}
const open = (ws) => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

/** A real git repo so the server's per-member isGitRepo resolution passes. */
async function freshRepo(prefix = 'worca-cc-bcast-repo-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

test('project create + delete each broadcast projects-changed to EVERY client', async () => {
  const a = connect(); const b = connect();
  await Promise.all([open(a.ws), open(b.ws)]);

  let res = await fetch(`${httpBase}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'demo', path: homeDir }),
  });
  assert.equal(res.status, 200);
  await waitFor(() =>
    a.msgs.some((m) => m.type === 'projects-changed' && m.action === 'created') &&
    b.msgs.some((m) => m.type === 'projects-changed' && m.action === 'created'));

  res = await fetch(`${httpBase}/api/projects?name=demo`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  await waitFor(() => a.msgs.some((m) => m.type === 'projects-changed' && m.action === 'deleted'));

  a.ws.close(); b.ws.close();
});

test('a rejected (400) project create does NOT broadcast', async () => {
  const a = connect();
  await open(a.ws);
  const res = await fetch(`${httpBase}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '', path: '' }),
  });
  assert.equal(res.status, 400);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(a.msgs.filter((m) => m.type === 'projects-changed').length, 0);
  a.ws.close();
});

test('workspace create + delete each broadcast workspaces-changed to EVERY client', async () => {
  const a = connect(); const b = connect();
  await Promise.all([open(a.ws), open(b.ws)]);

  const repoA = await freshRepo(); const repoB = await freshRepo();
  let res = await fetch(`${httpBase}/api/workspaces`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Create WS', projectPaths: [repoA, repoB], description: 'desc' }),
  });
  assert.equal(res.status, 201);
  const { workspace } = await res.json();
  await waitFor(() =>
    a.msgs.some((m) => m.type === 'workspaces-changed' && m.action === 'created') &&
    b.msgs.some((m) => m.type === 'workspaces-changed' && m.action === 'created'));

  res = await fetch(`${httpBase}/api/workspaces/${workspace.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  await waitFor(() => a.msgs.some((m) => m.type === 'workspaces-changed' && m.action === 'deleted'));

  a.ws.close(); b.ws.close();
});

test('a rejected (400) workspace create does NOT broadcast', async () => {
  const a = connect();
  await open(a.ws);
  const res = await fetch(`${httpBase}/api/workspaces`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '', projectPaths: [] }),
  });
  assert.ok(res.status >= 400);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(a.msgs.filter((m) => m.type === 'workspaces-changed').length, 0);
  a.ws.close();
});

test('pipeline delete broadcasts pipelines-changed to EVERY client', async () => {
  // Build the deletable fixture exactly as test/delete-pipeline-api.test.mjs does.
  const KEY = 'beta-00000002';
  const root = join(homeDir, '.worca-cc', 'store', KEY);
  const pdir = join(root, 'pipelines', '04-06-26-my-feature-pp');
  await mkdir(pdir, { recursive: true });
  await writeFile(join(pdir, 'prompt.md'), '# My feature\n', 'utf8');
  await mkdir(join(root, 'plans'), { recursive: true });
  await mkdir(join(root, 'reviews'), { recursive: true });
  await writeFile(join(root, 'plans', '04-06-26-my-feature.md'), '# p', 'utf8');
  await writeFile(join(root, 'reviews', '04-06-26-my-feature-impl-review.md'), '# r', 'utf8');
  writeStoreMeta(KEY, 'project', { key: KEY, name: 'Beta', path: '/repo/beta' });
  seedPipelineRow({
    id: 'pp', projectKey: KEY, title: 'My feature', status: 'stopped',
    baseName: 'my-feature', datePrefix: '04-06-26',
  });
  recordArtifact('pp', 'plan', 'plans/04-06-26-my-feature.md');
  recordArtifact('pp', 'review', 'reviews/04-06-26-my-feature-impl-review.md');

  const a = connect(); const b = connect();
  await Promise.all([open(a.ws), open(b.ws)]);

  const res = await fetch(`${httpBase}/api/runs/pp?projectKey=${KEY}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  await waitFor(() =>
    a.msgs.some((m) => m.type === 'pipelines-changed' && m.action === 'deleted') &&
    b.msgs.some((m) => m.type === 'pipelines-changed' && m.action === 'deleted'));

  a.ws.close(); b.ws.close();
});
