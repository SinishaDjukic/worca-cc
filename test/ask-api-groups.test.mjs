// test/ask-api-groups.test.mjs — /api/ask/groups (issue #948 slice 3): create, rename, move, remove, ungroup, delete,
// archive (409 while a member is busy) and suggest-name (404 while smartRunNaming is off).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let sandboxHome, srv, base, mod;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-askgroups-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_FLAGS']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'chatsColumn,-smartRunNaming';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

const chat = async (title) => (await (await call('POST', '/api/ask/threads', { title })).json()).thread;

test('chatsColumn off: every group route answers 404', async () => {
  process.env.WORCA_FLAGS = '-chatsColumn';
  assert.equal((await call('GET', '/api/ask/groups')).status, 404);
  assert.equal((await call('POST', '/api/ask/groups', { name: 'x', threadIds: [] })).status, 404);
});

test('smartRunNaming off: POST suggest-name answers 404; on (mock): the fixed name', async () => {
  process.env.WORCA_FLAGS = 'chatsColumn,-smartRunNaming';
  const a = await chat('Fix the login');
  assert.equal((await call('POST', '/api/ask/groups/suggest-name', { threadIds: [a.id] })).status, 404);
  process.env.WORCA_FLAGS = 'chatsColumn,smartRunNaming';
  const r = await call('POST', '/api/ask/groups/suggest-name', { threadIds: [a.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { source: 'model', name: 'Mock group' });
  assert.equal((await call('POST', '/api/ask/groups/suggest-name', { threadIds: ['nope'] })).status, 400);
});

test('create, rename, move, remove; GET lists the group with its count; threads carry groupId', async () => {
  process.env.WORCA_FLAGS = 'chatsColumn';
  const [a, b] = [await chat('a'), await chat('b')];
  const made = await call('POST', '/api/ask/groups', { name: 'Release prep', nameSource: 'suggested', threadIds: [a.id] });
  assert.equal(made.status, 201);
  const { group } = await made.json();
  assert.equal(group.nameSource, 'suggested');
  assert.equal((await call('POST', `/api/ask/groups/${group.id}/threads`, { threadIds: [b.id] })).status, 200);
  const renamed = await (await call('PATCH', `/api/ask/groups/${group.id}`, { name: 'Login work', nameSource: 'user' })).json();
  assert.equal(renamed.group.name, 'Login work');
  const list = await (await call('GET', '/api/ask/groups')).json();
  assert.equal(list.groups.find((g) => g.id === group.id).count, 2);
  const page = await (await call('GET', '/api/ask/threads?show=all&limit=50')).json();
  assert.equal(page.threads.find((t) => t.id === a.id).groupId, group.id);
  assert.equal((await call('DELETE', `/api/ask/groups/${group.id}/threads/${a.id}`)).status, 200);
  assert.equal((await call('PATCH', `/api/ask/groups/${group.id}`, { name: '' })).status, 400);
});

test('404 and 400 paths: a missing group, an unknown chat id, a bad id list', async () => {
  process.env.WORCA_FLAGS = 'chatsColumn';
  assert.equal((await call('PATCH', '/api/ask/groups/askg_00000000', { name: 'x' })).status, 404);
  assert.equal((await call('POST', '/api/ask/groups', { name: 'x', threadIds: ['ask_00000000'] })).status, 404);
  assert.equal((await call('POST', '/api/ask/groups', { name: 'x', threadIds: [] })).status, 400);
  assert.equal((await call('POST', '/api/ask/groups/askg_00000000/archive', { archived: true })).status, 404);
});

test('deleting the last chat of a group through DELETE /api/ask/threads/:id drops the group', async () => {
  process.env.WORCA_FLAGS = 'chatsColumn';
  const a = await chat('only');
  const { group } = await (await call('POST', '/api/ask/groups', { name: 'Solo', threadIds: [a.id] })).json();
  assert.equal((await call('DELETE', `/api/ask/threads/${a.id}`)).status, 200);
  const list = await (await call('GET', '/api/ask/groups')).json();
  assert.ok(!list.groups.some((g) => g.id === group.id));
});

test('Archive group: 409 CHAT_BUSY while a member replies (nothing archived); 200 once idle', async () => {
  process.env.WORCA_FLAGS = 'chatsColumn';
  const [a, b] = [await chat('Ship notes'), await chat('b')];
  const { group } = await (await call('POST', '/api/ask/groups', { name: 'G', threadIds: [a.id, b.id] })).json();
  mod._testing.askJobs.set(a.id, { turn: { stop() {} }, status: 'running', graceTimer: null });
  try {
    const r = await call('POST', `/api/ask/groups/${group.id}/archive`, { archived: true });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, 'CHAT_BUSY');
    assert.equal(body.threadId, a.id);
    assert.equal(body.error, "Can't archive while “Ship notes” is busy. Wait for it to finish or stop it.");
    const t = await (await call('GET', `/api/ask/threads/${b.id}`)).json();
    assert.equal(t.thread.archivedAt, null, 'no member archived');
  } finally { mod._testing.askJobs.delete(a.id); }
  // b archived on its own first: the group archive changes (and answers) only a.
  assert.equal((await call('PATCH', `/api/ask/threads/${b.id}`, { archived: true })).status, 200);
  const ok = await call('POST', `/api/ask/groups/${group.id}/archive`, { archived: true });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).threadIds, [a.id]);
  assert.equal((await call('POST', `/api/ask/groups/${group.id}/archive`, { archived: false })).status, 200);
});

test('DELETE deleteChats=false ungroups (chats stay); deleteChats=true deletes the chats', async () => {
  process.env.WORCA_FLAGS = 'chatsColumn';
  const a = await chat('a');
  let { group } = await (await call('POST', '/api/ask/groups', { name: 'G', threadIds: [a.id] })).json();
  assert.equal((await call('DELETE', `/api/ask/groups/${group.id}?deleteChats=false`)).status, 200);
  assert.equal((await (await call('GET', `/api/ask/threads/${a.id}`)).json()).thread.groupId, null);
  ({ group } = await (await call('POST', '/api/ask/groups', { name: 'G', threadIds: [a.id] })).json());
  const r = await (await call('DELETE', `/api/ask/groups/${group.id}?deleteChats=true`)).json();
  assert.equal(r.deleted, 1);
  assert.equal((await call('GET', `/api/ask/threads/${a.id}`)).status, 404);
});
