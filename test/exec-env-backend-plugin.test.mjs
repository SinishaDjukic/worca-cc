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
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { DEFAULT_SECRET_PATHS } from '../src/core/secret-paths.mjs';

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

test('the generic guards apply to a second backend: workspace runs are refused at start; every remote engine passes', () => {
  const mk = (o) => createOrchestrator({ projectDir: freshRepo(), prompt: 'x', claude: { mock: true, ...(o.claude || {}) }, execEnv: 'loopback', ...o });
  for (const engine of ['codex', 'copilot', 'cursor']) assert.equal(mk({ claude: { engine } }).execEnvStartRefusal(), null, engine);
  assert.match(mk({ claude: { engine: 'gemini' } }).execEnvStartRefusal(), /^Loopback execution cannot start: Loopback execution runs the claude, codex, copilot and cursor engines only \(this run uses gemini\): Gemini CLI runs locally only for now/);
  assert.match(wsOrch('loopback').execEnvStartRefusal(), /Loopback execution runs single-project runs only/);
  assert.equal(mk({}).execEnvStartRefusal(), null);
});

test('a remote run checks this machine`s CLI only for helper jobs that run on it, and a failure warns instead of refusing', async () => {
  // A nonexistent bin: a check that should not run fails loudly here, and never starts this machine's real CLI.
  const mk = (execEnv, engine = 'codex') => createOrchestrator({ projectDir: freshRepo(), prompt: 'x', execEnv,
    claude: { engine, bin: `/nonexistent/worca-test/${engine}` } });
  await assert.rejects(mk('local')._engineChecks(() => true), /codex/);
  const warnings = async (orch, opts) => {
    const logs = []; orch.on('log', (e) => logs.push(e));
    assert.equal(await orch._engineChecks(() => true, opts), null, 'never refused');
    return logs.filter((l) => l.level === 'warn').map((l) => l.text);
  };
  // Codex and Copilot keep their helper jobs on the run engine (helperEngineFor), and those run this machine's CLI.
  for (const engine of ['codex', 'copilot']) {
    const w = await warnings(mk('loopback', engine));
    assert.equal(w.length, 1, `${engine}: ${JSON.stringify(w)}`);
    assert.match(w[0], new RegExp(`^engine ${engine}: cannot run /nonexistent/worca-test/${engine} \\(ENOENT\\).*`
      + `the title, overview, PR description, Auto classifier and Away decider jobs run on this machine's ${engine}`));
  }
  // The server's early check is quiet: run() checks again and warns then.
  assert.deepEqual(await warnings(mk('loopback'), { quiet: true }), []);
  // Cursor hands its helper jobs to Claude: this machine's cursor-agent is not involved at all.
  assert.deepEqual(await warnings(mk('loopback', 'cursor')), []);
});

test('Cursor`s engine files are not overlaid at sandbox start, and stay out of syncExcludes (a tracked one must sync)', () => {
  const orch = createOrchestrator({ projectDir: freshRepo(), prompt: 'x', claude: { mock: true }, execEnv: 'loopback' });
  const key = orch.members[0].projectKey;
  orch.pipeline = { id: 'abcd1234', dir: tmp('worca-pipe-') };
  orch.injectedPaths = { [key]: [{ path: '.cursor/cli.json', kind: 'engineConfig' }, { path: '.cursor/mcp.json', kind: 'engineConfig' },
    { path: 'CLAUDE.md', kind: 'claudeMdSection' }, { path: '.claude/rules/worca', kind: 'memory' }] };
  const opts = orch._execEnvOpts({}, { name: 'tpl', rebuild: null });
  // Today's value: the sandbox clone's info/exclude line (syncEngineFiles) keeps worca's own files out of the patch; a
  // syncExcludes entry would also drop an agent's edit to a .cursor/mcp.json the project tracks (Step 4's test).
  assert.deepEqual(opts.syncExcludes, ['.claude/rules/worca']);
  // Not overlaid at start: syncEngineFiles is the only thing that puts (and removes) them in the sandbox, so an
  // upload at start never bypasses its record and its exclude lines.
  assert.deepEqual(opts.injected, ['CLAUDE.md', '.claude/rules/worca']);
});

test('the sandbox gets the project`s secretPaths on top of the defaults, and the network its environment resolved', () => {
  const orch = createOrchestrator({ projectDir: freshRepo(), prompt: 'x', claude: { mock: true }, execEnv: 'loopback' });
  const key = orch.members[0].projectKey;
  orch.pipeline = { id: 'abcd1235', dir: tmp('worca-pipe-') };
  assert.deepEqual(orch._execEnvOpts({}, { name: 'tpl', rebuild: null }).secretPaths, [...DEFAULT_SECRET_PATHS]);
  writeProjectSettings({ projectKey: key }, { secretPaths: ['*.tfvars'] });
  const network = { denyOut: ['0.0.0.0/0'] };
  const opts = orch._execEnvOpts({}, { name: 'tpl', rebuild: null, network });
  assert.deepEqual(opts.secretPaths, [...DEFAULT_SECRET_PATHS, '*.tfvars']);
  assert.deepEqual(opts.network, network);
  assert.equal(orch._execEnvOpts({}, { name: null, rebuild: null }).network, null, 'a reconnect target has no network');
});
