// test/api-chat-home-pins.test.mjs — GET/PUT /api/chat-home/pins: the Chat home's pinned workflows, one ordered list
// per person in settings.json (src/shared/home-pins.mjs, src/core/settings.mjs chatHomePinsFor).
//
// SANDBOX: HOME/USERPROFILE point at a temp dir and WORCA_HOME is removed, so the settings file is never the real
// ~/.worca-cc one; WORCA_TEST_ALLOW_HOME_FALLBACK lets the settings readers see that sandboxed file (same boot as
// test/settings-api.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let home, srv, base, prev;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-pinsapi-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK',
    'WORCA_PROJECTS_ROOT', 'WORCA_IDENTITY_HEADER']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  delete process.env.WORCA_PROJECTS_ROOT;
  delete process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await rm(home, { recursive: true, force: true });
});

const pins = (headers = {}) => fetch(`${base}/api/chat-home/pins`, { headers }).then((r) => r.json());
const put = (body, headers = {}) => fetch(`${base}/api/chat-home/pins`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('never set: GET returns the default Shaper pin', async () => {
  assert.deepEqual((await pins()).pins, ['wf_shape']);
});

test('PUT stores one ordered list; [] sticks (Shaper unpinned); duplicates collapse', async () => {
  const r = await put({ pins: ['wf_pay', 'wf_shape', 'wf_pay'] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).pins, ['wf_pay', 'wf_shape']);
  assert.deepEqual((await pins()).pins, ['wf_pay', 'wf_shape']);
  await put({ pins: [] });
  assert.deepEqual((await pins()).pins, []);
});

test('PUT rejects a non-list with 400 and writes nothing', async () => {
  await put({ pins: ['wf_pay'] });
  const r = await put({ pins: 'wf_x' });
  assert.equal(r.status, 400);
  assert.deepEqual((await pins()).pins, ['wf_pay']);
});

test('per person: two signed-in people keep separate lists; the local list is untouched', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  try {
    await put({ pins: ['wf_a'] }, { 'x-test-user': 'Ada@example.com' });
    await put({ pins: [] }, { 'x-test-user': 'bob@example.com' });
    assert.deepEqual((await pins({ 'x-test-user': 'ada@example.com' })).pins, ['wf_a'], 'keyed case-insensitively');
    assert.deepEqual((await pins({ 'x-test-user': 'bob@example.com' })).pins, []);
    assert.deepEqual((await pins({ 'x-test-user': 'cy@example.com' })).pins, ['wf_shape'], 'a new person gets the default');
  } finally { delete process.env.WORCA_IDENTITY_HEADER; }
  assert.deepEqual((await pins()).pins, ['wf_pay'], 'the local list is untouched');
});
