// A detached run's temp files live in <runRoot>/scratch, which never outlives the run, even when the root is retained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOpts } from '../src/core/phases.mjs';
import { cleanRunEnv, composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { isReservedModelEnvKey } from '../src/core/model-env.mjs';
import { runScratchDir, removeRunScratch, scanStrayEntries } from '../src/core/run-manifest.mjs';
import { sweepRunRoots } from '../src/core/worktree.mjs';

const CALL = { role: 'implementer', prompt: 'p', systemPrompt: 's' };
const ROOT = '/h/.worca-cc/runs/r1';
const SCRATCH = `${ROOT}/.scratch`;

test('a detached run points its temp dirs at the scratch folder and may write there', () => {
  const o = runOpts({ projectDir: `${ROOT}/repos/shop`, runRoot: ROOT, claudeOpts: {} }, CALL);
  assert.equal(o.spawnEnv.TMPDIR, SCRATCH);
  assert.equal(o.spawnEnv.CLAUDE_CODE_TMPDIR, SCRATCH);
  assert.deepEqual(o.addDirs, [SCRATCH]);
  assert.ok(o.writableDirs.includes(SCRATCH));
});

test('the scratch folder joins the memory mount and wins over a registry env', () => {
  const o = runOpts({ projectDir: `${ROOT}/repos/shop`, runRoot: ROOT, memoryMount: '/m', mcpEnv: { TMPDIR: '/elsewhere', A: '1' }, claudeOpts: {} }, CALL);
  assert.deepEqual(o.addDirs, ['/m', SCRATCH]);
  assert.equal(o.spawnEnv.TMPDIR, SCRATCH);
  assert.equal(o.spawnEnv.A, '1');
});

test('a run without a run root changes nothing', () => {
  const o = runOpts({ projectDir: '/p', claudeOpts: {} }, CALL);
  assert.equal(o.spawnEnv, undefined);
  assert.equal(o.addDirs, undefined);
  assert.equal(runScratchDir(null), null);
});

test('TMPDIR survives the run env, and a model env still cannot set it', () => {
  assert.deepEqual(cleanRunEnv({ TMPDIR: SCRATCH, HOME: '/x' }), { TMPDIR: SCRATCH });
  const { env } = composeSpawnEnv({ runEnv: cleanRunEnv({ TMPDIR: SCRATCH }) });
  assert.equal(env.TMPDIR, SCRATCH);
  assert.equal(isReservedModelEnvKey('TMPDIR'), true);
});

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'worca-scratch-'));
  const root = join(home, 'runs', 'r1');
  mkdirSync(join(root, '.scratch', 'clone'), { recursive: true });
  mkdirSync(join(root, 'repos', 'shop'), { recursive: true });
  writeFileSync(join(root, '.scratch', 'clone', 'f'), 'x');
  writeFileSync(join(root, 'repos', 'shop', 'keep'), 'x');
  return { home, root };
}

test('removal takes the scratch folder only and tolerates a missing one', async () => {
  const { home, root } = fixture();
  await removeRunScratch(root);
  assert.equal(existsSync(join(root, '.scratch')), false);
  assert.equal(existsSync(join(root, 'repos', 'shop', 'keep')), true);
  await removeRunScratch(root);
  await removeRunScratch(null);
  rmSync(home, { recursive: true, force: true });
});

test('the stray scan does not rescue a scratch folder that could not be removed', async () => {
  const { home, root } = fixture();
  const pipelineDir = join(home, 'pipe');
  assert.deepEqual(await scanStrayEntries({ runRoot: root, pipelineDir }), []);
  assert.equal(existsSync(join(pipelineDir, 'stray')), false);
  rmSync(home, { recursive: true, force: true });
});

test('the sweep clears the scratch folder of a retained root and keeps its checkouts', async () => {
  const { home, root } = fixture();
  const out = await sweepRunRoots({
    worcaHome: home, statusOf: () => 'done', retainOf: () => ({ reason: 'commit_failed' }), log: () => {},
  });
  assert.deepEqual(out.keep, [root]);
  assert.equal(existsSync(join(root, '.scratch')), false);
  assert.equal(existsSync(join(root, 'repos', 'shop', 'keep')), true);
  rmSync(home, { recursive: true, force: true });
});

test('the sweep leaves the scratch folder of a paused run alone', async () => {
  const { home, root } = fixture();
  await sweepRunRoots({ worcaHome: home, statusOf: () => 'paused', log: () => {} });
  assert.equal(existsSync(join(root, '.scratch', 'clone', 'f')), true);
  rmSync(home, { recursive: true, force: true });
});
