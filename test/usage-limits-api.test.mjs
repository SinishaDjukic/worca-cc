// test/usage-limits-api.test.mjs — GET /api/usage-limits (the profile's usage rings, D7): only real readings, and a
// recorded change broadcasts usage-limits-changed. The server is closed in after().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const prev = { WORCA_HOME: process.env.WORCA_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let home, srv, base, port, limits;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-usage-api-'));
  process.env.WORCA_HOME = home; process.env.HOME = home; process.env.USERPROFILE = home;
  ({ server: srv } = await import('../ui/server.mjs'));   // the server itself: it carries the /ws upgrade
  limits = await import('../src/core/usage-limits.mjs');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port; base = `http://127.0.0.1:${port}`;
});
after(async () => {
  if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(home, { recursive: true, force: true });
});

test('GET /api/usage-limits: no readings is an empty list, never a seeded one', async () => {
  const r = await fetch(`${base}/api/usage-limits`);
  assert.deepEqual([r.status, await r.json()], [200, { harnesses: [] }]);
});

test('a recorded reading is served, and broadcasts usage-limits-changed', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    for (let i = 0; i < 80 && !msgs.some((m) => m.type === 'hello'); i++) await new Promise((r) => setTimeout(r, 25));
    const resetsAt = Date.now() + 3600e3;
    assert.equal(limits.recordUsageLimit('claude', { type: 'limit', status: 'allowed', windows: [{ window: 'five_hour', utilization: 0.31, resetsAt }] }), true);
    for (let i = 0; i < 80 && !msgs.some((m) => m.type === 'usage-limits-changed'); i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(msgs.some((m) => m.type === 'usage-limits-changed'), JSON.stringify(msgs.map((m) => m.type)));
    const body = await (await fetch(`${base}/api/usage-limits`)).json();
    assert.deepEqual(body.harnesses.map((h) => [h.engine, h.windows]), [['claude', [{ kind: 'session', pct: 31, resetsAt }]]]);
  } finally { ws.close(); }
});
