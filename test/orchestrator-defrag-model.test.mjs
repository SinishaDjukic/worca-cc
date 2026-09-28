// test/orchestrator-defrag-model.test.mjs — Settings › Memory: the model/effort EVERY Memory
// defragment run uses, resolved once at run start by the orchestrator (memory-defrag-model.mjs):
// the setting reaches the agent, a pair named at start wins, a stale setting degrades with a
// warning (never a refused run), a project's own node pick loses to it, and a resume keeps the
// pair the run started with. Mock runs; settings.json lives under a sandboxed HOME.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { memoryRoot, writeMemory, GLOBAL_SCOPE } from '../src/core/memory-store.mjs';
import { projectKey } from '../src/core/store.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { RUN_LOG_FILE } from '../src/core/run-log.mjs';
import { readPipelineByKey, readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);
// settings.json resolves under HOME; the detached run context reads the root layer at
// WORCA_PROJECTS_ROOT — both pinned hermetic, as test/orchestrator-memory.test.mjs does.
let sandboxHome; const prevEnv = {};
const HERMETIC_ROOT = mkdtempSync(join(tmpdir(), 'worca-dmodel-proot-'));
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-dmodel-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_RUN_ROOT']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = HERMETIC_ROOT;
  delete process.env.WORCA_RUN_ROOT;
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  rmSync(HERMETIC_ROOT, { recursive: true, force: true });
});

const CAPS = { hardBytesPerFile: 32768 };
const NOW = '2026-09-22T10:00:00.000Z';

/** settings.json wholesale — the Settings › Memory setting is `memory.defrag.{model,effort}`. */
async function storeSetting(defrag) {
  await mkdir(join(sandboxHome, '.worca-cc'), { recursive: true });
  await writeFile(join(sandboxHome, '.worca-cc', 'settings.json'), JSON.stringify(defrag ? { memory: { defrag } } : {}, null, 2));
}

/** A producer that records what the defragmenter was spawned with, then runs the real (mock) execution. */
const recorder = (seen) => async (ctx) => {
  if (ctx.node.key === 'memoryDefragmenter') seen.push({ model: ctx.claudeOpts.model, effort: ctx.claudeOpts.effort });
  return runAgentExecution(ctx);
};

async function defragRun({ claude = {}, dir = gitDir('dmodel') } = {}) {
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  const seen = [];
  const logs = [];
  const orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.',
    claude: { mock: true, ...claude }, auto: true, runners: { producer: recorder(seen) },
  });
  orch.on('log', (e) => logs.push(e));
  const res = await orch.run();
  const node = orch.getState().stepper.graph.nodes.find((n) => n.id === 'n_defrag');
  return { dir, orch, res, seen, logs, node };
}

test('unset: today\'s behaviour — the template\'s Sonnet 5, no effort, no model line', { timeout: 120000 }, async () => {
  await storeSetting(null);
  const { res, seen, logs, node } = await defragRun();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.deepEqual(seen, [{ model: 'claude-sonnet-5', effort: undefined }]);
  assert.deepEqual([node.model, node.effort], ['claude-sonnet-5', '']);
  assert.ok(!logs.some((e) => /Memory defragment model/.test(e.text)), 'nothing to say');
});

test('the setting reaches the agent (model AND effort), the manifest shows it, and the log names where it came from', { timeout: 120000 }, async () => {
  await storeSetting({ model: 'claude-opus-5-5', effort: 'high' });
  const { res, seen, logs, node } = await defragRun();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.deepEqual(seen, [{ model: 'claude-opus-5-5', effort: 'high' }]);
  assert.deepEqual([node.model, node.effort], ['claude-opus-5-5', 'high'], 'Running / History show what the engine ran');
  assert.ok(logs.some((e) => e.level === 'info' && e.text === 'Memory defragment model: claude-opus-5-5 · high (Settings › Memory)'), logs.map((e) => e.text).join('\n'));
});

test('a model named at start wins, and the setting\'s effort never rides under it', { timeout: 120000 }, async () => {
  await storeSetting({ model: 'claude-opus-5-5', effort: 'high' });
  const { seen, logs, node } = await defragRun({ claude: { model: 'claude-haiku-4-5' } });
  assert.deepEqual(seen, [{ model: 'claude-haiku-4-5', effort: undefined }]);
  assert.deepEqual([node.model, node.effort], ['claude-haiku-4-5', '']);
  assert.ok(logs.some((e) => e.text === 'Memory defragment model: claude-haiku-4-5 (named at start)'));
  const { seen: withEffort } = await defragRun({ claude: { model: 'claude-haiku-4-5', effort: 'medium' } });
  assert.deepEqual(withEffort, [{ model: 'claude-haiku-4-5', effort: 'medium' }], 'a pair named at start carries its own effort');
  const { seen: seen2 } = await defragRun({ claude: { effort: 'max' } });
  assert.deepEqual(seen2, [{ model: 'claude-opus-5-5', effort: 'high' }], 'an effort named without a model means nothing');
});

test('a model gone from the catalog degrades to the default with a run-log AND an audit warning — the run is not refused', { timeout: 120000 }, async () => {
  await storeSetting({ model: 'gone-model-9', effort: 'high' });
  const { dir, orch, res, seen, node } = await defragRun();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.deepEqual(seen, [{ model: 'claude-sonnet-5', effort: undefined }], 'the workflow default');
  assert.equal(node.model, 'claude-sonnet-5');
  const log = (await readFile(join(orch.getState().pipelineDir, RUN_LOG_FILE), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((e) => e.level === 'warn' && /Memory defragment model "gone-model-9" \(Settings › Memory\) is not in this project's model catalog/.test(e.text)), 'persisted in the run log');
  const detail = await readPipelineByKey(projectKey(dir), orch.pipeline.id);
  assert.match(detail.auditMarkdown, /Memory defragment model "gone-model-9" \(Settings › Memory\) is not in this project's model catalog — the run uses claude-sonnet-5 at its default effort\./);
  assert.ok(log.some((e) => e.level === 'warn' && / — the run uses claude-sonnet-5 at its default effort$/.test(e.text)), 'the warning names the model the run really used');
});

test('an effort the model does not offer is dropped with a warning; the model stays', { timeout: 120000 }, async () => {
  await storeSetting({ model: 'claude-haiku-4-5', effort: 'max' });
  const { seen, logs } = await defragRun();
  assert.deepEqual(seen, [{ model: 'claude-haiku-4-5', effort: undefined }]);
  assert.ok(logs.some((e) => e.level === 'warn' && /effort "max" .* is not offered by claude-haiku-4-5 — the run uses claude-haiku-4-5 at its default effort$/.test(e.text)), logs.map((e) => e.text).join('\n'));
});

test('a stale setting over a project\'s own node pick: the warning names the pick the run falls back to', { timeout: 120000 }, async () => {
  const dir = gitDir('dmodel');
  await setNodeModel(dir, 'wf_memory_defrag', 'n_defrag', { model: 'claude-fable-5-1', effort: 'max' });
  await storeSetting({ model: 'gone-model-9', effort: 'high' });
  const { orch, res, seen } = await defragRun({ dir });
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.deepEqual(seen, [{ model: 'claude-fable-5-1', effort: 'max' }], 'the node layers decide, exactly as without a setting');
  const detail = await readPipelineByKey(projectKey(dir), orch.pipeline.id);
  assert.match(detail.auditMarkdown, /is not in this project's model catalog — the run uses claude-fable-5-1 · max\./, 'never "the workflow default" when a pick applies');
});

test('GLOBAL: the setting beats the project\'s own node pick; unset, the pick applies exactly as before', { timeout: 120000 }, async () => {
  const dir = gitDir('dmodel');
  await setNodeModel(dir, 'wf_memory_defrag', 'n_defrag', { model: 'claude-fable-5-1', effort: 'max' });
  await storeSetting({ model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual((await defragRun({ dir })).seen, [{ model: 'claude-opus-5-5', effort: 'high' }]);
  await storeSetting(null);
  assert.deepEqual((await defragRun({ dir })).seen, [{ model: 'claude-fable-5-1', effort: 'max' }]);
});

test('a paused defragment run resumes on the pair it STARTED with, whatever the setting says now', { timeout: 120000 }, async () => {
  await storeSetting({ model: 'claude-opus-5-5', effort: 'high' });
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'a', 'Rule A.\n', { source: 'user', now: NOW, caps: CAPS });
  const dir = gitDir('dmodel');
  const seen = [];
  let orchRef = null; let hangOnce = true;
  const runners = {
    producer: async (ctx) => {
      if (hangOnce && ctx.node.key === 'memoryDefragmenter') {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return recorder(seen)(ctx);
    },
  };
  const orch1 = createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true, runners });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  await storeSetting({ model: 'claude-haiku-4-5', effort: 'medium' });       // changed while the run sat paused
  const orch2 = createOrchestrator({ projectDir: dir, claude: { mock: true }, auto: true, runners, resume: readPipelineForResume(orch1.state.id) });
  orchRef = orch2;
  const logs = [];
  orch2.on('log', (e) => logs.push(e));
  assert.equal((await orch2.resume()).status, 'done');
  assert.deepEqual(seen, [{ model: 'claude-opus-5-5', effort: 'high' }], 'the frozen manifest, not the new setting');
  assert.ok(!logs.some((e) => /Memory defragment model/.test(e.text)), 'a resume never re-resolves');
});

test('an ordinary run never consults the setting', { timeout: 120000 }, async () => {
  await storeSetting({ model: 'claude-opus-5-5', effort: 'high' });
  const logs = [];
  const orch = createOrchestrator({ projectDir: gitDir('dmodel'), workflowId: 'wf_default', prompt: 'demo task', claude: { mock: true }, auto: true });
  orch.on('log', (e) => logs.push(e));
  assert.equal((await orch.run()).status, 'done');
  assert.ok(!logs.some((e) => /Memory defragment model/.test(e.text)));
  assert.ok(!orch.getState().stepper.graph.nodes.some((n) => n.model === 'claude-opus-5-5' && n.effort === 'high'), 'no node took the defragment pair');
});
