// test/api-schedule-keep-next.test.mjs — POST /api/schedules/:id/keep-next (Stillhet's "Keep next time"): it undoes
// the most recent "Skip next time" of a series (last skipped, first kept), and a refusal writes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, getDb, dir;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b = {}) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const get = async (p) => (await fetch(`${base}${p}`)).json();
const rule = { freq: 'daily', time: '02:00', tz: 'UTC' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-keep-next-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ getDb } = await import('../src/core/db.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('keep-next');
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
});

async function series(title = 'Nightly') {
  const r = await post('/api/run', { projectDir: dir, prompt: title, title, mock: true, repeat: { rule } });
  assert.equal(r.status, 202);
  return r.json();
}
const rows = (id) => ({
  schedule: { ...getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id) },
  tickets: getDb().prepare('SELECT * FROM scheduled_runs WHERE schedule_id = ? ORDER BY id').all(id).map((r) => ({ ...r })),
});
const open = (id) => getDb().prepare("SELECT run_at FROM scheduled_runs WHERE schedule_id = ? AND status = 'scheduled'").all(id).map((r) => r.run_at);
const skip = async (id) => (await (await post(`/api/schedules/${id}/skip-next`)).json()).item;
const keep = async (id) => { const r = await post(`/api/schedules/${id}/keep-next`); return { status: r.status, body: await r.json() }; };

test('skip then keep brings back the same next time with one open ticket', async () => {
  const made = await series();
  const first = (await get(`/api/schedules/${made.scheduleId}`)).item.nextRunAt;
  const skipped = await skip(made.scheduleId);
  assert.notEqual(skipped.nextRunAt, first);
  const k = await keep(made.scheduleId);
  assert.equal(k.status, 200);
  assert.equal(k.body.kind, 'recurring');
  assert.equal(k.body.item.nextRunAt, first);
  assert.equal(k.body.item.skippedRunAt, null);
  assert.deepEqual(open(made.scheduleId), [first]);
});

test('skip, skip, keep restores the second slot and shows the first as skipped; a second keep restores the first', async () => {
  const made = await series('Twice');
  const s1 = (await get(`/api/schedules/${made.scheduleId}`)).item.nextRunAt;
  const s2 = (await skip(made.scheduleId)).nextRunAt;
  await skip(made.scheduleId);
  const k = await keep(made.scheduleId);
  assert.equal(k.status, 200);
  assert.equal(k.body.item.nextRunAt, s2);
  assert.equal(k.body.item.skippedRunAt, s1);
  assert.deepEqual(open(made.scheduleId), [s2]);
  const k2 = await keep(made.scheduleId);
  assert.equal(k2.body.item.nextRunAt, s1);
  assert.equal(k2.body.item.skippedRunAt, null);
  assert.deepEqual(open(made.scheduleId), [s1]);
});

test('refusals answer 409 or 404 and change no row', async () => {
  const made = await series('Refused');
  let before = rows(made.scheduleId);
  let k = await keep(made.scheduleId);
  assert.deepEqual([k.status, k.body], [409, { error: 'nothing is skipped', code: 'nothing-skipped' }]);
  assert.deepEqual(rows(made.scheduleId), before);

  await skip(made.scheduleId);
  // the tick fired (or passed) the skipped slot: nothing to keep any more
  getDb().prepare("UPDATE scheduled_runs SET run_at = ? WHERE schedule_id = ? AND status = 'skipped'").run(new Date(Date.now() - 60_000).toISOString(), made.scheduleId);
  before = rows(made.scheduleId);
  k = await keep(made.scheduleId);
  assert.deepEqual([k.status, k.body.code], [409, 'nothing-skipped']);
  assert.deepEqual(rows(made.scheduleId), before);

  await skip(made.scheduleId);
  assert.equal((await post(`/api/schedules/${made.scheduleId}/pause`)).status, 200);
  before = rows(made.scheduleId);
  k = await keep(made.scheduleId);
  assert.deepEqual([k.status, k.body], [409, { error: 'this schedule is paused' }]);
  assert.deepEqual(rows(made.scheduleId), before);

  k = await keep(made.runId);
  assert.deepEqual([k.status, k.body], [404, { error: 'repeating schedule not found' }]);
  k = await keep('sch_00000000');
  assert.deepEqual([k.status, k.body], [404, { error: 'schedule not found' }]);
});

test('a ticket already in flight after the skipped slot is never deleted', async () => {
  const made = await series('In flight');
  await skip(made.scheduleId);
  const pending = getDb().prepare("SELECT id FROM scheduled_runs WHERE schedule_id = ? AND status = 'scheduled'").get(made.scheduleId).id;
  getDb().prepare('UPDATE scheduled_runs SET owner_pid = 4242 WHERE id = ?').run(pending);
  assert.equal((await keep(made.scheduleId)).status, 200);
  assert.ok(getDb().prepare('SELECT id FROM scheduled_runs WHERE id = ?').get(pending), 'the owned ticket stays');
});

test('a skip before Pause/Resume is not kept after it: no second open ticket, nothing to keep', async () => {
  const made = await series('Paused between');
  await skip(made.scheduleId);
  assert.equal((await post(`/api/schedules/${made.scheduleId}/pause`)).status, 200);
  assert.equal((await post(`/api/schedules/${made.scheduleId}/resume`)).status, 200);
  const item = (await get(`/api/schedules/${made.scheduleId}`)).item;
  assert.equal(item.skippedRunAt, null, 'the resumed series shows no skipped time');
  const before = rows(made.scheduleId);
  const k = await keep(made.scheduleId);
  assert.deepEqual([k.status, k.body.code], [409, 'nothing-skipped']);
  assert.deepEqual(rows(made.scheduleId), before);
  assert.equal(open(made.scheduleId).length, 1);
});

test('a skip before an edit of the rule is not kept after it: the old slot never comes back', async () => {
  const made = await series('Edited between');
  await skip(made.scheduleId);
  const r = await fetch(`${base}/api/schedules/${made.scheduleId}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ rule: { ...rule, time: '03:00' } }) });
  assert.equal(r.status, 200);
  const next = (await get(`/api/schedules/${made.scheduleId}`)).item;
  assert.equal(next.skippedRunAt, null);
  const k = await keep(made.scheduleId);
  assert.deepEqual([k.status, k.body.code], [409, 'nothing-skipped']);
  assert.deepEqual(open(made.scheduleId), [next.nextRunAt]);
});
