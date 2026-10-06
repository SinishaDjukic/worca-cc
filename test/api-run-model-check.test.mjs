// test/api-run-model-check.test.mjs
// Pre-run model check over HTTP (src/core/model-check.mjs): GET /api/run/model-check (the New
// pipeline card's warning, local checks only) and the instant 409 from POST /api/run — also for
// a scheduled ticket firing through startRunHandler. Sandboxes HOME/WORCA_HOME, turns server mock
// off, and answers `claude auth status` from CLAUDE_CODE_OAUTH_TOKEN so nothing spawns a real claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { addGlobalModel, updateProvider } from '../src/core/settings.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);   // WORCA_HOME for the whole file, also for late scheduler writes
const ENV_KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'ORCH_MOCK', 'CLAUDE_CODE_OAUTH_TOKEN'];
const prevEnv = {};
let srv, base, homeDir, projectDir, key, testing;
const jfetch = async (path, opts) => {
  const r = await fetch(`${base}${path}`, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-runmc-home-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME sandboxed above
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test'; // claudeAuthFromEnv: signed in, no spawn
  _resetForTests();
  projectDir = gitDir('runmc');
  await addProject({ name: 'runmc', path: projectDir });
  key = projectKey(projectDir);
  await addGlobalModel({ id: 'gw-gpt', label: 'Gateway GPT', efforts: ['medium'], upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x', baseUrl: 'https://api.openai.com/v1' } });
  await setNodeModel(projectDir, 'wf_default', 'n_impl', { model: 'gw-gpt' });
  const mod = await import('../ui/server.mjs'); // imported => does not bind a port
  testing = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all([homeDir, projectDir].map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

// Row order matters: the key-set row must be LAST. If a refusal row failed to refuse, its run would
// start for real, spawn `claude` and trip the no-real-claude shim — a loud failure, as intended.
test('the pre-run model check over HTTP: endpoint, 409 at start, scheduled refusal', async () => {
  await checkRows([
    { name: 'GET /api/run/model-check names the node, model, reason and fix', run: async () => {
      const { status, body } = await jfetch(`/api/run/model-check?scope=project:${key}&workflowId=wf_default`);
      assert.equal(status, 200);
      assert.equal(body.ok, false);
      const p = body.problems.find((x) => x.model === 'gw-gpt');
      assert.ok(p, JSON.stringify(body));
      assert.equal(p.reason, 'no_key');
      assert.ok(p.nodes.length === 1 && /implement/i.test(p.nodes[0]), JSON.stringify(p.nodes));
      assert.match(p.fix, /Settings › Providers/);
    } },
    { name: 'GET … for wf_auto is skipped (no graph before the decision)', run: async () => {
      const { body } = await jfetch(`/api/run/model-check?scope=project:${key}&workflowId=wf_auto`);
      assert.deepEqual([body.ok, body.skipped], [true, 'auto']);
    } },
    { name: 'GET … with a bad scope is a 400', run: async () => {
      assert.equal((await jfetch('/api/run/model-check?scope=nope')).status, 400);
    } },
    { name: 'POST /api/run refuses up front with 409 model-unavailable — no run is created', run: async () => {
      const { status, body } = await jfetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectDir, prompt: 'demo', workflowId: 'wf_default' }) });
      assert.equal(status, 409);
      assert.equal(body.code, 'model-unavailable');
      assert.match(body.error, /^Preflight failed: .*"gw-gpt" \(openai\)/s);
      assert.ok(Array.isArray(body.problems) && body.problems.length >= 1);
    } },
    { name: 'a firing ticket hits the same refusal: not transient, so the scheduler fails it "could not start"', run: async () => {
      // Mirrors test/workspaces-api.test.mjs:556-558. fireTicket → invokeStartRun → startRunHandler
      // with _internal (sched === null), so the check runs.
      const { createTicket, getTicket } = await import('../src/core/scheduler.mjs');
      const t = createTicket({ projectDir, runAtMs: Date.now(), request: { projectDir, prompt: 'demo', workflowId: 'wf_default' } });
      const out = await testing.fireTicket(getTicket(t.id, { withRequest: true }));
      assert.equal(out.ok, false);
      assert.equal(out.transient, false);   // a 409 (< 500): scheduler.mjs marks it failed
      assert.match(out.error, /"gw-gpt" \(openai\)/);
    } },
    { name: 'GET … answers ok once the key is set (no network: the GET never probes)', run: async () => {
      await updateProvider('openai', { apiKey: 'sk-x' });
      const { body } = await jfetch(`/api/run/model-check?scope=project:${key}&workflowId=wf_default`);
      assert.equal(body.ok, true, JSON.stringify(body));
    } },
  ]);
});
