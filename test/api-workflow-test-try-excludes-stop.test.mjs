// test/api-workflow-test-try-excludes-stop.test.mjs — workflow tests 3b (mock browser check, finding 1): a project try that
// pauses and is stopped (the runner's deps.stopRun -> stopPausedPipeline -> stopPausedRun, a harness rebuilt from the saved
// row) keeps Worca's own edits out of its change list, exactly as a try that finishes does: the project's
// .claude/settings.json Worca switched off (D72) and what "Before each try, run" made (D55). Before the fix the rebuilt
// harness had neither list, so a failed try showed Worca's settings edit as its change (diff, scope checks, For developers).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, runs, _testing, artifacts, real, key;
const extra = [];
const GRAPH = {
  version: 2, id: 'wf_pexcl', name: 'Fix a bug', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};
const SETTINGS = `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node -e "1"' }] }] }, permissions: { deny: [] } }, null, 2)}\n`;
const SETUP = 'node -e "const f=require(\'fs\');f.mkdirSync(\'setup-out\',{recursive:true});f.writeFileSync(\'setup-out/z.txt\',\'z\')"';

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpexcl-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  artifacts = await import('../src/core/artifacts.mjs');
  real = templateRepo('wftpexcl', { branch: 'main', user: true, files: { 'README.md': '# hi\n', '.claude/settings.json': SETTINGS } });
  extra.push(real);
  const { insertProject } = await import('../src/core/projects.mjs');
  insertProject({ name: 'tickets', path: real });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${base}/api/workflows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(GRAPH) });
  assert.equal(r.status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('a paused try stopped from its saved row keeps Worca\'s settings edit and the setup\'s output out of its changes', { timeout: 300000 }, async () => {
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  const pin = await pinStart({ key, name: 'tickets', projectDir: real });
  const copyDir = join(homeDir, '.worca-cc', 'workflow-tests', 'repos', key);
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  const body = tryRunBody({ name: 'Ticket 482', request: 'Fix the rounding.' }, [], { workflowId: 'wf_pexcl', tryNo: 1,
    project: { copyDir, startCommit: pin.startCommit } });
  const out = await _testing.invokeStartRun(body, null, { workflowTest: { use: 'draft', project: { key, setupCmd: SETUP },
    // The first agent step writes a file of its own, then the try pauses (as a step error would) before it ends.
    onOrch: (orch) => {
      orch._runners.producer = async (ctx) => {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const dir = orch.workDirs.get(key);
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'work.mjs'), 'export const x = 1;\n');
        queueMicrotask(() => orch.pause());
        return new Promise((_res, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      };
    } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const t0 = Date.now();
  let entry = runs.get(out.body.runId);
  while (!(entry.status === 'paused' && entry.pipelineId && entry.settled)) {
    assert.ok(Date.now() - t0 < 120000, `the try never paused: ${entry.status}`);
    await new Promise((r) => setTimeout(r, 50));
    entry = runs.get(out.body.runId);
  }
  const pipelineId = entry.pipelineId;
  const dir = entry.orch.pipeline.dir;
  // The finished path's own lists, as the live harness had them.
  assert.deepEqual(entry.orch._tryPluginPaths, ['.claude/settings.json']);
  assert.deepEqual(entry.orch._trySetupPaths, ['setup-out']);

  const res = await _testing.stopPausedPipeline(pipelineId, 'worca');   // a harness rebuilt from the saved row
  assert.equal(res.status, 'stopped');
  assert.equal(artifacts.findPipelineRowById(pipelineId).status, 'stopped');
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const paths = [...results.newFiles, ...results.changedFiles].map((f) => f.path);
  assert.ok(paths.includes('src/work.mjs'), `the step's own work is the try's change: ${paths}`);
  assert.ok(!paths.includes('.claude/settings.json'), `Worca's settings edit is not: ${paths}`);
  assert.ok(!paths.some((p) => p.startsWith('setup-out')), `nor what the setup made: ${paths}`);
  const patch = existsSync(join(dir, 'diff-patch.patch')) ? readFileSync(join(dir, 'diff-patch.patch'), 'utf8') : '';
  assert.match(patch, /src\/work\.mjs/);
  assert.doesNotMatch(patch, /\.claude\/settings\.json/);
  assert.doesNotMatch(patch, /setup-out/);
});
