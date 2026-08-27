// test/api-sources.test.mjs — GET /api/sources, POST /api/sources/call
// (allowlist), /api/run source dispatch, report-result retry. WORCA_MOCK=1:
// connector ops are canned by plugin-shim.mjs (no child spawn) and pipeline
// runs are offline. The fixture plugin is registered via linkPlugin (dev-mode
// symlink) — no git needed here. Tests run in declaration order: the first
// asserts the ZERO-plugin state, the second links the plugin for the rest.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

// Outer isolation that outlives the per-suite before/after (api-workflows
// pattern): /api/run finishes ASYNC in-process, so a late store write must
// land in temp, never in ~.
useTempHome(after);

let homeDir, prevHome, srv, base, pluginDir;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

const MANIFEST = {
  name: 'local-src',
  version: '0.1.0',
  taskSources: [{
    id: 'main',
    displayName: 'Local Source',
    module: './connector/index.mjs',
    configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }],
    inputs: [
      { key: 'repo', type: 'remote-select', label: 'Repo', optionsFrom: 'listRepos' },
      { key: 'task', type: 'task-browser', label: 'Task' },
    ],
  }, {
    // A second, multiProfile source: the profile-required guards on /api/run,
    // /api/sources/call and the config echo all branch on this flag.
    id: 'prof',
    displayName: 'Profiled Source',
    module: './connector/index.mjs',
    multiProfile: true,
    configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }],
    inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
  }],
};
const CONNECTOR = `export default function createTaskSource(ctx) {
  return {
    async validateConfig() { return { ok: true }; },
    async listTasks() { return { tasks: [{ id: 't1', title: 'Fixture task', state: 'open', updatedAt: '2026-07-12T00:00:00Z' }] }; },
    async getTask(id) { return { id, title: 'Fixture task', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'Do the thing.' }; },
    async reportResult() {},
    async listRepos() { return [{ value: 'a/b', label: 'a/b' }]; },
  };
}
`;

async function writeFixturePlugin() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-pluglink-'));
  await writeFile(join(dir, 'worca-cc-plugin.json'), JSON.stringify(MANIFEST, null, 2));
  await mkdir(join(dir, 'connector'), { recursive: true });
  await writeFile(join(dir, 'connector', 'index.mjs'), CONNECTOR);
  return dir;
}

async function waitFor(fn, what, { timeoutMs = 15000, everyMs = 100 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// /api/run fires orch.run() fire-and-forget; a mock run can still be writing
// into <projectDir>/.git when the test's cleanup rm races it -> ENOTEMPTY.
// Bounded retry, same pattern as workspaces-api.test.mjs#rmWithRetry.
async function rmWithRetry(dir, { attempts = 12, stepMs = 25 } = {}) {
  for (let i = 0; ; i++) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      return;
    } catch (err) {
      const code = err?.code || '';
      if ((code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'ENOENT') && i < attempts) {
        await new Promise((r) => setTimeout(r, stepMs));
        continue;
      }
      throw err;
    }
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-srcapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  pluginDir = await writeFixturePlugin();
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  // A fire-and-forget mock run may still be writing into the store when this
  // hook runs — same ENOTEMPTY race rmWithRetry exists for.
  await rmWithRetry(homeDir);
  await rm(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('GET /api/sources lists ONLY prompt+markdown with zero plugins (feature-off bar)', async () => {
  const r = await get('/api/sources');
  assert.equal(r.status, 200);
  const { sources } = await r.json();
  assert.deepEqual(sources.map((s) => s.type), ['prompt', 'markdown']);
});

test('a linked, enabled plugin source appears in GET /api/sources with its inputs', async () => {
  linkPlugin('local-src', pluginDir); // dev-mode current -> pluginDir, lock { linked: true }
  const { sources } = await (await get('/api/sources')).json();
  const plug = sources.find((s) => s.type === 'plugin');
  assert.ok(plug, 'plugin source listed');
  assert.equal(plug.plugin, 'local-src');
  assert.equal(plug.sourceId, 'main');
  assert.equal(plug.displayName, 'Local Source');
  assert.ok(plug.inputs.some((i) => i.type === 'task-browser'), 'declarative pane schema travels');
});

test('POST /api/sources/call: allowlist gates ops; mock listTasks returns the canned frame', async () => {
  // NOT allowlisted: reportResult (write-back only via the pipeline route).
  let r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'main', op: 'reportResult', args: {} });
  assert.equal(r.status, 400);
  // NOT allowlisted: arbitrary op names never reach the connector.
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'main', op: 'unlinkEverything' });
  assert.equal(r.status, 400);
  // Unknown plugin / source -> 404; missing fields -> 400.
  assert.equal((await post('/api/sources/call', { plugin: 'nope', sourceId: 'main', op: 'listTasks' })).status, 404);
  assert.equal((await post('/api/sources/call', { plugin: 'local-src', sourceId: 'bogus', op: 'listTasks' })).status, 404);
  assert.equal((await post('/api/sources/call', { plugin: 'local-src' })).status, 400);
  // Allowlisted interface op; WORCA_MOCK=1 -> canned response, no child spawn.
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'main', op: 'listTasks', args: { inputs: {} } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.result.tasks), 'mock map cans listTasks with a tasks array');
  // Manifest-declared optionsFrom op passes the allowlist (never 400) — the
  // payload is the mock map's business; the gate is what THIS route owns.
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'main', op: 'listRepos' });
  assert.notEqual(r.status, 400, 'optionsFrom op is allowlisted');
});

test('POST /api/run source-shape guards -> 400 with pointed messages', async () => {
  const projectDir = join(tmpdir(), 'worca-cc-never-created'); // guards fire before any mkdir
  let r = await post('/api/run', { projectDir, source: 'x' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /source must be an object/);
  r = await post('/api/run', { projectDir, source: { type: 'plugin', plugin: 'local-src' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /source\.sourceId is required/);
  r = await post('/api/run', { projectDir, source: { type: 'nope' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /unknown source\.type/);
  r = await post('/api/run', {
    projectDir, prompt: 'x',
    source: { type: 'plugin', plugin: 'local-src', sourceId: 'main', taskId: 't1' },
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not both/);
});

test('multiProfile source without a profile is rejected at submit, not mid-run', async () => {
  const projectDir = join(tmpdir(), 'worca-cc-never-created'); // guard fires before any mkdir
  // /api/run: a run against the (empty) default bucket would die mid-pipeline
  // with a confusing connector error — the submit is where the client can fix it.
  let r = await post('/api/run', {
    projectDir, source: { type: 'plugin', plugin: 'local-src', sourceId: 'prof', taskId: 't1' },
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /source\.profile is required/);
  // The single-profile sibling is untouched by the guard (shape-checked only).
  r = await post('/api/run', { projectDir, source: { type: 'plugin', plugin: 'local-src', sourceId: 'main', taskId: 't1', profile: 'NOT-valid!' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not a valid profile id/);
  // /api/sources/call has the same requirement.
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'prof', op: 'listTasks', args: { inputs: {} } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /profile is required/);
  // Config echo: a profile that is not in the roster is a caller error — an
  // empty form for it would let Save quietly create the typo as a profile.
  r = await get('/api/plugins/local-src/config?profile=no-such');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has no profile/);
});

test('POST /api/run with a plugin source stamps pipelines.source_type/source_ref', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-srcrun-'));
  const r = await post('/api/run', {
    projectDir, mock: true,
    source: { type: 'plugin', plugin: 'local-src', sourceId: 'main', taskId: 't1' },
  });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).runId);
  // createPipeline runs early in orch.run() (same process, same db singleton):
  // poll for the row right after creation instead of racing it or depending on
  // the full mock run reaching 'done' (HITL gates may hold a server run open).
  const row = await waitFor(
    () => getDb().prepare("SELECT id, source_type, source_ref FROM pipelines WHERE source_type = 'plugin'").get(),
    'plugin-sourced pipelines row',
  );
  assert.equal(row.source_type, 'plugin');
  const ref = JSON.parse(row.source_ref);
  assert.equal(ref.plugin, 'local-src');
  assert.equal(ref.sourceId, 'main');
  assert.ok(typeof ref.taskId === 'string' && ref.taskId, 'taskId round-trips in source_ref');
  await rmWithRetry(projectDir);
});

test('legacy POST /api/run { prompt } is byte-identical: 200 + runId, default source columns, same 400', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-legacyrun-'));
  const r = await post('/api/run', { projectDir, prompt: 'legacy demo task', mock: true });
  assert.equal(r.status, 200);
  assert.match((await r.json()).runId, /[0-9a-f-]{8,}/);
  const row = await waitFor(
    () => getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE prompt = ?').get('legacy demo task'),
    'legacy pipelines row',
  );
  assert.equal(row.source_type, 'prompt'); // schema default — legacy writes never set it
  assert.equal(row.source_ref, null);
  await rmWithRetry(projectDir);
  // UI Markdown provenance (spec §10): a promptMarkdown-only body stamps 'markdown'.
  const mdProj = await mkdtemp(join(tmpdir(), 'worca-cc-mdrun-'));
  const mdRun = await post('/api/run', { projectDir: mdProj, promptMarkdown: '# md brief task', mock: true });
  assert.equal(mdRun.status, 200);
  const mdRow = await waitFor(
    () => getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE prompt = ?').get('# md brief task'),
    'markdown pipelines row',
  );
  assert.equal(mdRow.source_type, 'markdown');
  assert.equal(mdRow.source_ref, null);
  await rmWithRetry(mdProj);
  // The no-prompt 400 message is the exact legacy string.
  const bad = await post('/api/run', { projectDir: join(tmpdir(), 'worca-cc-never-created') });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'prompt or promptMarkdown is required');
});

test('profiles: "default" is reserved, and a save never mints a profile the roster does not know', async () => {
  const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b) });
  const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });
  // "default" backs every profile-less read (chat channels, model secrets,
  // migrated legacy config) — it must be neither creatable nor deletable.
  let r = await post('/api/plugins/local-src/profiles', { sourceId: 'prof', id: 'default', label: 'Nope' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reserved/);
  r = await del('/api/plugins/local-src/profiles/default?sourceId=prof');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reserved/);
  // A save into a non-roster profile is the GET guard's typo scenario from the
  // write side: 400, and the typo is NOT quietly minted as a real profile.
  r = await put('/api/plugins/local-src/config', { sourceId: 'prof', profile: 'wrok', values: { token: 't' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has no profile "wrok"/);
  let cfg = await (await get('/api/plugins/local-src/config')).json();
  assert.deepEqual(cfg.sources.find((s) => s.id === 'prof').profiles, [], 'roster untouched by the rejected save');
  // The sanctioned path: POST /profiles first, then the save lands.
  r = await post('/api/plugins/local-src/profiles', { sourceId: 'prof', id: 'work', label: 'Work' });
  assert.equal(r.status, 200);
  r = await put('/api/plugins/local-src/config', { sourceId: 'prof', profile: 'work', values: { token: 't' } });
  assert.equal(r.status, 200);
  cfg = await (await get('/api/plugins/local-src/config')).json();
  assert.deepEqual(cfg.sources.find((s) => s.id === 'prof').profiles, [{ id: 'work', label: 'Work' }]);
});

test('a deleted (or stray) profile is rejected at submit on /api/run and /api/sources/call', async () => {
  const projectDir = join(tmpdir(), 'worca-cc-never-created'); // guards fire before any mkdir
  // multiProfile + a profile the roster does not know (deleted in another tab):
  // 400 at submit, not a confusing connector failure mid-pipeline.
  let r = await post('/api/run', {
    projectDir, source: { type: 'plugin', plugin: 'local-src', sourceId: 'prof', taskId: 't1', profile: 'ghost' },
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has no profile "ghost"/);
  // A profile on a single-profile source would read a phantom bucket instead
  // of the real config — rejected, not silently honored.
  r = await post('/api/run', {
    projectDir, source: { type: 'plugin', plugin: 'local-src', sourceId: 'main', taskId: 't1', profile: 'work' },
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /does not use profiles/);
  // Same pair of guards on the pane's data channel.
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'prof', op: 'listTasks', profile: 'ghost', args: { inputs: {} } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has no profile "ghost"/);
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'main', op: 'listTasks', profile: 'work', args: { inputs: {} } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /does not use profiles/);
  // The roster member sails through (mock cans listTasks).
  r = await post('/api/sources/call', { plugin: 'local-src', sourceId: 'prof', op: 'listTasks', profile: 'work', args: { inputs: {} } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('POST /api/pipelines/:id/report-result: 404 unknown id; mock write-back retry -> { ok: true }', async () => {
  assert.equal((await post('/api/pipelines/deadbeef/report-result', {})).status, 404);
  // Seed a TERMINAL plugin-sourced row directly (deterministic — no dependence
  // on live-run timing/gates), then retry: WORCA_MOCK cans reportResult.
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-'));
  const { id } = await seedPipeline(projectDir, { title: 'wb', status: 'done' });
  getDb().prepare('UPDATE pipelines SET source_type = ?, source_ref = ? WHERE id = ?').run(
    'plugin',
    JSON.stringify({ plugin: 'local-src', sourceId: 'main', taskId: 't1', url: null, title: 'Fixture task' }),
    id,
  );
  const r = await post(`/api/pipelines/${id}/report-result`, {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true, 'mock write-back reports ok (Task 13 mock guarantee)');
  await rm(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
