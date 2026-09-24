// test/api-schedule-attribution.test.mjs — step 4 over HTTP: a schedule/ticket records who made it
// (the request's identity, via WORCA_IDENTITY_HEADER here), every change records who changed it,
// and GET /api/schedules exposes createdBy / updatedBy. No actor is ever taken from a body.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, dir;
const H = 'X-Forwarded-Email';
const call = (method, p, b, who) => fetch(`${base}${p}`, {
  method, headers: { 'Content-Type': 'application/json', ...(who ? { [H]: who } : {}) }, ...(b === undefined ? {} : { body: JSON.stringify(b) }),
});
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();
const list = async () => (await fetch(`${base}/api/schedules`)).json();

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-sched-attrib-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = H;
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('sched-attrib');
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_IDENTITY_HEADER;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('a one-shot ticket: created by the requester, changed by whoever moves it; a body cannot claim anyone', async () => {
  let r = await call('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true, scheduledFor: inFuture(3600_000), createdBy: 'mallory@example.com' }, 'ada@example.com');
  assert.equal(r.status, 202, await r.clone().text());
  const { runId } = await r.json();
  let t = (await list()).tickets.find((x) => x.id === runId);
  assert.equal(t.createdBy, 'ada@example.com');
  r = await call('PATCH', `/api/schedules/${runId}`, { scheduledFor: inFuture(7200_000) }, 'grace@example.com');
  assert.equal(r.status, 200, await r.clone().text());
  t = (await list()).tickets.find((x) => x.id === runId);
  assert.equal(t.updatedBy, 'grace@example.com');
  assert.equal(t.createdBy, 'ada@example.com');
  r = await call('DELETE', `/api/schedules/${runId}`, undefined, 'bob@example.com');
  assert.equal(r.status, 200);
});

test('a series: creator, then pause/resume/skip/edit by other people; local requests record "local"', async () => {
  let r = await call('POST', '/api/run', { projectDir: dir, prompt: 'nightly', mock: true, repeat: { rule: { freq: 'daily', time: '02:00', tz: 'UTC' } } }, 'ada@example.com');
  assert.equal(r.status, 202, await r.clone().text());
  const { scheduleId } = await r.json();
  const series = async () => (await list()).schedules.find((x) => x.id === scheduleId);
  assert.equal((await series()).createdBy, 'ada@example.com');
  for (const [verb, who] of [['pause', 'grace@example.com'], ['resume', 'bob@example.com'], ['skip-next', 'grace@example.com']]) {
    r = await call('POST', `/api/schedules/${scheduleId}/${verb}`, {}, who);
    assert.equal(r.status, 200, `${verb}: ${await r.clone().text()}`);
    assert.equal((await series()).updatedBy, who, verb);
  }
  r = await call('PATCH', `/api/schedules/${scheduleId}`, { title: 'Nightly deps' });
  assert.equal(r.status, 200);
  assert.equal((await series()).updatedBy, 'local', 'no sign-in: the machine itself');
  assert.equal((await series()).createdBy, 'ada@example.com');
});
