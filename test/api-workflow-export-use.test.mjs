// test/api-workflow-export-use.test.mjs — D17 over HTTP: GET /api/workflows/:id/json?use= and POST .../export
// { use } export the draft (missing or 'draft') or a saved version (a positive integer). No flag gate: the flag is
// off here and the version is saved through the core, as an explicit version number needs no flag.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);
let homeDir, srv, base, prevHome;
const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-use-api-')); dirs.push(d); return d; };
const JSONH = { 'Content-Type': 'application/json' };
const ID = 'wf_api_use';
const graphBody = (name) => ({
  version: 2, id: ID, name, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body || {}) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfexpuse-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_FLAGS;
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await post('/api/workflows', graphBody('Export API'))).status, 201);
  const { createVersion } = await import('../src/core/workflow-versions.mjs');
  assert.equal((await createVersion(ID, { note: 'First' })).versionNo, 1);
  assert.equal((await post('/api/workflows', graphBody('Export API draft'))).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('GET …/json: ?use=1 is version 1, ?use=draft and no use the draft; the filename is the id\'s either way', async () => {
  await checkRows([
    ['?use=1', 'Export API'], ['?use=draft', 'Export API draft'], ['', 'Export API draft'],
  ].map(([q, name]) => ({ name: q || '(no use)', run: async () => {
    const r = await fetch(`${base}/api/workflows/${ID}/json${q}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') || '', /filename="api_use\.json"/);
    const j = await r.json();
    assert.equal(j.name, name);
    assert.equal('versionNo' in j, false);
  } })));
});

test('GET …/json: 400 for any other use (live, 0, abc, 1.5, empty), 404 for a version that does not exist', async () => {
  await checkRows(['live', '0', 'abc', '1.5', '', '-1', '01'].map((u) => ({ name: `?use=${u}`, run: async () => {
    const r = await fetch(`${base}/api/workflows/${ID}/json?use=${encodeURIComponent(u)}`);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /use/);
  } })));
  const r = await fetch(`${base}/api/workflows/${ID}/json?use=9`);
  assert.equal(r.status, 404);
  assert.ok((await r.json()).error);
});

test('POST …/export { use }: the skill dry run builds from that version; a written plugin carries its graph', async () => {
  const skillDir = (plan) => [...plan.created, ...plan.updated, ...plan.noop].map((p) => p.split(sep).join('/'))
    .map((p) => (p.match(/\/skills\/([^/]+)\/SKILL\.md$/) || [])[1]).find(Boolean);
  const plan = async (extra) => {
    const r = await post(`/api/workflows/${ID}/export`, { destination: 'project', projectDir: await tmp(), dryRun: true, ...extra });
    assert.equal(r.status, 200);
    return r.json();
  };
  // Version 1 is "Export API", the draft "Export API draft": the skill is the workflow's, so every use gives the same
  // default slug (the dialog previews it from the workflow's name) and exporting v1 updates that one skill.
  assert.equal(skillDir(await plan({ use: 1 })), 'export-api-draft');
  assert.equal(skillDir(await plan({ use: 'draft' })), 'export-api-draft');
  assert.equal(skillDir(await plan({})), 'export-api-draft');
  assert.equal(skillDir(await plan({ use: 1, slug: 'typed' })), 'typed');

  const pluginDir = join(await tmp(), 'use-plugin');
  const r = await post(`/api/workflows/${ID}/export`, { destination: 'plugin', pluginDir, use: 1 });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const written = JSON.parse(await readFile(join(pluginDir, 'workflows', 'api_use.json'), 'utf8'));
  assert.equal(written.name, 'Export API', 'the content is version 1\'s');
});

test('POST …/export: 400 for a bad use on every destination, before anything else runs; 404 for an unknown version', async () => {
  const dir = await tmp();
  const bodies = {
    global: { destination: 'global' },
    project: { destination: 'project', projectDir: dir },
    plugin: { destination: 'plugin', pluginDir: join(dir, 'p') },
    marketplace: { destination: 'marketplace', marketplaceId: 'acme' },
  };
  const rows = [];
  for (const [dest, body] of Object.entries(bodies)) {
    for (const use of ['live', 0, 'abc', 1.5, '1', null, true]) {
      rows.push({ name: `${dest} use=${JSON.stringify(use)}`, run: async () => {
        const r = await post(`/api/workflows/${ID}/export`, { ...body, dryRun: true, use });
        assert.equal(r.status, 400);
        assert.match((await r.json()).error, /use must be/);
      } });
    }
  }
  await checkRows(rows);
  const r = await post(`/api/workflows/${ID}/export`, { destination: 'project', projectDir: dir, dryRun: true, use: 9 });
  assert.equal(r.status, 404);
});
