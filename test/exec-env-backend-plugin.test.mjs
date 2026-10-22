// test/exec-env-backend-plugin.test.mjs — a second backend plugs in with no harness change (plans/e2b-execution-design.md §17),
// and per-project environments reach a run (§18): fallback order, the stale-build warning, never blocking.
// In-process mock runs on test/helpers/loopback-backend.mjs (no e2b fake): the setup mirrors test/exec-env-pipeline.test.mjs.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { autoChoice } from '../src/core/run-harness.mjs';
import { _resetSlotsForTests } from '../src/core/exec-env/slots.mjs';
import { _registerExecBackendForTests } from '../src/core/exec-env/registry.mjs';
import { updateProjectExecEnv } from '../src/core/config.mjs';
import { setProjectEnvSpec, recordProjectBuild } from '../src/core/exec-env/project-env.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createLoopbackBackend } from './helpers/loopback-backend.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'remote execution is POSIX-only' : false, timeout: 180_000 };
useTempHome(after, 'worca-loopback-plugin-home-');
// Settings live under $HOME/.worca-cc: never the developer's real file.
const userHome = mkdtempSync(join(tmpdir(), 'worca-loopback-plugin-user-'));
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const realGitConfig = join(process.env.HOME || '', '.gitconfig');
before(() => {
  if (!process.env.GIT_CONFIG_GLOBAL && existsSync(realGitConfig)) process.env.GIT_CONFIG_GLOBAL = realGitConfig;
  process.env.HOME = userHome; process.env.USERPROFILE = userHome;
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(userHome, { recursive: true, force: true });
});
const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };

function freshRepo() {
  const dir = templateRepo('loopback-plugin-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  scratch.push(dir);
  return dir;
}
const rowOf = (id) => getDb().prepare('SELECT id, status, outcome, branch, resume_point FROM pipelines WHERE id = ?').get(id);
/** Answer every ask one tick after it opens (_ask installs pendingQuestion after emitting). */
function answerAll(orch) {
  orch.on('question', (q) => setImmediate(() => {
    const payload = q.kind === 'gate' ? { decision: 'continue' }
      : { answers: (q.questions || []).map((x) => ({ id: x.id, choice: autoChoice(x) })) };
    orch.answer(q.id, payload);
  }));
}

const lb = createLoopbackBackend({ root: tmp('worca-loopback-root-') });
const unregister = _registerExecBackendForTests(lb.backend); after(unregister);

async function runOn(repo, extra = {}) {
  _resetSlotsForTests();
  const logs = [];
  const orch = createOrchestrator({ projectDir: repo, prompt: 'loopback task', claude: { mock: true }, execEnv: 'loopback', ...extra });
  orch.on('log', (e) => logs.push(e));
  answerAll(orch);
  const r = await orch.run();
  return { r, orch, logs, row: rowOf(orch.state.id) };
}
/** The workspace orchestrator of test/exec-env-pipeline.test.mjs's preflight test, on another backend. */
const wsOrch = (execEnv) => createOrchestrator({ prompt: 'x', claude: { mock: true }, execEnv,
  workspace: { id: 'wks-a-12345678', key: 'wks-a-12345678', name: 'A', projects: [
    { projectDir: freshRepo(), projectKey: 'r1', projectName: 'r1', branch: { source: 'main' } },
    { projectDir: freshRepo(), projectKey: 'r2', projectName: 'r2', branch: { source: 'main' } }] } });

test('a loopback run: one box, code home, outcome and log channel name the backend, nothing left behind', POSIX, async () => {
  const from = lb.events.length;
  const repo = freshRepo();
  const { r, logs, row } = await runOn(repo);
  assert.equal(r.status, 'done', r.error);
  const ev = lb.events.slice(from);
  assert.equal(ev.filter((e) => e.type === 'create').length, 1);
  assert.equal(ev.find((e) => e.type === 'create').environment, 'loopback-base');
  assert.equal(ev.filter((e) => e.type === 'remove').length, 1);
  assert.equal(JSON.parse(row.outcome).execEnv, 'loopback');
  assert.ok(logs.some((l) => l.source === 'loopback' && /agents and scripts run in Loopback box lb\d+ \(image loopback-base from the default, loopback\)/.test(l.text)));
  assert.equal(existsSync(join(worcaHome(), 'tmp', 'loopback', row.id)), false);
  // the mock implementer wrote src/feature.mjs INSIDE the box; it reached the local branch commit
  assert.match(execFileSync('git', ['-C', repo, 'show', `${JSON.parse(row.branch).feature}:src/feature.mjs`], { encoding: 'utf8' }), /\S/);
});

test('fallback order: project setting beats the build record, which beats the default', POSIX, async () => {
  const repo = freshRepo(); const key = projectKey(repo);
  const spec = setProjectEnvSpec(key, { tools: [{ name: 'node', version: '24.21.0' }] });
  recordProjectBuild(key, 'loopback', { name: `loopback-${key}`, id: 't', buildId: 'b', specHash: spec.hash, baseVersion: 'loopback-base@1' });
  let from = lb.events.length;
  await runOn(repo);
  assert.equal(lb.events.slice(from).find((e) => e.type === 'create').environment, `loopback-${key}`);
  updateProjectExecEnv(key, (v) => { v.config.loopback = { image: 'pinned-image' }; });
  from = lb.events.length;
  await runOn(repo);
  assert.equal(lb.events.slice(from).find((e) => e.type === 'create').environment, 'pinned-image');
});

test('a stale build warns and still runs on the recorded image; nothing is rebuilt', POSIX, async () => {
  const repo = freshRepo(); const key = projectKey(repo);
  const spec = setProjectEnvSpec(key, { tools: [{ name: 'node', version: '24.21.0' }] });
  recordProjectBuild(key, 'loopback', { name: `loopback-${key}`, id: 't', buildId: 'b', specHash: spec.hash, baseVersion: 'loopback-base@1' });
  setProjectEnvSpec(key, { tools: [{ name: 'node', version: '24.22.0' }] });   // spec changed after the build
  lb.setBase('loopback-base@2');                                                // and the base moved
  const from = lb.events.length;
  const { r, logs } = await runOn(repo);
  lb.setBase('loopback-base@1');
  assert.equal(r.status, 'done', r.error);
  assert.equal(lb.events.slice(from).find((e) => e.type === 'create').environment, `loopback-${key}`);
  assert.equal(lb.events.slice(from).some((e) => e.type === 'build'), false, 'never rebuilt by a run');
  const warn = logs.find((l) => l.source === 'loopback' && l.level === 'warn' && /is stale/.test(l.text));
  assert.ok(warn, JSON.stringify(logs.filter((l) => l.source === 'loopback')));
  assert.match(warn.text, /spec changed/); assert.match(warn.text, /base changed \(loopback-base@1 → loopback-base@2\)/);
});

test('a lost box fails the run cleanly through the generic classifyError', POSIX, async () => {
  _resetSlotsForTests();
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: 'wf_default', prompt: 'loss on loopback', auto: true,
    claude: { mock: true }, execEnv: 'loopback' });
  let removed = false;
  orch.on('state', (st) => {
    if (!removed && orch.execEnv && (st.steps || []).some((s) => s.status === 'done')) {
      removed = true;
      void lb.client.remove(orch.execEnv.sandboxId);   // the next box call raises LoopbackGoneError -> 'gone'
    }
  });
  const r = await orch.run();
  assert.equal(r.status, 'error');
  assert.match(r.error, /Loopback box lb\d+ is gone/);
});

test('the generic guards apply to a second backend: workspace runs and other engines are refused at start', () => {
  // mirrors exec-env-pipeline.test.mjs's preflight test (the e2b version); the loopback preflight itself returns no errors
  const mk = (o) => createOrchestrator({ projectDir: freshRepo(), prompt: 'x', claude: { mock: true, ...(o.claude || {}) }, execEnv: 'loopback', ...o });
  assert.match(mk({ claude: { engine: 'codex' } }).execEnvStartRefusal(), /^Loopback execution cannot start: Loopback execution runs the claude engine only \(this run uses codex\): Codex runs locally only for now/);
  assert.match(wsOrch('loopback').execEnvStartRefusal(), /Loopback execution runs single-project runs only/);
  assert.equal(mk({}).execEnvStartRefusal(), null);
});
