// test/scan-api.test.mjs
// Milestone 5 server surface in ui/server.mjs: the scan-* WS family.
//   - wireScan: tags scan events with scanId, maps scan-progress->running,
//     scan-done->done, scan-error->error; leaves the 7-event run plumbing alone.
//   - POST /api/workspaces/scan (pre-persist): {scanId}; >=2 paths + existsSync +
//     reject non-git-repos 400.
//   - POST /api/workspaces/:id/scan (re-scan): 404 if absent; scans a known ws.
//   - POST /api/scan/stop: {scanId} -> entry.orch.stop(); status 'stopped'.
//   - summarizeRuns tolerates a scan entry (kind:'scan', scanId set, no pipelineId).
//   - WS reconnect/replay: ?scanId= AND {type:'subscribe',scanId} replay buffered
//     scan events; broadcasts are tagged with scanId.
//
// Mock-driven (WORCA_MOCK=1): the scan engine's graph phase skips graphify and
// the scanning agent uses mockWorkspaceScan, so NOTHING spawns real claude or
// builds a real graphify graph and the engine creates ZERO worktrees/branches.
// chdir-into-sandbox containment + useTempHome mirror workspaces-api.test.mjs so
// no background scan pollutes the real worca-cc repo or ~/.worca-cc.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

import { createWorkspaceScan } from '../src/core/workspace-scan.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after); // outlives the per-suite hooks (background scan store writes)

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, wsBase, runs, _testing, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const created = [];

before(async () => {
  // A throwaway git repo to absorb anything cwd-relative (belt-and-braces).
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-scanapi-cwd-'));
  const g = (a) => spawnSync('git', a, { cwd: cwdSandbox });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(cwdSandbox, 'README.md'), '# sandbox\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  process.chdir(cwdSandbox);

  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-scanapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  _testing = mod._testing;
  // Listen on the MODULE's http.Server — that is the one the WebSocketServer is
  // attached to (path:'/ws'). A fresh http.createServer(mod.app) would not carry
  // the WS upgrade handler, so /ws would 404.
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const r of runs.values()) {
    try { r.orch && typeof r.orch.stop === 'function' && r.orch.stop(); } catch { /* best-effort */ }
  }
  runs.clear();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  process.chdir(origCwd);
  if (cwdSandbox) await rm(cwdSandbox, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshRepo(prefix = 'worca-cc-scanapi-repo-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
async function freshDir(prefix = 'worca-cc-scanapi-plain-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });

/** Open a WS, optionally with a query (e.g. `?scanId=...`), collecting messages. */
function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 4000) {
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

// ── unit: wireScan ──────────────────────────────────────────────────────────

test('wireScan: tags scanId + maps scan-progress->running, scan-done->done, scan-error->error', () => {
  const entry = {
    id: 'scan_unit-1', scanId: 'scan_unit-1', kind: 'scan',
    orch: new EventEmitter(), projectDir: '/tmp/x', title: 'scan',
    status: 'starting', startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(entry.id, entry);
  try {
    _testing.wireScan(entry);

    entry.orch.emit('scan-progress', { phase: 'graph', projectsTotal: 2, projectsDone: 0, message: 'x' });
    assert.equal(entry.status, 'running', 'scan-progress -> running');
    assert.equal(entry.events.at(-1).scanId, 'scan_unit-1', 'event tagged with scanId');
    assert.equal(entry.events.at(-1).type, 'scan-progress');

    entry.orch.emit('scan-done', { description: '# WS', projects: [], graphify: { used: false } });
    assert.equal(entry.status, 'done', 'scan-done -> done');
    assert.equal(entry.events.at(-1).type, 'scan-done');

    // A later error must still flip status (independent emitter for this assertion).
    entry.orch.emit('scan-error', { message: 'boom' });
    assert.equal(entry.status, 'error', 'scan-error -> error');
  } finally {
    runs.delete(entry.id);
  }
});

test('wireScan: does NOT subscribe to the 7 run events (run plumbing untouched)', () => {
  const entry = {
    id: 'scan_unit-2', scanId: 'scan_unit-2', kind: 'scan',
    orch: new EventEmitter(), projectDir: '/tmp/x', title: 'scan',
    status: 'starting', startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(entry.id, entry);
  try {
    _testing.wireScan(entry);
    // A run-family 'phase' event must be ignored by a scan entry.
    entry.orch.emit('phase', { phase: 'plan' });
    assert.equal(entry.events.length, 0, 'wireScan ignores run-family events');
    assert.equal(entry.status, 'starting', 'status unchanged by a run event');
  } finally {
    runs.delete(entry.id);
  }
});

// ── POST /api/workspaces/scan (pre-persist) ─────────────────────────────────

test('POST /api/workspaces/scan: 2 git repos -> {scanId}; registers a kind:scan entry', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const r = await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'Scan WS' });
  assert.equal(r.status, 200);
  const { scanId } = await r.json();
  assert.match(scanId, /^scan_[0-9a-f-]{36}$/);
  const entry = runs.get(scanId);
  assert.ok(entry, 'a runs-Map entry exists for the scanId');
  assert.equal(entry.kind, 'scan');
  assert.equal(entry.scanId, scanId);
  // It eventually terminates done (mock); then it is no longer "live".
  await waitFor(() => entry.status === 'done' || entry.status === 'error');
  assert.equal(entry.status, 'done', 'mock scan reaches done');
});

test('POST /api/workspaces/scan: <2 paths -> 400', async () => {
  const a = await freshRepo();
  const r = await post('/api/workspaces/scan', { projectPaths: [a] });
  assert.equal(r.status, 400);
});

test('POST /api/workspaces/scan: a missing path -> 400', async () => {
  const a = await freshRepo();
  const r = await post('/api/workspaces/scan', { projectPaths: [a, join(tmpdir(), 'does-not-exist-zzz')] });
  assert.equal(r.status, 400);
});

test('POST /api/workspaces/scan: a non-git member -> 400', async () => {
  const a = await freshRepo();
  const plain = await freshDir();
  const r = await post('/api/workspaces/scan', { projectPaths: [a, plain] });
  assert.equal(r.status, 400);
});

// ── POST /api/workspaces/:id/scan (re-scan) ─────────────────────────────────

test('POST /api/workspaces/:id/scan: unknown id -> 404', async () => {
  const r = await post('/api/workspaces/wks-nope-deadbeef/scan', {});
  assert.equal(r.status, 404);
});

test('POST /api/workspaces/:id/scan: bad id shape -> 404 (no disk touch)', async () => {
  const r = await post('/api/workspaces/not-a-valid-id/scan', {});
  assert.equal(r.status, 404);
});

test('POST /api/workspaces/:id/scan: known workspace -> {scanId}; entry carries workspaceId', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const created = await (await post('/api/workspaces', { name: 'Rescan WS', projectPaths: [a, b] })).json();
  const id = created.workspace.id;
  const r = await post(`/api/workspaces/${id}/scan`, {});
  assert.equal(r.status, 200);
  const { scanId } = await r.json();
  assert.match(scanId, /^scan_/);
  const entry = runs.get(scanId);
  assert.ok(entry, 'entry registered');
  assert.equal(entry.workspaceId, id, 'scan entry tagged with the workspaceId');
  await waitFor(() => entry.status === 'done' || entry.status === 'error');
});

// ── POST /api/scan/stop ─────────────────────────────────────────────────────

test('POST /api/scan/stop: calls entry.orch.stop(); responds ok', async () => {
  let stopped = false;
  const entry = {
    id: 'scan_stop-1', scanId: 'scan_stop-1', kind: 'scan',
    orch: Object.assign(new EventEmitter(), { stop() { stopped = true; } }),
    projectDir: '/tmp/x', title: 'scan', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(entry.id, entry);
  try {
    const r = await post('/api/scan/stop', { scanId: 'scan_stop-1' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(stopped, true, 'orch.stop() invoked');
    assert.equal(entry.status, 'stopped', 'status flipped to stopped');
  } finally {
    runs.delete(entry.id);
  }
});

test('POST /api/scan/stop: unknown scanId -> ok:true (idempotent, no throw)', async () => {
  const r = await post('/api/scan/stop', { scanId: 'scan_unknown' });
  // A stop on a finished/unknown scan must not 500; ok response either way.
  assert.ok(r.status === 200, `expected 200, got ${r.status}`);
});

// ── summarizeRuns tolerance ─────────────────────────────────────────────────

test('summarizeRuns: a scan entry surfaces kind:scan + scanId and tolerates an absent pipelineId', () => {
  const entry = {
    id: 'scan_sum-1', scanId: 'scan_sum-1', kind: 'scan',
    orch: new EventEmitter(), projectDir: '/tmp/x', title: 'scan',
    status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(entry.id, entry);
  try {
    const row = _testing.summarizeRuns().find((s) => s.runId === 'scan_sum-1');
    assert.ok(row, 'scan entry present in the snapshot');
    assert.equal(row.kind, 'scan');
    assert.equal(row.scanId, 'scan_sum-1');
    assert.equal(row.pipelineId, null, 'no pipelineId for a scan');
  } finally {
    runs.delete(entry.id);
  }
});

// ── WS subscribe/replay (?scanId= and {type:subscribe,scanId}) ──────────────

test('WS ?scanId= replays buffered scan events; broadcasts are tagged with scanId', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { scanId } = await (await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'WS Replay' })).json();
  const entry = runs.get(scanId);
  await waitFor(() => entry.status === 'done' || entry.status === 'error');
  assert.equal(entry.status, 'done');

  // Reconnect AFTER the scan finished -> replay must include progress + the
  // terminal scan-done, all tagged with our scanId.
  const { ws, msgs, opened } = openWs(`?scanId=${encodeURIComponent(scanId)}`);
  await opened;
  await waitFor(() => msgs.some((m) => m.type === 'scan-done' && m.scanId === scanId));
  const replayed = msgs.filter((m) => m.scanId === scanId);
  assert.ok(replayed.some((m) => m.type === 'scan-progress'), 'progress replayed');
  assert.ok(replayed.some((m) => m.type === 'scan-done'), 'terminal scan-done replayed');
  for (const m of replayed) assert.equal(m.scanId, scanId, 'every replayed event tagged with scanId');
  ws.close();
});

test('WS {type:"subscribe",scanId} replays buffered scan events identically to runId', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { scanId } = await (await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'WS Sub' })).json();
  const entry = runs.get(scanId);
  await waitFor(() => entry.status === 'done' || entry.status === 'error');

  const { ws, msgs, opened } = openWs();
  await opened;
  // hello first; then ask to subscribe by scanId.
  await waitFor(() => msgs.some((m) => m.type === 'hello'));
  ws.send(JSON.stringify({ type: 'subscribe', scanId }));
  await waitFor(() => msgs.some((m) => m.type === 'scan-done' && m.scanId === scanId));
  assert.ok(msgs.some((m) => m.type === 'scan-progress' && m.scanId === scanId), 'progress replayed via subscribe');
  ws.close();
});

test('WS hello snapshot includes the scan entry (kind:scan)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { scanId } = await (await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'WS Hello' })).json();
  const { ws, msgs, opened } = openWs();
  await opened;
  const hello = await waitFor(() => msgs.find((m) => m.type === 'hello'));
  const row = hello.runs.find((s) => s.runId === scanId || s.scanId === scanId);
  assert.ok(row, 'scan entry present in hello snapshot');
  assert.equal(row.kind, 'scan');
  ws.close();
  await waitFor(() => runs.get(scanId).status === 'done' || runs.get(scanId).status === 'error');
});

// ── re-scan 409 while a live workspace run exists ───────────────────────────

test('POST /api/workspaces/:id/scan: 409 while a live workspace run exists for that id', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const created = await (await post('/api/workspaces', { name: 'Live Run WS', projectPaths: [a, b] })).json();
  const id = created.workspace.id;
  // Register a fake live workspace-run entry for this workspace (no real orch).
  const fake = {
    id: 'uuid-live-run-1', kind: 'workspace-run', workspaceId: id,
    orch: new EventEmitter(), projectDir: a, title: 'run', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(fake.id, fake);
  try {
    const r = await post(`/api/workspaces/${id}/scan`, {});
    assert.equal(r.status, 409, 'a live run for this workspace blocks a re-scan');
    assert.ok((await r.json()).error);
  } finally {
    runs.delete(fake.id);
  }
});

// ── route backstop: a detached engine rejection does NOT crash; it broadcasts
//    a tagged scan-error and flips the entry to error (the .catch in startScan) ─

test('startScan backstop: a rejected run() broadcasts scan-error + status error (no crash)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  // Patch the engine prototype so run() REJECTS (it normally never throws). This
  // exercises the route's .catch backstop deterministically.
  const proto = Object.getPrototypeOf(createWorkspaceScan({ projectPaths: [a, b], claude: { mock: true } }));
  const origRun = proto.run;
  proto.run = async function rejectingRun() { throw new Error('boom in run'); };
  const { ws, msgs, opened } = openWs();
  try {
    await opened;
    await waitFor(() => msgs.some((m) => m.type === 'hello'));
    const { scanId } = await (await post('/api/workspaces/scan', { projectPaths: [a, b], name: 'Backstop' })).json();
    assert.match(scanId, /^scan_/, 'route still returns {scanId} (no 500 on the sync path)');
    await waitFor(() => msgs.some((m) => m.type === 'scan-error' && m.scanId === scanId));
    const errEv = msgs.find((m) => m.type === 'scan-error' && m.scanId === scanId);
    assert.equal(errEv.message, 'boom in run', 'backstop surfaces the thrown message as a tagged scan-error');
    assert.equal(runs.get(scanId).status, 'error', 'entry flipped to error by the backstop');
  } finally {
    proto.run = origRun;
    ws.close();
  }
});
