// test/agentgen-api.test.mjs
// Phase 2 · Task 6 server surface in ui/server.mjs: the agentgen-* WS family.
//   - POST /api/agents/generate: fire-and-forget createAgentGen launcher ->
//     {genId}; registers a kind:'agentgen' entry in the SAME runs Map; the mock
//     reaches agentgen-done with a draft and NEVER saves it to the agent store.
//   - Validation: missing name -> 400; missing purpose without userMarkdown -> 400;
//     userMarkdown alone (Mode B, meta-only) -> 200.
//   - WS reconnect/replay: ?genId= replays buffered agentgen events tagged genId.
//   - POST /api/agents/generate/stop: {genId} -> entry.orch.stop(); status
//     'stopped'; idempotent on an unknown id.
//
// Mock-driven (WORCA_MOCK=1): the agent-gen engine's runClaude uses the
// agent-gen mock role, so NOTHING spawns real claude. chdir-into-sandbox
// containment + useTempHome mirror scan-api.test.mjs so no background work
// pollutes the real worca-cc repo or ~/.worca-cc.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after); // outlives the per-suite hooks (background gen scratch writes)

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, wsBase, runs, _testing, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const created = [];

before(async () => {
  // A throwaway git repo to absorb anything cwd-relative (belt-and-braces).
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-agentgenapi-cwd-'));
  const g = (a) => spawnSync('git', a, { cwd: cwdSandbox });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(cwdSandbox, 'README.md'), '# sandbox\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  process.chdir(cwdSandbox);

  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-agentgenapi-'));
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

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });

/** Open a WS, optionally with a query (e.g. `?genId=...`), collecting messages. */
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

// ── POST /api/agents/generate ───────────────────────────────────────────────

test('POST /api/agents/generate -> {genId}; entry kind agentgen; mock reaches done with a draft', async () => {
  const r = await post('/api/agents/generate', {
    name: 'Docs Writer', purpose: 'write docs', details: 'd',
    expectedBefore: ['planner'], expectedAfter: ['reviewer'],
  });
  assert.equal(r.status, 200);
  const { genId } = await r.json();
  assert.match(genId, /^agen_[0-9a-f-]{36}$/);
  const entry = runs.get(genId);
  assert.equal(entry.kind, 'agentgen');
  await waitFor(() => entry.status === 'done' || entry.status === 'error');
  assert.equal(entry.status, 'done');
  const done = entry.events.find((e) => e.type === 'agentgen-done');
  assert.equal(done.genId, genId);
  assert.equal(done.draft.meta.key, 'docsWriter');
  assert.match(done.draft.markdown, /Docs Writer/);
  // NOT saved: the draft never touched the store.
  assert.equal((await fetch(`${base}/api/agents/docsWriter`)).status, 404);
});

test('POST /api/agents/generate: missing name -> 400; missing purpose without userMarkdown -> 400', async () => {
  assert.equal((await post('/api/agents/generate', { purpose: 'p' })).status, 400);
  assert.equal((await post('/api/agents/generate', { name: 'X' })).status, 400);
  assert.equal((await post('/api/agents/generate', { name: 'X', userMarkdown: '# body' })).status, 200);
});

// ── WS subscribe/replay (?genId=) ───────────────────────────────────────────

test('WS ?genId= replays buffered agentgen events tagged with genId', async () => {
  const { genId } = await (await post('/api/agents/generate', { name: 'Replay A', purpose: 'p' })).json();
  await waitFor(() => ['done', 'error'].includes(runs.get(genId).status));
  const { ws, msgs, opened } = openWs(`?genId=${encodeURIComponent(genId)}`);
  await opened;
  await waitFor(() => msgs.some((m) => m.type === 'agentgen-done' && m.genId === genId));
  assert.ok(msgs.some((m) => m.type === 'agentgen-progress' && m.genId === genId));
  ws.close();
});

// ── POST /api/agents/generate/stop ──────────────────────────────────────────

test('POST /api/agents/generate/stop: calls orch.stop(); idempotent on unknown id', async () => {
  let stopped = false;
  const entry = {
    id: 'agen_stop-1', genId: 'agen_stop-1', kind: 'agentgen',
    orch: Object.assign(new (await import('node:events')).EventEmitter(), { stop() { stopped = true; } }),
    projectDir: null, title: 'gen', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(entry.id, entry);
  try {
    const r = await post('/api/agents/generate/stop', { genId: 'agen_stop-1' });
    assert.equal(r.status, 200);
    assert.equal(stopped, true);
    assert.equal(entry.status, 'stopped');
  } finally { runs.delete(entry.id); }
  assert.equal((await post('/api/agents/generate/stop', { genId: 'agen_unknown' })).status, 200);
});
