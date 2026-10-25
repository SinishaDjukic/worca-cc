// test/flags-api.test.mjs — the flag service: createFlags with an injected env and store (D12, part 1),
// then the real routes, the `flags` frame and POST /api/settings {flags} over HTTP (part 2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { checkRows } from './helpers/rows.mjs';
import { createFlags, FlagError } from '../src/core/flags.mjs';

const fx = { title: 'T', description: 'D', owner: 'o', since: '1.0.0', added: '2026-10-11', reviewBy: '2026-12-01' };
const REG = [
  { ...fx, key: 'baseFlag', stage: 'experimental', default: false, requires: [] },
  { ...fx, key: 'midFlag', stage: 'experimental', default: false, requires: ['baseFlag'] },
  { ...fx, key: 'topFlag', stage: 'beta', default: false, requires: ['midFlag'] },
  { ...fx, key: 'oldFlag', stage: 'retiring', default: false, requires: [] },
];
function harness(env = '') {
  let stored = {};
  const frames = [];
  const f = createFlags({ registry: REG, env: () => env, read: () => ({ ...stored }), write: async (m) => { stored = { ...m }; }, warn: () => {} });
  f.events.on('changed', (m) => frames.push(m));
  return { f, frames, stored: () => stored };
}

test('createFlags: set validates, cascades requires, stores only non-defaults, emits', async () => {
  await checkRows([
    { name: 'true / false / null round-trip; only non-default values are stored', run: async () => {
      const h = harness();
      await h.f.set({ baseFlag: true });
      assert.deepEqual(h.stored(), { baseFlag: true });
      await h.f.set({ baseFlag: false });
      assert.deepEqual(h.stored(), {}, 'false is the default: not stored');
      await h.f.set({ baseFlag: true });
      await h.f.set({ baseFlag: null });
      assert.deepEqual(h.stored(), {});
      assert.equal(h.frames.length, 4);
      assert.deepEqual(h.frames[0], { baseFlag: true, midFlag: false, topFlag: false, oldFlag: false });
    } },
    { name: 'turning on cascades the whole requires closure; turning off cascades to dependents', run: async () => {
      const h = harness();
      await h.f.set({ topFlag: true });
      assert.deepEqual(h.stored(), { baseFlag: true, midFlag: true, topFlag: true });
      await h.f.set({ baseFlag: false });
      assert.deepEqual(h.stored(), {}, 'mid and top go off with base');
    } },
    { name: '400-class: unknown key, retiring key, non-boolean value, non-object body', run: async () => {
      const h = harness();
      for (const body of [{ ghostFlag: true }, { oldFlag: true }, { baseFlag: 'yes' }, [1], null]) {
        await assert.rejects(h.f.set(body), (e) => e instanceof FlagError && e.code === 'invalid', JSON.stringify(body));
      }
      assert.deepEqual(h.stored(), {});
      assert.equal(h.frames.length, 0);
    } },
    { name: '409-class: env-locked key, locked prerequisite, locked dependent', run: async () => {
      await assert.rejects(harness('baseFlag').f.set({ baseFlag: false }), (e) => e.code === 'locked' && e.key === 'baseFlag');
      await assert.rejects(harness('-baseFlag').f.set({ midFlag: true }), (e) => e.code === 'locked' && e.key === 'baseFlag');
      const h = harness('midFlag');
      await h.f.set({ baseFlag: true });
      await assert.rejects(h.f.set({ baseFlag: false }), (e) => e.code === 'locked' && e.key === 'midFlag');
      assert.throws(() => h.f.check({ baseFlag: false }), (e) => e.code === 'locked', 'check() is the same validation, synchronous');
    } },
    { name: 'an env lock that contradicts settings does not block an unrelated change; {} is a no-op', run: async () => {
      const h = harness('topFlag');   // topFlag locked on while its prerequisites are off: it resolves off (fail closed)
      assert.equal(h.f.enabled('topFlag'), false);
      await h.f.set({ midFlag: false });   // nothing depends on this body's change that is not already off
      await h.f.set({});
      assert.deepEqual([h.stored(), h.frames.length], [{}, 1]);
      await h.f.set({ midFlag: true });
      assert.deepEqual(h.stored(), { baseFlag: true, midFlag: true });
      assert.equal(h.f.enabled('topFlag'), true);
    } },
    { name: 'list omits retiring flags and has the GET shape; enabled() and map()', run: async () => {
      const h = harness('baseFlag');
      assert.deepEqual(h.f.list().map((x) => x.key), ['baseFlag', 'midFlag', 'topFlag']);
      assert.deepEqual(h.f.list()[0], { key: 'baseFlag', title: 'T', description: 'D', stage: 'experimental', on: true,
        source: 'env', locked: true, docs: null, requires: [] });
      assert.equal(h.f.enabled('baseFlag'), true);
      assert.equal(h.f.enabled('ghostFlag'), false);
      assert.deepEqual(h.f.map(), { baseFlag: true, midFlag: false, topFlag: false, oldFlag: false });
    } },
    { name: 'requireFlag: 404 { error: "not found" } off, next() on; an unknown key throws at definition', run: async () => {
      const h = harness();
      const mw = h.f.requireFlag('baseFlag');
      const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      let nexted = 0;
      mw({}, res, () => { nexted += 1; });
      assert.deepEqual([res.code, res.body, nexted], [404, { error: 'not found' }, 0]);
      await h.f.set({ baseFlag: true });
      mw({}, res, () => { nexted += 1; });
      assert.equal(nexted, 1);
      assert.throws(() => h.f.requireFlag('ghostFlag'), /unknown flag "ghostFlag"/);
    } },
  ]);
});

// Part 2 — GET/PATCH /api/flags, POST /api/settings {flags}, the `flags` frame, `flags` in hello and
// GET /api/settings. HOME is sandboxed (settings.json lives under it).
let home, srv, base, prev, settingsFile;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-flags-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';   // P15: settings.json lives under the sandboxed HOME
  delete process.env.WORCA_FLAGS;
  (await import('../src/core/db.mjs'))._resetForTests();   // as test/settings-api.test.mjs does
  ({ settingsFile } = await import('../src/core/settings.mjs'));
  const mod = await import('../ui/server.mjs');
  srv = mod.server;   // the WS-capable server
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const patch = (body) => fetch(`${base}/api/flags`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stored = async () => { try { return JSON.parse(await readFile(settingsFile(), 'utf8')).flags; } catch { return undefined; } };
const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 15)); } };

test('HTTP: GET shape, PATCH true/false/null, 400/409, the flags frame, hello and settings carry flags', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch {} });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    await checkRows([
      { name: 'hello carries flags', run: async () => {
        await waitFor(() => msgs.some((m) => m.type === 'hello'));
        assert.deepEqual(msgs.find((m) => m.type === 'hello').flags, { flagsDemo: false, keepAwake: true, shapeFirst: true, runTags: false, runPresets: true, commandSummaries: true, runLabels: false, smartRunNaming: false, corporateProxy: false, requirements: false });
      } },
      { name: 'GET /api/flags: the documented shape, plus docsUrl', run: async () => {
        const j = await (await fetch(`${base}/api/flags`)).json();
        const row = j.flags.find((f) => f.key === 'flagsDemo');
        assert.deepEqual(Object.keys(row).sort(), ['description', 'docs', 'docsUrl', 'key', 'locked', 'on', 'requires', 'source', 'stage', 'title']);
        assert.deepEqual([row.on, row.source, row.locked], [false, 'default', false]);
      } },
      { name: 'PATCH true stores it, answers the GET shape and broadcasts one flags frame', run: async () => {
        const r = await patch({ flagsDemo: true });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).flags.find((f) => f.key === 'flagsDemo').on, true);
        assert.deepEqual(await stored(), { flagsDemo: true });
        await waitFor(() => msgs.some((m) => m.type === 'flags'));
        assert.deepEqual(msgs.filter((m) => m.type === 'flags').at(-1), { type: 'flags', flags: { flagsDemo: true, keepAwake: true, shapeFirst: true, runTags: false, runPresets: true, commandSummaries: true, runLabels: false, smartRunNaming: false, corporateProxy: false, requirements: false } });
        assert.match(await (await fetch(`${base}/`)).text(), /data-flags="flagsDemo keepAwake shapeFirst runPresets commandSummaries"/);
        assert.equal((await (await fetch(`${base}/api/settings`)).json()).flags.flagsDemo, true);
      } },
      { name: 'PATCH {keepAwake:false} (the Settings › Runs switch) turns it off and broadcasts; null restores the default', run: async () => {
        const r = await patch({ keepAwake: false });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).flags.find((f) => f.key === 'keepAwake').on, false);
        await waitFor(() => msgs.some((m) => m.type === 'flags' && m.flags.keepAwake === false));
        assert.equal((await patch({ keepAwake: null })).status, 200);
        assert.equal((await (await fetch(`${base}/api/flags`)).json()).flags.find((f) => f.key === 'keepAwake').on, true);
      } },
      { name: 'shapeFirst is beta and on by default; a stored false (the Settings › Labs switch) is respected; null restores it', run: async () => {
        const row = () => fetch(`${base}/api/flags`).then((r) => r.json()).then((j) => j.flags.find((f) => f.key === 'shapeFirst'));
        assert.deepEqual(await row().then((f) => [f.stage, f.on, f.source]), ['beta', true, 'default']);
        assert.equal((await patch({ shapeFirst: false })).status, 200);
        assert.equal((await stored()).shapeFirst, false, 'an explicit off is the one value kept');
        assert.deepEqual(await row().then((f) => [f.on, f.source]), [false, 'settings']);
        await waitFor(() => msgs.some((m) => m.type === 'flags' && m.flags.shapeFirst === false));
        assert.equal((await patch({ shapeFirst: null })).status, 200);
        assert.equal((await stored())?.shapeFirst, undefined);
        assert.deepEqual(await row().then((f) => [f.on, f.source]), [true, 'default']);
      } },
      { name: 'PATCH false and null both leave nothing stored (default false)', run: async () => {
        assert.equal((await patch({ flagsDemo: false })).status, 200);
        assert.equal(await stored(), undefined);
        await patch({ flagsDemo: true });
        assert.equal((await patch({ flagsDemo: null })).status, 200);
        assert.equal(await stored(), undefined);
      } },
      { name: '400 for an unknown key or a non-boolean value; nothing written', run: async () => {
        for (const body of [{ ghostFlag: true }, { flagsDemo: 'on' }]) {
          const r = await patch(body);
          assert.equal(r.status, 400);
          assert.match((await r.json()).error, /unknown flag|must be true, false or null/);
        }
        assert.equal(await stored(), undefined);
      } },
      { name: '409 { code: "locked" } for a WORCA_FLAGS key; GET shows it locked', run: async () => {
        process.env.WORCA_FLAGS = 'flagsDemo';
        try {
          const r = await patch({ flagsDemo: false });
          assert.equal(r.status, 409);
          assert.equal((await r.json()).code, 'locked');
          const row = (await (await fetch(`${base}/api/flags`)).json()).flags[0];
          assert.deepEqual([row.on, row.source, row.locked], [true, 'env', true]);
        } finally { delete process.env.WORCA_FLAGS; }
      } },
      { name: 'POST /api/settings {flags} goes through the same setter (and a bad key is a 400 on field flags)', run: async () => {
        const post = (b) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
        assert.equal((await post({ flags: { flagsDemo: true } })).status, 200);
        assert.deepEqual(await stored(), { flagsDemo: true });
        const bad = await post({ flags: { ghostFlag: true } });
        assert.equal(bad.status, 400);
        assert.equal((await bad.json()).field, 'flags');
        assert.deepEqual(await stored(), { flagsDemo: true }, 'the bad body wrote nothing');
        const mixed = await post({ uiLevel: 'advanced', flags: { flagsDemo: 'yes' } });
        assert.equal(mixed.status, 400);
        assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).uiLevel, undefined, 'pre-asserted: uiLevel was not half-applied');
        await patch({ flagsDemo: null });
      } },
      { name: 'POST /api/settings {flags: {}} is a no-op: no frame, root kept', run: async () => {
        const n = msgs.filter((m) => m.type === 'flags').length;
        const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flags: {} }) });
        assert.equal(r.status, 200);
        await new Promise((res) => setTimeout(res, 100));
        assert.equal(msgs.filter((m) => m.type === 'flags').length, n);
      } },
    ]);
  } finally { ws.close(); }
});

test('GET /api/flags lists commandSummaries as beta, on with no override', async () => {
  const { flags } = await (await fetch(`${base}/api/flags`)).json();
  const f = flags.find((x) => x.key === 'commandSummaries');
  assert.equal(f.stage, 'beta');
  assert.equal(f.on, true);
});
