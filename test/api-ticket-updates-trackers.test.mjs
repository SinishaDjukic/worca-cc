// test/api-ticket-updates-trackers.test.mjs — Ticket updates' routes and New run's project list for github-source
// (plans/ticket-updates-pr2-plan.md decisions 1 and 7) on the real server in mock mode: GitHub keys a project as owner/repo, a
// single-profile source saves under `default`, and the Repository input lists the projects you work on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { readTicketUpdates } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses } from '../src/core/plugin-shim.mjs';

useTempHome(after, 'worca-tu-trackers-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'ticketUpdates';
process.env.WORCA_MOCK = '1';
const GITHUB = fileURLToPath(new URL('../plugins/github-source', import.meta.url));
let srv; let base;

before(async () => {
  await linkPlugin('github-source', GITHUB);
  ({ server: srv } = await import('../ui/server.mjs'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { json = null; }
  return { status: r.status, json };
};
const TU = '/api/plugins/github-source/ticket-updates';
const enc = encodeURIComponent;
const NONE_ALL = { project: '', moment: 'finished', target: { kind: 'none' } };
const NOT_PLANNED = { kind: 'status', value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' };

test('decision 1: a project may be owner/repo: its statuses, a save and the GET take it; any other slash is refused', async () => {
  setMockSourceResponses(null);
  assert.equal((await call('GET', `${TU}/statuses?sourceId=github&project=${enc('Acme/API')}`)).status, 200);
  const rules = [NONE_ALL, { project: 'Acme/API', label: 'API', moment: 'finished', target: NOT_PLANNED }];
  assert.deepEqual((await call('PUT', TU, { sourceId: 'github', projects: [{ value: 'Acme/API', label: 'API' }], rules })).json, { ok: true });
  const rec = readTicketUpdates('github-source', 'default', 'github');
  assert.deepEqual([rec.projects, rec.rules], [[{ value: 'Acme/API', label: 'API' }], rules], 'a single-profile source saves under default');
  const got = (await call('GET', `${TU}?sourceId=github`)).json;
  assert.deepEqual([got.available, got.connection, got.profile, got.saved, got.rules[1].project],
    [true, 'saved', { id: 'default', label: 'GitHub Issues' }, true, 'Acme/API']);
  // %252e%252e arrives as "%2e%2e": a key never has "%", and no part of it is "." or ".."
  for (const bad of ['a/b/c', '/a', 'a/', 'a//b', 'a/..', './a', 'a/%252e%252e', 'a\\b/c']) {
    assert.deepEqual(await call('GET', `${TU}/statuses?sourceId=github&project=${bad.includes('%') ? bad : enc(bad)}`).then((x) => [x.status, x.json]),
      [400, { error: 'project is not a project key' }], bad);
  }
  assert.equal((await call('PUT', TU, { sourceId: 'github', projects: [{ value: 'a/b/c' }], rules: [NONE_ALL] })).status, 400);
});
