// test/cli-switch-model.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { addProject } from '../src/core/projects.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { parseSwitchArgs } from '../src/cli/switch-model.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const home = useTempHome(after);

function run(args, env = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args],
      { env: { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}
/** `claude`: the resume point's run options (engine, modelForAll); `cells`: per-node model/effort to store. */
async function seedPaused(name, status = 'paused', { claude, cells = {} } = {}) {
  const dir = gitDir(name);
  await addProject({ name, path: dir });
  const rp = graphResumePoint({ pipelineDir: dir, ...(claude ? { claude } : {}) });
  for (const n of rp.manifest.graph.nodes) Object.assign(n, cells[n.id] || {});
  const steps = [
    { key: 'x:n_clarify:1', executionId: 'x:n_clarify:1', nodeId: 'n_clarify', status: 'done' },
    { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused', sessionId: 's' },
  ];
  return (await seedPipeline(dir, { title: name, status, stepper: rp.manifest, resumePoint: rp, steps })).id;
}
async function seedRunning(name, owner) {
  const dir = gitDir(name);
  await addProject({ name, path: dir });
  const rp = graphResumePoint({ pipelineDir: dir });
  const steps = [
    { key: 'x:n_clarify:1', executionId: 'x:n_clarify:1', nodeId: 'n_clarify', status: 'done' },
    { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start' },
  ];
  const { id } = await seedPipeline(dir, { title: name, status: 'running', stepper: rp.manifest, resumePoint: rp, steps });
  getDb().prepare('UPDATE pipelines SET owner_pid = ?, owner_host = ?, heartbeat_at = ? WHERE id = ?')
    .run(owner.pid, hostname(), owner.beat ?? null, id);
  return id;
}

test('parseSwitchArgs: flags, "default" clears, missing values reported', () => {
  const a = parseSwitchArgs(['abc', '--stage', 'planner', '--model', 'claude-opus-5-5', '--effort', 'default']);
  assert.equal(a.ref, 'abc'); assert.equal(a.stage, 'planner');
  assert.deepEqual(a.change, { model: 'claude-opus-5-5', effort: '' });
  assert.deepEqual(parseSwitchArgs(['abc', '--model']).missing, ['--model']);
});

test('lists stages, then switches one by agent key, and --all switches every remaining stage', async () => {
  const id = await seedPaused('cli-msw');
  const list = await run(['switch-model', id, '--json']);
  assert.equal(list.code, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).stages.find((s) => s.nodeId === 'n_clarify').switchable, false);

  const one = await run(['switch-model', id, '--stage', 'planner', '--model', 'claude-opus-5-5', '--effort', 'high']);
  assert.equal(one.code, 0, one.stderr);
  const plan = readPipelineForResume(id).resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_plan');
  assert.deepEqual([plan.model, plan.effort], ['claude-opus-5-5', 'high']);

  const all = await run(['switch-model', id, '--all', '--model', 'claude-sonnet-5-5', '--effort', 'default']);
  assert.equal(all.code, 0, all.stderr);
  const nodes = readPipelineForResume(id).resumePoint.manifest.graph.nodes;
  assert.equal(nodes.find((n) => n.id === 'n_impl').model, 'claude-sonnet-5-5');
  assert.equal(nodes.find((n) => n.id === 'n_clarify').model, '', 'completed stage untouched');
});

test('refuses a completed stage and a non-paused run with exit 1', async () => {
  const id = await seedPaused('cli-msw-ref');
  const r = await run(['switch-model', id, '--stage', 'n_clarify', '--model', 'claude-opus-5-5']);
  assert.equal(r.code, 1); assert.match(r.stderr, /already completed/);
  const done = await seedPaused('cli-msw-done', 'done');
  const d = await run(['switch-model', done]);
  assert.equal(d.code, 1); assert.match(d.stderr, /models can be switched while it is running or paused/);
});

test('a running run: lists with its live states; dead owner refuses; no answer reads "Switch sent"', async () => {
  const dead = await seedRunning('cli-msw-dead', { pid: 2147483646 });
  const list = await run(['switch-model', dead]);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /— running/);
  const json = JSON.parse((await run(['switch-model', dead, '--json'])).stdout);
  assert.equal(json.status, 'running');
  assert.deepEqual([json.stages.find((s) => s.nodeId === 'n_plan').state, json.stages.find((s) => s.nodeId === 'n_plan').switchable], ['running', false]);
  const r = await run(['switch-model', dead, '--stage', 'implementer', '--model', 'claude-opus-5-5']);
  assert.equal(r.code, 1); assert.match(r.stderr, /no live owner process/);
  const idle = await seedRunning('cli-msw-idle', { pid: process.pid, beat: new Date().toISOString() });
  const t = await run(['switch-model', idle, '--stage', 'implementer', '--model', 'claude-opus-5-5'], { WORCA_CONTROL_CONFIRM_MS: '700' });
  assert.equal(t.code, 0, t.stderr); assert.match(t.stdout, /Switch sent/);
});

test('the listing names the run engine and a one-model-for-all resume (m3)', async () => {
  const id = await seedPaused('cli-msw-head');
  const list = await run(['switch-model', id]);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /Engine: Claude\n/);
  assert.doesNotMatch(list.stdout, /for every remaining stage/);
  const codex = await seedPaused('cli-msw-codex', 'paused', { claude: { engine: 'codex' } });
  assert.match((await run(['switch-model', codex])).stdout, /Engine: Codex\n/);
  const forAll = await seedPaused('cli-msw-forall', 'paused', { claude: { model: 'claude-sonnet-5-5', modelForAll: true } });
  assert.match((await run(['switch-model', forAll])).stdout,
    /Resumed with claude-sonnet-5-5 for every remaining stage — per-stage models and efforts do not apply\./);
});

test('--model without --effort clears a stored effort the new model does not offer, as the panel does (m4)', async () => {
  const OPUS = 'claude-opus-5-5';
  const cells = { n_plan: { model: OPUS, effort: 'xhigh' }, n_refine: { model: OPUS, effort: 'xhigh' },
    n_impl: { model: OPUS, effort: 'high' }, n_review: { model: OPUS, effort: 'xhigh' } };
  const id = await seedPaused('cli-msw-recon', 'paused', { cells });
  const r = await run(['switch-model', id, '--all', '--model', 'claude-haiku-4-5']);   // Haiku 4.5: medium, high
  assert.equal(r.code, 0, r.stderr);
  const nodes = readPipelineForResume(id).resumePoint.manifest.graph.nodes;
  const pair = (n) => { const x = nodes.find((y) => y.id === n); return [x.model, x.effort]; };
  assert.deepEqual(['n_plan', 'n_refine', 'n_impl', 'n_review'].map(pair), [
    ['claude-haiku-4-5', ''], ['claude-haiku-4-5', ''], ['claude-haiku-4-5', 'high'], ['claude-haiku-4-5', '']]);
});
