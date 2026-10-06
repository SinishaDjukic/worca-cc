// test/cli-switch-model.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { addProject } from '../src/core/projects.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { parseSwitchArgs } from '../src/cli/switch-model.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const home = useTempHome(after);

function run(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args],
      { env: { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}
async function seedPaused(name, status = 'paused') {
  const dir = gitDir(name);
  await addProject({ name, path: dir });
  const rp = graphResumePoint({ pipelineDir: dir });
  const steps = [
    { key: 'x:n_clarify:1', executionId: 'x:n_clarify:1', nodeId: 'n_clarify', status: 'done' },
    { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused', sessionId: 's' },
  ];
  return (await seedPipeline(dir, { title: name, status, stepper: rp.manifest, resumePoint: rp, steps })).id;
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
  assert.equal(d.code, 1); assert.match(d.stderr, /only while it is paused/);
});
