// test/workflow-test-start.test.mjs — workflow tests: the run-start and boot seams of a test try, kept out of ui/server.mjs
// (src/core/workflow-tests/start.mjs). The server's start route keeps one call per seam; the API tests
// (api-workflow-test-try, api-workflow-test-project-try, api-workflow-test-project-restart) pin the wiring.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

const home = join(useTempHome(after, 'worca-cc-wftstart-'), '.worca-cc');
const start = await import('../src/core/workflow-tests/start.mjs');
const { testCopyDirFor, testCopiesRoot } = await import('../src/core/store.mjs');
const KEY = 'proj-0123abcd';
const copy = testCopyDirFor(KEY);
mkdirSync(copy, { recursive: true });

test('workflowTestOf: only an in-process object, never anything else', () => {
  const wt = { use: 'draft' };
  assert.equal(start.workflowTestOf({ _workflowTest: wt }), wt);
  assert.equal(start.workflowTestOf({ _workflowTest: 'draft' }), null);
  assert.equal(start.workflowTestOf({ body: { _workflowTest: wt } }), null);
  assert.equal(start.workflowTestOf({}), null);
});

test('tryStartRefusal: null for a run that is not a try, and for a good try with or without a project', () => {
  assert.equal(start.tryStartRefusal(null, { sameAsSource: true }), null);
  assert.equal(start.tryStartRefusal({ use: 'draft' }, { noProject: true }), null);
  assert.equal(start.tryStartRefusal({ use: 3, connectors: 'real' }, { noProject: true }), null);
  assert.equal(copy, join(home, 'workflow-tests', 'repos', KEY));
  assert.equal(start.tryStartRefusal({ use: 'draft', project: { key: KEY, setupCmd: 'npm ci' } }, { projectDir: copy }), null);
});

test('tryStartRefusal: the five refusals, in the order the start route checks them', () => {
  const where = "a test try runs without a project, or in Worca's copy of one";
  assert.equal(start.tryStartRefusal({ use: 'draft' }, {}), where);
  assert.equal(start.tryStartRefusal({ use: 'draft', project: { key: KEY } }, { projectDir: join(home, 'elsewhere', KEY) }), where);
  assert.equal(start.tryStartRefusal({ use: 'draft', project: { key: 'Not A Key' } }, { projectDir: copy }), where);
  assert.equal(start.tryStartRefusal({ use: 'draft', project: 'x' }, { projectDir: copy }), where);
  const now = 'a test try starts now, on a branch of its own';
  for (const extra of [{ sameAsSource: true }, { scheduledFor: 'x' }, { repeat: 0 }, { after: 'p' }, { workspaceId: 'w' }]) {
    assert.equal(start.tryStartRefusal({ use: 'bad' }, { noProject: true, ...extra }), now, JSON.stringify(extra));
  }
  const oneLine = 'a test try names its setup command on one line';
  assert.equal(start.tryStartRefusal({ use: 'draft', project: { key: KEY, setupCmd: 'a\nb' } }, { projectDir: copy }), oneLine);
  assert.equal(start.tryStartRefusal({ use: 'draft', project: { key: KEY, setupCmd: 7 } }, { projectDir: copy }), oneLine);
  const use = 'a test try names the draft or a version number';
  for (const u of [undefined, 0, -1, 1.5, '2']) assert.equal(start.tryStartRefusal({ use: u }, { noProject: true }), use, String(u));
  assert.equal(start.tryStartRefusal({ use: 'draft', connectors: 'both' }, { noProject: true }), 'a test try names its connectors: pretend or real');
});

test('tryRunOptions: nothing for a run that is not a try; the hidden try options, and a project try keeps its checkout', () => {
  assert.deepEqual(start.tryRunOptions(null), {});
  assert.deepEqual(start.tryRunOptions(null, { project: true }), {});
  assert.deepEqual(start.tryRunOptions({ use: 'draft' }),
    { workflowUse: 'draft', workflowTest: true, noMemory: true, titleLocked: true, testConnectors: 'pretend' });
  assert.equal(start.tryRunOptions({ use: 2, connectors: 'real' }).testConnectors, 'real');
  assert.deepEqual(start.tryRunOptions({ use: 2, project: { key: KEY } }, { project: true }),
    { workflowUse: 2, workflowTest: true, noMemory: true, titleLocked: true, testConnectors: 'pretend', keepCheckout: true });
  assert.deepEqual(start.tryRunOptions({ use: 2, project: { key: KEY, setupCmd: 'npm ci' } }, { project: true }).trySetup,
    { cmd: 'npm ci', timeoutMs: 30 * 60_000 });
});

test('holdTryOrch: hands the orchestrator to the runner; a throw reaches the caller', () => {
  const got = [];
  start.holdTryOrch({ onOrch: (orch, info) => got.push([orch, info]) }, 'O', 'run-1');
  assert.deepEqual(got, [['O', { runKey: 'run-1' }]]);
  start.holdTryOrch(null, 'O', 'run-1');
  start.holdTryOrch({ onOrch: 'not a function' }, 'O', 'run-1');
  assert.throws(() => start.holdTryOrch({ onOrch: () => { throw new Error('boom'); } }, 'O', 'run-1'), /boom/);
});

test('the boot seams never throw and report what they did', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'worca-cc-wftstart-tmp-'));
  try {
    const old = join(tmp, 'worca-claude-old');   // STAGING_PREFIX, older than a day
    mkdirSync(old);
    const t = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(old, t, t);
    assert.deepEqual(start.recoverTestsAtBoot({ tmpDir: tmp }), { runs: 0, stagingDirs: 1 });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  assert.equal(testCopiesRoot(), join(home, 'workflow-tests', 'repos'));
  const logged = [];
  assert.deepEqual(await start.sweepTestCopiesAtBoot((...a) => logged.push(a)), { copies: 0, branches: 0 });
  assert.ok(logged.some(([level, msg]) => level === 'warn' && msg.includes(KEY)), 'a folder that is not a copy is left alone, said once');
});
