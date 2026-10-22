// test/git-capability-api.test.mjs — the server's git exposure, in-process (flags-api.test.mjs's harness).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { checkRows } from './helpers/rows.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';

let home, srv, base, prev;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-p0-gitapi-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_GIT']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  // S1: WORCA_GIT wins on every call, so this file lifts it and drives the STORED state (the one that flips and broadcasts).
  delete process.env.WORCA_GIT;
  cap.set({ available: true, version: '2.43.0', path: '/usr/bin/git', reason: 'ok' });
  (await import('../src/core/db.mjs'))._resetForTests();
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  cap.reset(); srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 15)); } };
const getJson = async (p) => (await fetch(`${base}${p}`)).json();

test('git exposure: shell, hello, frame, settings, GET /api/git', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = []; ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch {} });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    await checkRows([
      { name: 'hello carries git (stored: on)', run: async () => {
        await waitFor(() => msgs.some((m) => m.type === 'hello'));
        assert.deepEqual(msgs.find((m) => m.type === 'hello').git, { available: true });
      } },
      { name: 'git goes missing: one git frame; shell, settings and GET /api/git agree', run: async () => {
        cap.set({ available: false });
        await waitFor(() => msgs.some((m) => m.type === 'git'));
        assert.deepEqual(msgs.filter((m) => m.type === 'git').at(-1), { type: 'git', git: { available: false, version: null } });
        assert.match(await (await fetch(`${base}/`)).text(), /data-git="off"/);
        assert.deepEqual((await getJson('/api/settings')).git, { available: false, version: null });
        const g = await getJson('/api/git');
        assert.deepEqual({ ...g, checkedAt: 0 }, { available: false, version: null, reason: 'forced-off', checkedAt: 0 });
        assert.equal(msgs.filter((m) => m.type === 'git').length, 1, 'one flip, one frame');
      } },
      { name: 'a socket that connects while git is missing gets hello git { available: false }', run: async () => {
        const ws2 = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
        const got = []; ws2.on('message', (d) => { try { got.push(JSON.parse(String(d))); } catch {} });
        try {
          await new Promise((res, rej) => { ws2.on('open', res); ws2.on('error', rej); });
          await waitFor(() => got.some((m) => m.type === 'hello'));
          assert.deepEqual(got.find((m) => m.type === 'hello').git, { available: false });
        } finally { ws2.close(); }
      } },
      { name: 'U4: a minute later GET /api/git re-probes once, the flip broadcasts, the shell turns on', run: async () => {
        let n = 0;
        cap.set({ available: false, checkedAt: Date.now() - 61_000 });
        cap.useProbe(async () => { n += 1; return { available: true, path: '/usr/bin/git', version: '2.43.0', reason: 'ok', checkedAt: Date.now() }; });
        assert.equal((await getJson('/api/git')).available, true);
        await getJson('/api/git');
        assert.equal(n, 1, 'cached ~1 min');
        await waitFor(() => msgs.filter((m) => m.type === 'git').at(-1)?.git.available === true);
        assert.deepEqual(msgs.filter((m) => m.type === 'git').at(-1).git, { available: true, version: '2.43.0' });
        assert.match(await (await fetch(`${base}/`)).text(), /data-git="on"/);
      } },
      { name: 'boot order: the probe is awaited at import (CDP proofs import the server), so before isMain: seed, sweeps, loops, listen', run: () => {
        const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
        const at = (s) => { const i = src.indexOf(s); assert.ok(i > 0, s); assert.equal(src.indexOf(s, i + 1), -1, `${s} once`); return i; };
        assert.ok(at('\npreflightDeps();\n') < at('\nawait gitState();\n'), 'right after the dependency check');
        assert.ok(at('\nawait gitState();\n') < at('if (isMain) {'), 'at module scope, before the isMain boot');
        const main = src.slice(at('if (isMain) {'));
        for (const later of ['seedBuiltinMarketplace();', 'bootMaintenance()', 'server.listen(PORT', 'startTeamMetricsBackground(']) assert.ok(main.includes(later), later);
      } },
    ]);
  } finally { ws.close(); }
});
