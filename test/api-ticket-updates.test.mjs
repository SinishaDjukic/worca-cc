// test/api-ticket-updates.test.mjs — Ticket updates' routes (plans/ticket-updates-design.md §5, D8, D16) on the real server in
// mock mode: jira-source linked with a saved connection (acme) and a profile without its values (beta), and a fixture plugin
// with no profile yet. Guards, 502 with A6's sentence, 409 without the capability, 404 with the flag off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writePluginConfig, readTicketUpdates, writeTicketUpdates } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { WebSocket } from 'ws';

useTempHome(after, 'worca-tu-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'ticketUpdates';
process.env.WORCA_MOCK = '1';
const JIRA = fileURLToPath(new URL('../plugins/jira-source', import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(JIRA, 'worca-cc-plugin.json'), 'utf8')).taskSources[0].configSchema;
const FIXTURE = { name: 'tu-fixture', version: '0.1.0', taskSources: [{ id: 'main', displayName: 'Fixture', module: './connector/index.mjs',
  multiProfile: true, configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }],
  inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }] };
let srv; let base; let fixtureDir; let ws;
const frames = [];

before(async () => {
  await linkPlugin('jira-source', JIRA);
  createProfile('jira-source', 'acme', 'Acme');
  createProfile('jira-source', 'beta', 'Beta');
  writePluginConfig('jira-source', SCHEMA, { baseUrl: 'https://acme.atlassian.net', email: 'ann@example.test', token: 'tok-SECRET-1234' }, 'acme');
  fixtureDir = await mkdtemp(join(tmpdir(), 'worca-tu-fixture-'));
  await writeFile(join(fixtureDir, 'worca-cc-plugin.json'), JSON.stringify(FIXTURE, null, 2));
  await mkdir(join(fixtureDir, 'connector'), { recursive: true });
  await writeFile(join(fixtureDir, 'connector', 'index.mjs'),
    'export default () => ({ async validateConfig() { return { ok: true }; }, async listTasks() { return { tasks: [] }; }, async getTask(id) { return { id }; }, async reportResult() {} });\n');
  await linkPlugin('tu-fixture', fixtureDir);
  ({ server: srv } = await import('../ui/server.mjs'));   // the server with its WebSocket, as api-plugins-detail does
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  ws = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
});
after(async () => {
  ws?.close();
  srv?.closeAllConnections?.();
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
  await rm(fixtureDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { json = null; }
  return { status: r.status, json, raw };
};
const TU = '/api/plugins/jira-source/ticket-updates';
const Q = (profile, extra = '') => `?sourceId=jira&profile=${profile}${extra}`;
const RESOLVED = { kind: 'status', value: '10012', label: 'Resolved', category: 'done' };
const VALID = { sourceId: 'jira', profile: 'acme', projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }],
  rules: [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } },
    { project: 'SHOP', label: 'Shop', moment: 'finished', target: RESOLVED }] };

test('flag off: every Ticket updates route answers the gate\'s 404', async () => {
  process.env.WORCA_FLAGS = '-ticketUpdates';
  try {
    for (const [m, p, b] of [['GET', `${TU}${Q('acme')}`], ['GET', `${TU}/projects${Q('acme')}`], ['GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`],
      ['PUT', TU, VALID]]) {
      const r = await call(m, p, b);
      assert.deepEqual([r.status, r.json], [404, { error: 'not found' }], `${m} ${p}`);
    }
  } finally { process.env.WORCA_FLAGS = 'ticketUpdates'; }
});

test('GET: a saved connection, nothing saved yet: the old setting\'s field and what it means; never a config value', async () => {
  setMockSourceResponses(null);
  let r = await call('GET', `${TU}${Q('acme')}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { available: true, connection: 'saved', profile: { id: 'acme', label: 'Acme' }, saved: false, projects: [], rules: [],
    legacy: { field: 'transitionOnComplete', label: 'Transition on completion', target: null } });
  assert.doesNotMatch(r.raw, /tok-SECRET|acme\.atlassian\.net/);
  setMockSourceResponses({ legacyMove: { field: 'transitionOnComplete', target: { typed: 'Resolve' } } });
  r = await call('GET', `${TU}${Q('acme')}`);
  assert.deepEqual(r.json.legacy, { field: 'transitionOnComplete', label: 'Transition on completion', target: { typed: 'Resolve' } });
  setMockSourceResponses({ legacyMove: { field: 'noSuchKey', target: { category: 'done' } } });
  assert.equal((await call('GET', `${TU}${Q('acme')}`)).json.legacy, null, 'a field the schema does not have is no legacy');
  setMockSourceResponses({ legacyMove: undefined });
  assert.equal((await call('GET', `${TU}${Q('acme')}`)).json.legacy, null, 'a plugin without legacyMove');
  setMockSourceResponses(null);
});

test('GET: a profile without its required values is a new connection; nothing but capabilities is asked (board 5 A)', async () => {
  let asked = 0;
  setMockSourceResponses({ legacyMove: () => { asked += 1; return { field: 'transitionOnComplete', target: null }; } });
  const r = await call('GET', `${TU}${Q('beta')}`);
  assert.deepEqual(r.json, { available: true, connection: 'new', profile: { id: 'beta', label: 'Beta' }, saved: false, projects: [], rules: [], legacy: null });
  assert.equal(asked, 0);
  setMockSourceResponses(null);
});

test('GET (Deviation 2): a multi-profile source with no profile yet answers a new connection without a profile', async () => {
  const r = await call('GET', '/api/plugins/tu-fixture/ticket-updates?sourceId=main');
  assert.deepEqual([r.status, r.json], [200, { available: true, connection: 'new', profile: null, saved: false, projects: [], rules: [], legacy: null }]);
  assert.equal((await call('GET', '/api/plugins/tu-fixture/ticket-updates?sourceId=main&profile=work')).status, 400, 'a profile not in the roster');
});

test('the guards of PUT /api/plugins/:name/config: plugin, source, profile', async () => {
  assert.equal((await call('GET', '/api/plugins/no-such-plugin/ticket-updates?sourceId=jira&profile=acme')).status, 404);
  assert.equal((await call('GET', `${TU}?sourceId=nope&profile=acme`)).status, 400);
  assert.equal((await call('GET', `${TU}?sourceId=jira`)).status, 400, 'a multi-profile source with a roster needs a profile');
  assert.equal((await call('GET', `${TU}${Q('ghost')}`)).status, 400, 'not in the roster');
  assert.equal((await call('GET', `${TU}${Q('Bad_Id')}`)).status, 400, 'not a profile id');
  assert.equal((await call('GET', `${TU}/projects?sourceId=jira`)).status, 400);
  assert.equal((await call('PUT', TU, { ...VALID, profile: 'ghost' })).status, 400);
});

test('GET: available is false when the plugin cannot update tickets (no capability, or no capabilities op)', async () => {
  setMockSourceResponses({ capabilities: { writeBack: true, export: true } });
  assert.deepEqual((await call('GET', `${TU}${Q('acme')}`)).json,
    { available: false, connection: 'saved', profile: { id: 'acme', label: 'Acme' }, saved: false, projects: [], rules: [], legacy: null });
  setMockSourceResponses({ capabilities: undefined });
  assert.equal((await call('GET', `${TU}${Q('acme')}`)).json.available, false);
  setMockSourceResponses(null);
});

test('projects and statuses: through the saved profile, unfiltered; a missing project is 400; a tracker failure is 502 with A6\'s sentence', async () => {
  setMockSourceResponses(null);
  const p = await call('GET', `${TU}/projects${Q('acme')}`);
  assert.deepEqual(p.json.projects.map((x) => [x.value, x.name]), [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'],
    ['SUP', 'Support desk'], ['MKT', 'Marketing site'], ['DATA', 'Data platform']]);
  const s = await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`);
  assert.deepEqual(s.json.statuses[2], { value: '10012', label: 'Resolved', category: 'done' });
  assert.equal((await call('GET', `${TU}/statuses${Q('acme')}`)).status, 400);
  // %252e%252e arrives as "%2e%2e" (Express decodes the query once), which a URL parser reads as "..": a key never has "%"
  // or a control character.
  for (const bad of ['..', '.', 'A/B', 'A%5CB', 'A%3FB', 'X'.repeat(101), '%252e%252e', '.%252e', 'A%01B', 'A%7FB']) {
    assert.deepEqual(await call('GET', `${TU}/statuses${Q('acme', `&project=${bad}`)}`).then((x) => [x.status, x.json]),
      [400, { error: 'project is not a project key' }], `project=${bad} never reaches another Jira endpoint`);
  }
  setMockSourceResponses({ listStatuses: [{ value: '1', label: 'Odd', category: 'closed' }, { value: '2', label: 'Open', category: 'todo' }] });
  assert.deepEqual((await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`)).json.statuses, [{ value: '2', label: 'Open', category: 'todo' }],
    'a category outside the four is left out');
  // A tracker failure is logged on the server, first line only and at most 200 characters; the test captures the lines.
  const logged = [];
  const realError = console.error;
  console.error = (...a) => { logged.push(a.map(String).join(' ')); };
  try {
    setMockSourceResponses({ listStatuses: () => { throw new PluginOpError('auth', 'Jira token invalid or expired'); } });
    const f = await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`);
    assert.deepEqual([f.status, f.json], [502, { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' }]);
    setMockSourceResponses({ listProjects: () => { throw new PluginOpError('network', 'Jira unreachable: fetch failed.'); } });
    const g = await call('GET', `${TU}/projects${Q('acme')}`);
    assert.deepEqual([g.status, g.json], [502, { error: 'Worca could not reach Jira: Jira unreachable: fetch failed.', kind: 'network' }]);
    setMockSourceResponses({ listProjects: () => { throw new PluginOpError('plugin', 'plugin "jira-source" is disabled — enable it on the Marketplace page'); } });
    assert.deepEqual((await call('GET', `${TU}/projects${Q('acme')}`)).json,
      { error: 'Worca could not reach Jira: the Jira plugin is disabled.', kind: 'plugin' }, 'not "stopped unexpectedly"');
    setMockSourceResponses({ listProjects: () => { throw new PluginOpError('plugin', `${'Y'.repeat(300)}\nsecond line at x (C:\\a.mjs:1:1)`); } });
    const h = await call('GET', `${TU}/projects${Q('acme')}`);
    assert.deepEqual([h.status, h.json], [502, { error: 'Worca could not reach Jira: the Jira plugin stopped unexpectedly.', kind: 'plugin' }]);
  } finally { console.error = realError; }
  assert.deepEqual(logged, [
    'ticket updates: listStatuses via jira-source/jira failed (auth): Jira token invalid or expired',
    'ticket updates: listProjects via jira-source/jira failed (network): Jira unreachable: fetch failed.',
    'ticket updates: listProjects via jira-source/jira failed (plugin): plugin "jira-source" is disabled — enable it on the Marketplace page',
    `ticket updates: listProjects via jira-source/jira failed (plugin): ${'Y'.repeat(200)}`,
  ], 'the first line of each failure, at most 200 characters');
  setMockSourceResponses({ listStatuses: undefined });
  assert.deepEqual((await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`)).json, { error: 'This plugin cannot update tickets.' });
  setMockSourceResponses(null);
});

test('PUT: §4\'s checks, the record on disk with who and when, then GET answers it; 409 without the capability', async () => {
  let probed = 0;
  setMockSourceResponses({ capabilities: () => { probed += 1; throw new PluginOpError('auth', 'Jira token invalid or expired'); } });
  const bad = await call('PUT', TU, { ...VALID, rules: [VALID.rules[1]] });
  assert.deepEqual([bad.status, bad.json], [400, { error: 'All projects needs exactly one rule.' }]);
  assert.equal(probed, 0, 'a bad body is refused before any child is spawned');
  setMockSourceResponses(null);
  const unsaved = await call('PUT', TU, { ...VALID, profile: 'beta' });
  assert.deepEqual([unsaved.status, unsaved.json],
    [409, { error: "Save this connection first. Ticket updates read Jira's projects and statuses through it." }], 'D12: board 5 A');
  assert.equal(readTicketUpdates('jira-source', 'beta', 'jira'), null);
  const before = frames.filter((f) => f.type === 'plugins-changed' && f.action === 'config').length;
  const r = await call('PUT', TU, VALID);
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
  for (let i = 0; i < 50 && frames.filter((f) => f.type === 'plugins-changed' && f.action === 'config').length === before; i += 1) {
    await new Promise((res) => setTimeout(res, 20));
  }
  assert.equal(frames.filter((f) => f.type === 'plugins-changed' && f.action === 'config').length, before + 1, 'the save emits plugins-changed (config)');
  const rec = readTicketUpdates('jira-source', 'acme', 'jira');
  assert.deepEqual([rec.projects, rec.rules, rec.savedBy], [VALID.projects, VALID.rules, 'local']);
  assert.match(rec.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const g = await call('GET', `${TU}${Q('acme')}`);
  assert.deepEqual([g.json.saved, g.json.projects, g.json.rules], [true, VALID.projects, VALID.rules]);
  assert.equal(g.json.legacy.field, 'transitionOnComplete', 'Deviation 1: still named after the first save');
  setMockSourceResponses({ capabilities: { writeBack: true } });
  const no = await call('PUT', TU, VALID);
  assert.deepEqual([no.status, no.json], [409, { error: 'This plugin cannot update tickets.' }]);
  setMockSourceResponses(null);
});

test('POST /api/sources/call still refuses listStatuses and legacyMove (D8)', async () => {
  for (const op of ['listStatuses', 'legacyMove']) {
    const r = await call('POST', '/api/sources/call', { plugin: 'jira-source', sourceId: 'jira', op, profile: 'acme', args: { project: 'SHOP' } });
    assert.equal(r.status, 400, op);
  }
});

const SIX = ['SHOP', 'CRM', 'OPS', 'SUP', 'MKT', 'DATA'];
test("POST /api/sources/call filters listProjects by the call's profile, only with the flag on and projects picked (D9)", async () => {
  setMockSourceResponses(null);
  const NONE = [{ project: '', moment: 'finished', target: { kind: 'none' } }];
  writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }], rules: NONE });
  const values = async (profile) => (await call('POST', '/api/sources/call', { plugin: 'jira-source', sourceId: 'jira', op: 'listProjects', profile })).json.result.map((p) => p.value);
  assert.deepEqual(await values('acme'), ['SHOP', 'CRM']);
  assert.deepEqual(await values('beta'), SIX, "another profile: its own record (none saved)");
  writeTicketUpdates('jira-source', 'beta', 'jira', { projects: [], rules: NONE });
  assert.deepEqual(await values('beta'), SIX, 'none picked: all projects');
  process.env.WORCA_FLAGS = '-ticketUpdates';
  try { assert.deepEqual(await values('acme'), SIX, 'flag off: no filter'); } finally { process.env.WORCA_FLAGS = 'ticketUpdates'; }
});
