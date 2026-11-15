// test/stillhet-seed-insights.test.mjs — tools/stillhet-seed-insights.mjs (Stillhet slice 10 D22): after seeding, dev's own
// GET /api/stats counts the twelve runs and the two shaped sizes, and GET /api/budget holds the budget. An in-process server;
// HOME and WORCA_HOME are temp folders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-seed-in-');
const prevEnv = {};
let srv, base, seeded, seed, home;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-seed-in-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_MOCK: '1' });
  seed = await import('../tools/stillhet-seed-insights.mjs');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  await seed.sandboxOnly(base);
  seeded = await seed.seedInsights({ base });
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (seeded?.root) await rm(seeded.root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

const get = async (p) => { const r = await fetch(`${base}${p}`); assert.equal(r.status, 200, p); return r.json(); };

test('SEEDED_RUNS lists 12 runs over 3 projects, 2 people, 2 workflows and the client tag, 2 of them shaped', () => {
  assert.equal(seed.SEEDED_RUNS.length, 12);
  assert.deepEqual([...new Set(seed.SEEDED_RUNS.map((r) => r.project))].sort(), ['seed-billing', 'seed-docs', 'seed-web']);
  assert.deepEqual([...new Set(seed.SEEDED_RUNS.map((r) => r.person))].sort(), ['Jonas', 'Maya']);
  assert.deepEqual([...new Set(seed.SEEDED_RUNS.map((r) => r.workflow))].sort(), ['Default', 'Full']);
  assert.equal(seed.SEEDED_RUNS.filter((r) => r.shaped).length, 2);
});

test('after seeding, GET /api/stats?range=all counts 12 runs and 2 shaped sizes; the budget and the spend are dev\'s', async () => {
  const s = await get('/api/stats?range=all&report=1');
  assert.equal(s.totals.runs, 12);
  const shaped = s.shaping.groups.filter((g) => g.shaped.runs > 0).map((g) => g.size);
  assert.deepEqual(shaped.sort(), ['medium', 'small']);
  const total = seed.SEEDED_RUNS.reduce((a, r) => a + r.usd, 0);
  assert.equal(Math.round(s.totals.spentUsd * 100), Math.round(total * 100));
  assert.deepEqual([...new Set(s.report.runs.map((f) => f.project))].sort(), ['seed-billing', 'seed-docs', 'seed-web']);
  assert.equal(s.report.runs.filter((f) => f.tags.client === 'acme').length, 6);
  assert.equal((await get('/api/budget')).totalLimitUsd, seed.SEEDED_BUDGET_USD);
});

test('it refuses to run outside a blank sandbox', async () => {
  await assert.rejects(seed.sandboxOnly(base), /not a blank sandbox/);
});
