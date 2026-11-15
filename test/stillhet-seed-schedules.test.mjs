// test/stillhet-seed-schedules.test.mjs — tools/stillhet-seed-schedules.mjs seeds the eight states of the Schedules state
// table through dev's own routes (D13): the failed start's ticket reads failed and its series paused itself; the chat
// states carry their chat. It needs the in-process server and real mock runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let srv, base, mod, seed, seeded;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_MOCK: process.env.WORCA_MOCK, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };

before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-seed-schedules-test-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  seed = await import('../tools/stillhet-seed-schedules.mjs');
  const proj = await mkdtemp(join(tmpdir(), 'worca-seed-schedules-proj-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@worca.local'], ['config', 'user.name', 't']]) execFileSync('git', a, { cwd: proj });
  await writeFile(join(proj, 'README.md'), '# t\n');
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  seeded = await seed.seedSchedules({ base, projectDir: proj, tick: () => mod.schedulerTick() });
});
after(async () => {
  for (const id of [seeded?.tickets?.running, seeded?.tickets?.ended].filter(Boolean)) {   // a ticket's id is its run's id at fire
    await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: id }) }).catch(() => {});
  }
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries({ HOME: saved.HOME, USERPROFILE: saved.USERPROFILE, WORCA_MOCK: saved.WORCA_MOCK, WORCA_TEST_ALLOW_HOME_FALLBACK: saved.ALLOW })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const get = async (id) => (await fetch(`${base}/api/schedules/${id}`)).json();

test('the eight states of the table, through dev\'s routes', async () => {
  assert.deepEqual(seed.SEEDED_SCHEDULES.map((s) => s.key), ['next', 'skipped', 'paused', 'failing', 'missed', 'running', 'waiting', 'ended']);
  const s = seeded.schedules;
  assert.equal((await get(s.next)).item.status, 'active');
  const skipped = (await get(s.skipped)).item;
  assert.ok(skipped.skippedRunAt, 'skipped next carries the slot Keep next time restores');
  assert.deepEqual([(await get(s.paused)).item.status, (await get(s.paused)).item.pauseReason], ['paused', 'user']);
  const failing = await get(s.failing);
  assert.deepEqual([failing.item.status, failing.item.pauseReason], ['paused', 'failure_streak']);
  assert.equal(failing.history.find((t) => t.id === seeded.tickets.failed)?.status, 'failed', 'the failed start\'s ticket reads failed');
  assert.equal(failing.item.presetName, null, 'its preset was deleted');
  assert.equal((await get(s.missed)).item.status, 'missed');
  const fire = (await get(s.running)).history.find((t) => t.id === seeded.tickets.running);
  assert.equal(fire?.status, 'fired', fire?.failReason);
  assert.equal((await get(s.waiting)).item.status, 'scheduled');
  assert.equal((await get(s.ended)).item.status, 'ended');
});

test('exactly the chat: true states carry their chat', async () => {
  for (const { key, chat } of seed.SEEDED_SCHEDULES) {
    const item = (await get(seeded.schedules[key])).item;
    assert.equal(!!item.askThreadId, chat, key);
  }
});
