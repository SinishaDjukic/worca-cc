// test/exec-env-pipeline.test.mjs
// The harness lifecycle of the e2b execution environment (plans/e2b-execution-design.md §5, §8–§10), in mock mode
// on the loopback fake: one sandbox per run, step outputs and code synced home, asks park the sandbox, pause parks
// and resume reconnects, a lost sandbox fails the run cleanly, the capacity queue, and local mode unchanged.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { autoChoice } from '../src/core/run-harness.mjs';
import { markTerminal } from '../src/core/failure-policy.mjs';
import { mockSpawnLog, runClaude } from '../src/core/claude-runner.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { _setE2bForTests } from '../src/core/exec-env/e2b-sdk.mjs';
import { recordProjectBuild } from '../src/core/exec-env/project-env.mjs';
import { projectKey } from '../src/core/store.mjs';
import { acquireSandboxSlot, _resetSlotsForTests } from '../src/core/exec-env/slots.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';
import http from 'node:http';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 180_000 };
const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after, 'worca-e2b-pipeline-home-');
// Settings live under $HOME/.worca-cc: never the developer's real file.
const userHome = mkdtempSync(join(tmpdir(), 'worca-e2b-pipeline-user-'));
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const realGitConfig = join(process.env.HOME || '', '.gitconfig');
before(() => {
  if (!process.env.GIT_CONFIG_GLOBAL && existsSync(realGitConfig)) process.env.GIT_CONFIG_GLOBAL = realGitConfig;
  process.env.HOME = userHome; process.env.USERPROFILE = userHome;
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  _setE2bForTests(null);
  rmSync(userHome, { recursive: true, force: true });
});
const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };

function freshRepo() {
  const dir = templateRepo('e2b-pipeline-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  scratch.push(dir);
  return dir;
}
const rowOf = (id) => getDb().prepare('SELECT id, status, outcome, branch, resume_point FROM pipelines WHERE id = ?').get(id);
const newestRow = () => getDb().prepare('SELECT id, status, outcome, branch, resume_point FROM pipelines ORDER BY started_at DESC, rowid DESC LIMIT 1').get();
const fakeEvents = () => {
  const f = join(worcaHome(), 'tmp', 'e2b-fake', 'events.ndjson');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
/** A fresh loopback fake for one in-process run. */
function useFake() {
  const fake = createFakeE2b({ root: tmp('worca-e2b-fake-') });
  _setE2bForTests(fake);
  _resetSlotsForTests();
  return fake;
}
const ofType = (fake, type) => fake.events.filter((e) => e.type === type);
/** Answer every ask one tick after it opens (_ask installs pendingQuestion after emitting). */
function answerAll(orch) {
  orch.on('question', (q) => setImmediate(() => {
    const payload = q.kind === 'gate' ? { decision: 'continue' }
      : { answers: (q.questions || []).map((x) => ({ id: x.id, choice: autoChoice(x) })) };
    orch.answer(q.id, payload);
  }));
}
const waitFor = (orch, pred) => new Promise((res) => { const h = (st) => { if (pred(st)) { orch.off('state', h); res(st); } }; orch.on('state', h); });
let askWorkflow = null;
async function askingWorkflow() {
  if (askWorkflow) return askWorkflow;
  const d = GRAPH_DEFAULT_WORKFLOW;
  await writeGraphWorkflow({ id: 'wf_e2b_ask', name: 'E2B ask', domain: d.domain,
    nodes: d.nodes.map((n) => (n.id === 'n_impl' ? { ...n, config: { ...n.config, askQuestions: true } } : n)), wires: d.wires });
  askWorkflow = 'wf_e2b_ask';
  return askWorkflow;
}

test('CLI end to end: one sandbox per run, the agents\' code reaches the local branch, outcome records e2b', POSIX, () => {
  const repo = freshRepo();
  const r = spawnSync(process.execPath, [CLI, '--project', repo, '--prompt', 'demo task', '--yes', '--exec-env', 'e2b'],
    { env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', HOME: userHome, USERPROFILE: userHome }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const row = newestRow();
  assert.equal(row.status, 'done');
  assert.equal(JSON.parse(row.outcome).execEnv, 'e2b');
  const ev = fakeEvents();
  assert.equal(ev.filter((e) => e.type === 'create').length, 1, 'one sandbox per run');
  assert.equal(ev.find((e) => e.type === 'create').metadata.worcaRunId, row.id);
  assert.equal(ev.filter((e) => e.type === 'kill').length, 1, 'killed at teardown');
  assert.ok(!existsSync(join(worcaHome(), 'tmp', 'e2b-fake', ev[0].sandboxId)), 'no sandbox dir left');
  assert.ok(!existsSync(join(worcaHome(), 'tmp', 'e2b', row.id)), 'no scratch dir left');
  // the mock implementer wrote src/feature.mjs INSIDE the sandbox; it reached the local branch commit
  const branch = JSON.parse(row.branch).feature;
  assert.match(execFileSync('git', ['-C', repo, 'show', `${branch}:src/feature.mjs`], { encoding: 'utf8' }), /\S/);
});

test('a sandbox run commits on the host with hooks off: the repo\'s own pre-commit hook never runs', POSIX, async () => {
  useFake();
  const repo = freshRepo();
  const marker = join(tmp('worca-e2b-hook-'), 'ran');
  writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marker}"\n`); chmodSync(join(repo, '.git', 'hooks', 'pre-commit'), 0o755);
  const orch = createOrchestrator({ projectDir: repo, workflowId: 'wf_default', prompt: 'hooks in e2b', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  const r = await orch.run();
  assert.equal(r.status, 'done', r.error);
  const branch = JSON.parse(rowOf(orch.getState().id).branch).feature;
  assert.match(execFileSync('git', ['-C', repo, 'show', `${branch}:src/feature.mjs`], { encoding: 'utf8' }), /\S/, 'the work is committed');
  assert.equal(existsSync(marker), false, 'the pre-commit hook did not run');
});

test('local mode is unchanged: no outcome key, no sandbox, no resume-point key', POSIX, () => {
  rmSync(join(worcaHome(), 'tmp', 'e2b-fake'), { recursive: true, force: true });
  const repo = freshRepo();
  const r = spawnSync(process.execPath, [CLI, '--project', repo, '--prompt', 'demo task', '--yes'],
    { env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', HOME: userHome, USERPROFILE: userHome }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const row = newestRow();
  assert.equal(row.status, 'done');
  assert.equal(JSON.parse(row.outcome).execEnv, undefined);
  assert.equal(existsSync(join(worcaHome(), 'tmp', 'e2b-fake', 'events.ndjson')), false);
  if (row.resume_point) assert.equal(Object.hasOwn(JSON.parse(row.resume_point), 'execEnv'), false);
});

test('CLI: an e2b run the remote layer cannot take is refused before anything is created (non-zero exit)', POSIX, () => {
  const repo = freshRepo();
  const before = getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n;
  // WORCA_MOCK alone leaves claude.mock off, so the gate checks the helper jobs' codex on this machine: never the real one.
  // Permissive guardrails: codex cannot enforce the default set's rules, and that refusal would come first.
  const r = spawnSync(process.execPath, [CLI, '--project', repo, '--prompt', 'demo task', '--yes', '--engine', 'codex', '--exec-env', 'e2b',
    '--guardrails', 'permissive'],
    { env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', WORCA_RUN_ROOT: 'legacy', HOME: userHome, USERPROFILE: userHome,
      WORCA_CODEX_BIN: '/nonexistent/worca-test/codex' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stdout + r.stderr, /detached run-root mode/);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n, before, 'a launch error: no pipeline row');
});

test('questions resume the same session in the same sandbox; an idle ask parks it, the answer unparks it', POSIX, async () => {
  const fake = useFake();
  const from = mockSpawnLog.length;
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: await askingWorkflow(), prompt: 'questions in e2b',
    claude: { mock: true }, execEnv: 'e2b' });
  const parkedAt = [];
  orch.on('question', () => setImmediate(() => parkedAt.push(ofType(fake, 'setTimeout').length)));
  answerAll(orch);
  const r = await orch.run();
  assert.equal(r.status, 'done', r.error);
  const sandboxId = ofType(fake, 'create')[0].sandboxId;
  const spawns = mockSpawnLog.slice(from).filter((s) => s.execEnv === sandboxId);
  assert.ok(spawns.length >= 2, JSON.stringify(spawns));
  assert.ok(spawns.some((s) => s.resume === 'mock-session-implementer-c1'), 'the answered implementer resumed its session');
  assert.equal(ofType(fake, 'create').length, 1);
  const ms = ofType(fake, 'setTimeout').map((e) => e.ms);
  assert.ok(ms.includes(240 * 60_000), `parked at e2bMaxWaitMin: ${ms}`);
  const firstPark = ms.indexOf(240 * 60_000);
  assert.ok(ms.slice(firstPark).includes(30 * 60_000), 'unparked after the answer');
});

test('a stop ends the run stopped and kills the sandbox', POSIX, async () => {
  const fake = useFake();
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: 'wf_default', prompt: 'stop in e2b', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  let stopped = false;
  orch.on('state', (st) => {
    if (!stopped && orch.execEnv && (st.steps || []).some((s) => s.status === 'done')) { stopped = true; orch.stop(); }
  });
  const r = await orch.run();
  assert.equal(r.status, 'stopped');
  assert.equal(ofType(fake, 'kill').length, 1);
  assert.equal(fake.live.size, 0);
});

test('a lost sandbox fails the run cleanly: no retry, no recovery, no pause; earlier outputs stay', POSIX, async () => {
  const fake = useFake();
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: 'wf_default', prompt: 'loss in e2b', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  let recovered = 0;
  const recover = orch._recover.bind(orch);
  orch._recover = (...a) => { recovered += 1; return recover(...a); };
  let killed = false; let firstOutputs = [];
  orch.on('state', (st) => {
    const done = (st.steps || []).filter((s) => s.status === 'done');
    if (!killed && orch.execEnv && done.length) {
      killed = true;
      firstOutputs = readdirSync(orch.pipeline.dir);
      fake.Sandbox.kill(orch.execEnv.sandboxId);
    }
  });
  const r = await orch.run();
  assert.equal(r.status, 'error');
  assert.match(r.error, /E2B sandbox .* is gone/);
  assert.equal(recovered, 0, 'no recovery prompt or retry');
  assert.ok(firstOutputs.length > 0);
  for (const f of firstOutputs) assert.ok(existsSync(join(orch.pipeline.dir, f)), f);
});

test('max wait: an unanswered ask releases the sandbox and PAUSES the run; resume continues in a fresh sandbox', POSIX, async () => {
  const fake = useFake();
  const repo = freshRepo();
  const orch = createOrchestrator({ projectDir: repo, workflowId: await askingWorkflow(), prompt: 'max wait in e2b',
    claude: { mock: true }, execEnv: 'e2b' });
  orch._execEnvMaxWaitMs = () => 50;
  const r = await orch.run();
  assert.equal(r.status, 'paused', r.error);
  const st = orch.getState();
  assert.equal(st.pauseReason, 'error');
  assert.match(st.pauseDetail, /No answer within 0 min: the run's E2B sandbox was released .*Resume continues in a fresh E2B sandbox/);
  assert.equal(orch.pendingQuestion, null);
  const first = ofType(fake, 'create')[0].sandboxId;
  assert.ok(ofType(fake, 'kill').some((e) => e.sandboxId === first), 'the parked sandbox was released');
  const saved = readPipelineForResume(st.id);
  assert.deepEqual(saved.resumePoint.execEnv, { kind: 'e2b' }, 'the resume point names no sandbox to reconnect to');
  const orch2 = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(ofType(fake, 'create').length, 2, 'the resume created a fresh sandbox');
});

test('a scheduler question that fails keeps its real error for the run, not "a graph execution failed"; a stop stays a stop', POSIX, async () => {
  const orch = createOrchestrator({ projectDir: freshRepo(), prompt: 'ask error', claude: { mock: true } });
  let aborted = 0;
  orch._scheduler = { abort: () => { aborted += 1; }, pause: () => {} };
  orch._enqueueAsk = () => Promise.reject(new Error('Away mode could not answer gate g1 in an unattended run'));
  orch._schedulerAsk({ kind: 'gate', id: 'g1' });
  await new Promise((res) => setImmediate(res));
  assert.equal(aborted, 1);
  assert.match(orch._graphError?.message || '', /Away mode could not answer gate g1/);
  const stopped = createOrchestrator({ projectDir: freshRepo(), prompt: 'ask stop', claude: { mock: true } });
  stopped._scheduler = { abort: () => {}, pause: () => {} };
  stopped._enqueueAsk = () => Promise.reject(Object.assign(new Error('stopped'), { name: 'AbortError' }));
  stopped._schedulerAsk({ kind: 'gate', id: 'g2' });
  await new Promise((res) => setImmediate(res));
  assert.equal(stopped._graphError, null, 'a stop keeps the existing stop path');
});

test('a waiting question publishes when its parked sandbox will be released, and clears it once answered', POSIX, async () => {
  useFake();
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: await askingWorkflow(), prompt: 'deadline in e2b',
    claude: { mock: true }, execEnv: 'e2b' });
  const seen = [];
  orch.on('question', (q) => {
    waitFor(orch, (st) => !!st.execEnvWaitUntil).then((st) => {
      seen.push(Date.parse(st.execEnvWaitUntil) - Date.now());
      orch.answer(q.id, { answers: (q.questions || []).map((x) => ({ id: x.id, choice: autoChoice(x) })) });
    });
  });
  const r = await orch.run();
  assert.equal(r.status, 'done', r.error);
  assert.ok(seen.length >= 1, 'the deadline was published while the question waited');
  assert.ok(seen.every((ms) => ms > 239 * 60_000 && ms <= 240 * 60_000 + 1000), `about 240 min ahead: ${seen}`);
  assert.equal(Object.hasOwn(orch.getState(), 'execEnvWaitUntil'), false, 'cleared once nothing waits');
});

/** e2bMaxSandboxes: 1 in the temp user settings (settings tests must opt in to the home fallback). */
function withCap1(fn) {
  const prev = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  mkdirSync(join(userHome, '.worca-cc'), { recursive: true });
  writeFileSync(join(userHome, '.worca-cc', 'settings.json'), JSON.stringify({ e2bMaxSandboxes: 1 }));
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prev;
    rmSync(join(userHome, '.worca-cc', 'settings.json'), { force: true });
  });
}

test('capacity queue: the run waits for a slot with execEnvWaiting, then runs; a stop while queued creates nothing', POSIX, () => withCap1(async () => {
  let fake = useFake();
  let hold = await acquireSandboxSlot({ cap: 1 });
  let orch = createOrchestrator({ projectDir: freshRepo(), workflowId: 'wf_default', prompt: 'queued in e2b', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  const waiting = waitFor(orch, (st) => st.execEnvWaiting === true);
  let run = orch.run();
  await waiting;
  assert.equal(ofType(fake, 'create').length, 0);
  hold();
  let r = await run;
  assert.equal(r.status, 'done', r.error);
  assert.equal(orch.getState().execEnvWaiting, undefined);
  assert.equal(ofType(fake, 'create').length, 1);

  fake = useFake();
  hold = await acquireSandboxSlot({ cap: 1 });
  orch = createOrchestrator({ projectDir: freshRepo(), workflowId: 'wf_default', prompt: 'stopped in queue', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  const waiting2 = waitFor(orch, (st) => st.execEnvWaiting === true);
  run = orch.run();
  await waiting2;
  orch.stop();
  r = await run;
  hold();
  assert.equal(r.status, 'stopped');
  assert.equal(ofType(fake, 'create').length, 0);
  assert.equal(orch.getState().execEnvWaiting, undefined);
}));

test('preflight refusals: a workspace run, the legacy run-root mode; a plain mock project run passes', POSIX, async () => {
  const repo = freshRepo();
  const mk = (o) => createOrchestrator({ projectDir: repo, prompt: 'x', claude: { mock: true, ...(o.claude || {}) }, execEnv: 'e2b', ...o });
  assert.equal(mk({ claude: { mock: true, engine: 'codex' } }).execEnvStartRefusal(), null);
  const ws = createOrchestrator({ prompt: 'x', claude: { mock: true }, execEnv: 'e2b',
    workspace: { id: 'wks-a-12345678', key: 'wks-a-12345678', name: 'A', projects: [
      { projectDir: repo, projectKey: 'r1', projectName: 'r1', branch: { source: 'main' } },
      { projectDir: freshRepo(), projectKey: 'r2', projectName: 'r2', branch: { source: 'main' } }] } });
  assert.match(ws.execEnvStartRefusal(), /single-project/);
  const prev = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'legacy';
  try { assert.match(mk({}).execEnvStartRefusal(), /detached run-root mode/); }
  finally { if (prev === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prev; }
  assert.equal(mk({}).execEnvStartRefusal(), null);
  assert.equal(createOrchestrator({ projectDir: repo, prompt: 'x', claude: { mock: true } }).execEnvStartRefusal(), null, 'local');
});

/** Start an e2b run and pause it once the sandbox exists and a step finished; resolves the paused run's id. */
async function pausedRun(fake, repo, { beforePause = () => {} } = {}) {
  const orch = createOrchestrator({ projectDir: repo, workflowId: 'wf_default', prompt: 'pause in e2b', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  let paused = false;
  orch.on('state', (st) => {
    if (!paused && orch.execEnv && (st.steps || []).some((s) => s.status === 'done')) { paused = true; beforePause(orch); orch.pause(); }
  });
  const r = await orch.run();
  assert.equal(r.status, 'paused', r.error);
  return orch.getState().id;
}

test('pause parks the sandbox; resume reconnects to it and finishes with one sandbox', POSIX, async () => {
  const fake = useFake();
  const repo = freshRepo();
  const id = await pausedRun(fake, repo);
  const saved = readPipelineForResume(id);
  assert.equal(saved.resumePoint.execEnv.kind, 'e2b');
  assert.equal(saved.resumePoint.execEnv.sandboxId, ofType(fake, 'create')[0].sandboxId);
  assert.ok(ofType(fake, 'setTimeout').some((e) => e.ms === 240 * 60_000), 'parked at max wait');
  assert.equal(fake.live.size, 1, 'the paused run keeps its sandbox');
  const orch2 = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved });
  const r = await orch2.resume();
  assert.equal(r.status, 'done', r.error);
  assert.ok(ofType(fake, 'connect').some((e) => e.sandboxId === saved.resumePoint.execEnv.sandboxId));
  assert.equal(ofType(fake, 'create').length, 1);
  assert.equal(fake.live.size, 0);
  assert.equal(JSON.parse(rowOf(id).outcome).execEnv, 'e2b');
});

test('resume after the project environment was built while paused replaces the sandbox with one from the new template; a rebuild does too', POSIX, async () => {
  const fake = useFake();
  const repo = freshRepo(); const key = projectKey(repo);
  const id = await pausedRun(fake, repo);
  const saved = readPipelineForResume(id);
  const first = ofType(fake, 'create')[0];
  assert.equal(first.template, 'worca-agent');
  assert.equal(saved.resumePoint.execEnv.environment, 'worca-agent', 'the resume point names the template');
  // The project's environment is built while the run waits.
  const name = `worca-agent-${key}`;
  recordProjectBuild(key, 'e2b', { name, id: 'tpl1', buildId: 'b1', specHash: 'h', baseVersion: 'v' });
  const orch2 = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved });
  const r = await orch2.resume();
  assert.equal(r.status, 'done', r.error);
  const creates = ofType(fake, 'create');
  assert.equal(creates.length, 2, 'a fresh sandbox');
  assert.equal(creates[1].template, name, 'from the new template');
  assert.ok(ofType(fake, 'kill').some((e) => e.sandboxId === first.sandboxId), 'the old sandbox was killed');
  assert.equal(fake.live.size, 0);
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id).map((e) => e.text).join('\n');
  assert.match(audit, new RegExp(`template changed \\(worca-agent → ${name} \\(build b1\\)\\)`));

  // Same name, new build: the sandbox from build b1 is replaced too; same build reattaches.
  const id2 = await pausedRun(fake, repo);
  const saved2 = readPipelineForResume(id2);
  assert.equal(saved2.resumePoint.execEnv.environmentBuild, 'b1');
  recordProjectBuild(key, 'e2b', { name, id: 'tpl1', buildId: 'b2', specHash: 'h', baseVersion: 'v' });
  const r2 = await createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved2 }).resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(ofType(fake, 'create').length, 4, 'the rebuild got a fresh sandbox');
  const id3 = await pausedRun(fake, repo);
  const saved3 = readPipelineForResume(id3);
  const r3 = await createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved3 }).resume();
  assert.equal(r3.status, 'done', r3.error);
  assert.equal(ofType(fake, 'create').length, 5, 'the same build reattached');
  assert.ok(ofType(fake, 'connect').some((e) => e.sandboxId === saved3.resumePoint.execEnv.sandboxId));
});

test('resume after the sandbox died while paused continues in a fresh sandbox; a refused resume stays paused', POSIX, async () => {
  const fake = useFake();
  const repo = freshRepo();
  const id = await pausedRun(fake, repo);
  const saved = readPipelineForResume(id);
  // A refusal (here the legacy run-root mode) runs before the row is claimed: it stays paused.
  const prev = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const refused = createOrchestrator({ projectDir: repo, claude: { mock: true }, resume: saved });
    await assert.rejects(refused.resume(), /detached run-root mode/);
  } finally { if (prev === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prev; }
  assert.equal(rowOf(id).status, 'paused');
  const dead = saved.resumePoint.execEnv.sandboxId;
  await fake.Sandbox.kill(dead);
  const orch2 = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  const logs = [];
  orch2.on('log', (e) => logs.push(e));
  const r = await orch2.resume();
  assert.equal(r.status, 'done', r.error);
  const creates = ofType(fake, 'create');
  assert.equal(creates.length, 2, 'a fresh sandbox replaced the dead one');
  assert.notEqual(creates[1].sandboxId, dead);
  assert.ok(logs.some((e) => /is gone .*starting a fresh E2B sandbox/.test(e.text || e.message || '')), JSON.stringify(logs.slice(-5)));
});

test('a sync that fails at pause still parks the sandbox (no heartbeat keeps it alive)', POSIX, async () => {
  const fake = useFake();
  let env = null;
  await pausedRun(fake, freshRepo(), { beforePause: (orch) => {
    env = orch.execEnv;
    env.syncBack = () => Promise.reject(new Error('sync failed'));
  } });
  assert.equal(env._held, true);
  assert.equal(env._heartbeat, null);
  assert.ok(ofType(fake, 'setTimeout').some((e) => e.ms === 240 * 60_000), 'parked at max wait');
  await fake.Sandbox.kill(env.sandboxId);
});

test('a resumed run that fails before it reconnects kills its parked sandbox', POSIX, async () => {
  const fake = useFake();
  const repo = freshRepo();
  const id = await pausedRun(fake, repo);
  const saved = readPipelineForResume(id);
  // A setup failure the policy pauses keeps the parked sandbox in the new point (nothing reconnected yet).
  const again = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved });
  again._registerEngineConfig = async () => { throw new Error('setup hiccup'); };
  assert.equal((await again.resume()).status, 'paused');
  const repaused = readPipelineForResume(id);
  assert.equal(repaused.resumePoint.execEnv.sandboxId, saved.resumePoint.execEnv.sandboxId);
  assert.equal(fake.live.size, 1);
  // A terminal failure before _resumeExecEnv ends the run: its parked sandbox goes.
  const orch2 = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: repaused });
  orch2._registerEngineConfig = async () => { throw markTerminal(new Error('setup broke')); };
  const r = await orch2.resume();
  assert.equal(r.status, 'error');
  assert.ok(ofType(fake, 'kill').some((e) => e.sandboxId === saved.resumePoint.execEnv.sandboxId));
  assert.equal(fake.live.size, 0);
  assert.equal(existsSync(join(worcaHome(), 'tmp', 'e2b', id)), false, 'the scratch dir goes too');
});

test('a pause while queued for a slot resumes into a newly created sandbox', POSIX, () => withCap1(async () => {
  const fake = useFake();
  const hold = await acquireSandboxSlot({ cap: 1 });
  const repo = freshRepo();
  const orch = createOrchestrator({ projectDir: repo, workflowId: 'wf_default', prompt: 'paused in queue', auto: true,
    claude: { mock: true }, execEnv: 'e2b' });
  const waiting = waitFor(orch, (st) => st.execEnvWaiting === true);
  const run = orch.run();
  await waiting;
  orch.pause();
  const r = await run;
  hold();
  assert.equal(r.status, 'paused', r.error);
  const saved = readPipelineForResume(orch.getState().id);
  assert.deepEqual(saved.resumePoint.execEnv, { kind: 'e2b' });
  const orch2 = createOrchestrator({ projectDir: repo, auto: true, claude: { mock: true }, resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(ofType(fake, 'create').length, 1);
}));

test('stopping a paused run kills its parked sandbox', POSIX, async () => {
  const fake = useFake();
  const repo = freshRepo();
  const id = await pausedRun(fake, repo);
  const saved = readPipelineForResume(id);
  const stopper = createOrchestrator({ projectDir: repo, claude: { mock: true }, resume: saved });
  await stopper.stopPaused('local');
  assert.ok(ofType(fake, 'kill').some((e) => e.sandboxId === saved.resumePoint.execEnv.sandboxId));
  assert.equal(fake.live.size, 0);
  assert.equal(rowOf(id).status, 'stopped');
});

test('a resumed run gets a fresh relay: the old one is killed, a route on the new one reaches the upstream', POSIX, async (t) => {
  const seen = [];
  const up = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => { seen.push({ url: req.url, headers: req.headers }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  t.after(() => { up.closeAllConnections(); up.close(); });
  const sdk = createFakeE2b({ root: tmp('worca-e2b-relay-root-') });
  const f = fixture(tmp);
  const first = new E2bExecEnv(makeEnvOpts(tmp, sdk, f));
  await first.start();
  assert.equal(first.relay.alive, true);
  // A worca restart: the first env's process is gone (it never closes, and never restarts its relay); its sandbox
  // and relay are not.
  first.relay.onDrop = null;
  const from = sdk.events.length;
  const second = await E2bExecEnv.reconnect(first.resumeRecord(), makeEnvOpts(tmp, sdk, f));
  t.after(() => second.close('test'));
  const cmds = sdk.events.slice(from).filter((e) => e.type === 'command').map((e) => e.cmd);
  const killAt = cmds.findIndex((c) => /^pkill -f .*\[m\]odel-relay/.test(c));
  const startAt = cmds.findIndex((c) => /^node .*model-relay\.mjs/.test(c));
  assert.ok(killAt >= 0, cmds.join('\n'));
  assert.ok(startAt > killAt, 'the old relay is killed before the new one starts');
  for (let i = 0; first.relay.alive && i < 300; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(first.relay.alive, false, 'the old relay process is gone');
  assert.equal(second.relay.alive, true);
  const route = second.openModelRoute({ spawnEnv: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${up.address().port}` }, modelEnv: { ANTHROPIC_API_KEY: 'gateway-key-0123' } });
  const r = await fetch(`${route.env.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST',
    headers: { authorization: `Bearer ${route.env.ANTHROPIC_AUTH_TOKEN}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/v1/messages');
  assert.equal(seen[0].headers['x-api-key'], 'gateway-key-0123');
  first._stopHeartbeat();
});

// A remote spawn's model calls go through the relay (plans/model-relay-design.md §4): an E2B env on the
// loopback fake whose `claude` calls the model the way the CLI does, with whatever the sandbox env holds.
async function relayedClaudeEnv(t, extra = {}, serverEnv = {}) {
  const seen = [];
  const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' });
  const sdk = createFakeE2b({ root: tmp('worca-e2b-relayed-root-'), onCommand: async (cmd, o) => {
    if (!cmd.startsWith("'claude'")) return null;
    const r = await fetch(`${o.envs.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST',
      headers: { authorization: `Bearer ${o.envs.ANTHROPIC_AUTH_TOKEN || ''}`, 'content-type': 'application/json' }, body: '{}' });
    seen.push({ envs: o.envs, status: r.status });
    return { lines: [init, JSON.stringify({ type: 'result', result: `status ${r.status}`, total_cost_usd: 0 })], exitCode: 0 };
  } });
  const f = fixture(tmp);
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: serverEnv, ...extra }));
  await env.start();
  t.after(() => env.close('test'));
  return { env, f, sdk, seen };
}
async function withRealClaude(fn) {
  const keys = ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try { return await fn(); } finally { for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

test('a remote run on a bridged model is no longer refused', POSIX, (t) => withRealClaude(async () => {
  const seen = [];
  const bridge = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { seen.push({ url: req.url, headers: req.headers }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  t.after(() => { bridge.closeAllConnections(); bridge.close(); });
  const { env, f, seen: spawns } = await relayedClaudeEnv(t);
  const secret = 'bridge-secret-0123456789';
  const r = await runClaude({ cwd: f.repo, prompt: 'hi', model: 'local-qwen', execEnv: env,
    modelEnv: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${bridge.address().port}/m/local-qwen`, ANTHROPIC_AUTH_TOKEN: secret } });
  assert.equal(r.text, 'status 200');
  assert.equal(seen.length, 1, 'the call reached worca\'s bridge through the relay');
  assert.equal(seen[0].url, '/m/local-qwen/v1/messages');
  assert.equal(seen[0].headers.authorization, `Bearer ${secret}`, 'worca adds the bridge secret on its side');
  assert.doesNotMatch(JSON.stringify(spawns[0].envs), new RegExp(secret), 'the bridge secret never enters the sandbox');
  assert.match(spawns[0].envs.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/r\//);
  assert.equal(env.relay.routes.size, 0, 'the route closed with the spawn');
}));

// Plan Task 13: deny-all egress (allowOut empty). The relay rides the command's stdio and the sandbox's loopback, which
// E2B keeps open under deny-all (plans/2026-10-22-e2b-kill-egress-checks.md §2), so a Claude step still reaches its model.
test('a Claude step reaches its model through the relay with the sandbox egress closed (allowOut empty)', POSIX, (t) => withRealClaude(async () => {
  const seen = [];
  const bridge = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { seen.push({ url: req.url }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  t.after(() => { bridge.closeAllConnections(); bridge.close(); });
  const network = { denyOut: ['0.0.0.0/0'] };
  const { env, f, sdk } = await relayedClaudeEnv(t, { network });
  assert.deepEqual(sdk.events.find((e) => e.type === 'create').network, network, 'the sandbox was created with deny-all');
  const r = await runClaude({ cwd: f.repo, prompt: 'hi', model: 'local-qwen', execEnv: env,
    modelEnv: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${bridge.address().port}/m/local-qwen`, ANTHROPIC_AUTH_TOKEN: 'bridge-secret-0123456789' } });
  assert.equal(r.text, 'status 200');
  assert.equal(seen.length, 1, 'the model call went through the relay to worca');
}));

test('a Bedrock model is refused for a remote run', POSIX, (t) => withRealClaude(async () => {
  // The server can sign Claude's calls (the route resolver lets the spawn through): the relay still cannot carry a
  // model that signs its own requests.
  const { env, f, sdk } = await relayedClaudeEnv(t, {}, { CLAUDE_CODE_OAUTH_TOKEN: 'server-oauth-0123456789' });
  const err = await runClaude({ cwd: f.repo, prompt: 'hi', model: 'bedrock-sonnet', execEnv: env,
    modelEnv: { CLAUDE_CODE_USE_BEDROCK: '1' } }).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.match(err.message, /^This model signs its own requests \(CLAUDE_CODE_USE_BEDROCK\), which an .+ cannot relay\. Pick Local for this model\.$/);
  assert.equal(err.errorClass, 'config');
  assert.equal(sdk.events.some((e) => e.type === 'command' && e.cmd.startsWith("'claude'")), false, 'claude never started');
  assert.equal(env.relay.routes.size, 0);
}));
test('a codex run executes its agents in the e2b sandbox (mock): one sandbox, every spawn recorded there', POSIX, async () => {
  const fake = useFake();
  const from = mockSpawnLog.length;
  const orch = createOrchestrator({ projectDir: freshRepo(), workflowId: await askingWorkflow(), prompt: 'codex in e2b',
    claude: { mock: true, engine: 'codex', allowUnguardedEngine: true }, execEnv: 'e2b' });
  answerAll(orch);
  const r = await orch.run();
  assert.equal(r.status, 'done', r.error);
  const sandboxId = ofType(fake, 'create')[0].sandboxId;
  const spawns = mockSpawnLog.slice(from).filter((s) => s.execEnv === sandboxId);
  assert.ok(spawns.length >= 2, JSON.stringify(spawns));
  assert.ok(spawns.every((s) => s.engine === 'codex'));
  assert.equal(ofType(fake, 'create').length, 1);
});
