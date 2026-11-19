// test/api-usage-limits.test.mjs — GET /api/usage-limits (ui/routes/runs/drain-and-budget.mjs): the stored readings,
// the usage-limit pause override read from the DB (listUsageLimitPauses) and the `usage-limits-changed` push.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

const H = 3_600_000;
let srv, base, wsBase, home, sandboxHome, mod, store, listUsageLimitPauses;
const prevEnv = {};

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-usage-api-'));
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-usage-api-home-'));
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.WORCA_HOME = home;
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_MOCK = '1';   // no Gemini poller in this file
  _resetForTests();
  store = await import('../src/core/usage-limits.mjs');
  ({ listUsageLimitPauses } = await import('../src/core/artifacts.mjs'));
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  mod?.runs?.clear();
  _resetForTests();
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(home, { recursive: true, force: true });
  await rm(sandboxHome, { recursive: true, force: true });
});

const getAnswer = async () => { const r = await fetch(`${base}/api/usage-limits`); assert.equal(r.status, 200); return r.json(); };
let seq = 0;
function seedPause({ status = 'paused', reason = 'usage_limit', engine = 'claude', resetAt = new Date(Date.now() + H).toISOString(),
  archived = false, deleted = false, updatedAt = new Date(Date.now() - 60_000).toISOString() } = {}) {
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  seedPipelineRow({ id, status, phase: 'implement', startedAt: updatedAt, updatedAt });
  const point = { pauseReason: reason, ...(engine ? { limitEngine: engine } : {}), ...(resetAt ? { limitResetAt: resetAt } : {}) };
  getDb().prepare('UPDATE pipelines SET resume_point = ?, archived_at = ?, deleted_at = ? WHERE id = ?')
    .run(JSON.stringify(point), archived ? updatedAt : null, deleted ? updatedAt : null, id);
  return { id, resetAt, updatedAt };
}
const clearPauses = () => getDb().prepare("UPDATE pipelines SET status = 'done', resume_point = NULL").run();

test('GET /api/usage-limits returns the shape; a write broadcasts once, a repeat never', async () => {
  assert.deepEqual(await getAnswer(), { harnesses: [] });
  let presence = 0;
  const onPresence = () => { presence += 1; };
  mod.app.on('page-sockets-changed', onPresence);   // what the Gemini poller's page gate listens to
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    const resetsAt = Date.now() + 2 * H;
    const reading = { observedAt: Date.now(), windows: [{ kind: 'session', pct: 41, resetsAt }, { kind: 'week', pct: 12, resetsAt: resetsAt + H }] };
    assert.equal(store.recordUsageReading('codex', reading), true);
    assert.equal(store.recordUsageReading('codex', reading), false);
    await getAnswer();   // the frames went out before this answer
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(frames.filter((f) => f.type === 'usage-limits-changed').length, 1);
    const a = await getAnswer();
    assert.equal(a.harnesses.length, 1);
    assert.equal(a.harnesses[0].engine, 'codex');
    assert.equal(typeof a.harnesses[0].observedAt, 'number');
    assert.deepEqual(a.harnesses[0].windows, [{ kind: 'session', pct: 41, resetsAt }, { kind: 'week', pct: 12, resetsAt: resetsAt + H }]);
  } finally { ws.close(); }
  await new Promise((r) => setTimeout(r, 100));
  mod.app.off('page-sockets-changed', onPresence);
  assert.equal(presence, 2, 'a page socket opening and closing each tell the poller');
});

test('a paused usage_limit row shows Session 100% (Day for gemini) until its reset', async () => {
  clearPauses();
  const p = seedPause({ engine: 'claude' });
  const a = await getAnswer();
  const claude = a.harnesses.find((h) => h.engine === 'claude');
  assert.deepEqual(claude, { engine: 'claude', observedAt: Date.parse(p.updatedAt), windows: [{ kind: 'session', pct: 100, resetsAt: Date.parse(p.resetAt) }] });
  clearPauses();
  const g = seedPause({ engine: 'gemini' });
  const gem = (await getAnswer()).harnesses.find((h) => h.engine === 'gemini');
  assert.deepEqual(gem.windows, [{ kind: 'day', pct: 100, resetsAt: Date.parse(g.resetAt) }]);
  clearPauses();
});

test('listUsageLimitPauses keeps only live paused usage_limit rows of a known engine', () => {
  clearPauses();
  const keep = seedPause({ engine: 'codex' });
  seedPause({ archived: true });
  seedPause({ deleted: true });
  seedPause({ status: 'interrupted' });
  seedPause({ reason: 'cost_total' });
  seedPause({ engine: null });
  seedPause({ engine: 'copilot' });
  assert.deepEqual(listUsageLimitPauses(), [{ engine: 'codex', resetsAt: Date.parse(keep.resetAt), pausedAt: Date.parse(keep.updatedAt) }]);
  clearPauses();
  const none = seedPause({ engine: 'claude', resetAt: null });
  assert.deepEqual(listUsageLimitPauses(), [{ engine: 'claude', resetsAt: null, pausedAt: Date.parse(none.updatedAt) }]);
  clearPauses();
});

test('a pause query that throws still answers 200 with the stored readings', async () => {
  const stored = store.usageLimits();
  getDb().exec('ALTER TABLE pipelines RENAME TO pipelines_hidden');
  try {
    const r = await fetch(`${base}/api/usage-limits`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), stored);
  } finally { getDb().exec('ALTER TABLE pipelines_hidden RENAME TO pipelines'); }
});
