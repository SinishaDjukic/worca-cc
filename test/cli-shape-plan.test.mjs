// test/cli-shape-plan.test.mjs
// The CLI neither starts a shape workflow around the gate (a CLI run is in-process and has no way
// to answer a `plan` ask) nor strands a held one. Spawn harness = test/cli-auto.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after, 'worca-cc-clishape-home-');
const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

function freshRepo() {
  const dir = templateRepo('clishape-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  scratch.push(dir);
  return dir;
}
const runCli = (args, extraEnv = {}) => {
  const env = { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', ...extraEnv };
  env.WORCA_FLAGS = '-shapeFirst';   // locked off over settings.json unless a test turns it on
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
};
const pipelineCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n;

for (const workflow of ['wf_shape', 'wf_shape_ux']) {
  for (const flag of ['-shapeFirst', 'shapeFirst']) {
    test(`worca run --workflow ${workflow} is refused (WORCA_FLAGS=${flag})`, () => {
      const before = pipelineCount();
      const r = runCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', workflow, '--yes'],
        { WORCA_FLAGS: flag });
      assert.notEqual(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stderr, /is started from the worca app/);
      assert.equal(pipelineCount(), before, 'no pipeline row is created');
    });
  }
}

test('worca run --workflow wf_shape --at is refused before the schedule block', () => {
  const before = pipelineCount();
  const r = runCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', 'wf_shape', '--at', '2099-01-01T00:00:00Z']);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr, /is started from the worca app/);
  assert.equal(pipelineCount(), before);
});

test('the CLI question handler pauses on a `plan` ask, ahead of the auto/no-readline early return', () => {
  const src = readFileSync(CLI, 'utf8');
  const start = src.indexOf("orch.on('question'");
  assert.ok(start > 0, 'question handler found');
  const handler = src.slice(start, src.indexOf('answering = true;', start));
  const arm = handler.indexOf("kind === 'plan'");
  const early = handler.indexOf('if (flags.auto || !rl) return;');
  assert.ok(arm > 0 && early > 0 && arm < early, 'plan arm precedes the early return');
  const armBody = handler.slice(arm, early);
  assert.match(armBody, /orch\.pause\(\)/);
  assert.doesNotMatch(armBody, /orch\.stop\(\)|orch\.answer\(/);
});

test('worca workflow list shows wf_shape only with the shapeFirst flag on', () => {
  const off = runCli(['workflow', 'list']);
  assert.equal(off.status, 0, off.stderr + off.stdout);
  assert.ok(!/^wf_shape\t/m.test(off.stdout));
  const on = runCli(['workflow', 'list'], { WORCA_FLAGS: 'shapeFirst' });
  assert.equal(on.status, 0, on.stderr + on.stdout);
  assert.match(on.stdout, /^wf_shape\t/m);
});
