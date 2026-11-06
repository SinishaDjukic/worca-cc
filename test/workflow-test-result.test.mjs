// test/workflow-test-result.test.mjs — D25: a try's facts, its main result, its result folder, and the script checks.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { createPipeline, writeState, recordArtifact } from '../src/core/artifacts.mjs';
import { projectKey } from '../src/core/store.mjs';
import { mainResult, readTryOutcome, checkTry, runScriptCheck, SCRIPT_CHECK_MARGIN_MS } from '../src/core/workflow-tests/result.mjs';
import { normaliseCheck } from '../src/shared/workflow-tests/checks.mjs';
import { SETTINGS_IGNORED_FILE } from '../src/core/workflow-tests/try-guard-env.mjs';

const homes = [];
let projectDir;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftres-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  projectDir = join(dir, 'proj');
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

async function seedTry({ result = null, work = {}, wireDeliveries = {}, status = 'done', cost = 0.42 } = {}) {
  const { id, dir } = await createPipeline(projectDir, { prompt: 'p', title: 't', isTest: true });
  for (const [rel, text] of Object.entries(work)) {
    const file = join(dir, 'work', ...rel.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    recordArtifact(id, 'work', `work/${rel}`);
  }
  const r = typeof result === 'function' ? result(dir) : result;
  await writeState(dir, { projectKey: projectKey(projectDir), id, status, totalCostUsd: cost, steps: [], engine: 2, endReached: !!r, result: r, wireDeliveries });
  return { id, dir };
}
const BRIEF = '# Brief\n\nHello world';

test('the main result: the End result file, then the End value, then the largest text file', async () => {
  const a = await seedTry({ work: { 'brief.md': BRIEF, 'notes/long.txt': 'x '.repeat(3000) }, result: (dir) => ({ type: 'md', path: join(dir, 'work', 'brief.md') }) });
  assert.deepEqual(await mainResult(a.id), { name: 'brief.md', text: BRIEF, source: 'end-file' });
  const b = await seedTry({ result: { type: 'md', value: 'Short answer' } });
  assert.deepEqual(await mainResult(b.id), { name: null, text: 'Short answer', source: 'end-value' });
  const c = await seedTry({ work: { 'a.md': 'small', 'b.txt': 'a bigger text here', 'pic.png': 'x'.repeat(100) } });
  assert.deepEqual(await mainResult(c.id), { name: 'b.txt', text: 'a bigger text here', source: 'work' });
  const d = await seedTry();
  assert.deepEqual(await mainResult(d.id), { name: null, text: null, source: null });
  assert.deepEqual(await mainResult('nope0000'), { name: null, text: null, source: null });
});

test('the outcome: status, cost, the loop deliveries as "sent back", the help and the result folder', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF }, wireDeliveries: { w_loop: 2, w_other: 1 } });
  const o = await readTryOutcome(t.id, { help: [{ kind: 'questions', question: 'Who?' }], durationMs: 1234 });
  assert.deepEqual(o.facts, { status: 'done', costUsd: 0.42, durationMs: 1234, sentBack: 3, help: [{ kind: 'questions', question: 'Who?' }], failReason: null });
  assert.deepEqual([o.pipelineId, o.name, o.text, o.files], [t.id, 'brief.md', BRIEF, ['work/brief.md']]);
  const none = await readTryOutcome(null);
  assert.deepEqual([none.facts.status, none.facts.failReason, none.files], ['error', 'The try did not start.', []]);
});

test('checkTry: built-in checks on the result, then the script checks; a try that did not finish runs no script', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF }, wireDeliveries: { w: 3 } });
  const example = {
    basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: 1 },
    checks: [{ id: 'c_1', ...normaliseCheck({ kind: 'words', min: 2 }).check }, { id: 'c_2', ...normaliseCheck({ kind: 'file', name: 'brief.md' }).check },
      { id: 'c_3', ...normaliseCheck({ kind: 'script', key: 'lint-md' }).check }],
  };
  const calls = [];
  const runScript = async (check, { pipelineId }) => { calls.push([check.key, pipelineId]); return { met: false, value: '2 problems' }; };
  const v = await checkTry(example, await readTryOutcome(t.id), { runScript, scriptName: () => 'Markdown lint' });
  assert.equal(v.passed, false);
  assert.deepEqual(v.checks.map((c) => [c.label, c.met, c.value]), [
    ['Length is at least 2 words', true, '3 words'],
    ['Has a file named brief.md', true, 'Met'],
    ['The Library script "Markdown lint" passes', false, '2 problems'],
  ]);
  assert.deepEqual(v.basics.map((b) => [b.key, b.met]), [['noError', true], ['noHelp', true], ['maxSentBack', false]]);
  assert.deepEqual(v.result, { name: 'brief.md', source: 'work', words: 3 });
  assert.deepEqual(calls, [['lint-md', t.id]]);
  const stopped = await seedTry({ status: 'stopped' });
  const v2 = await checkTry(example, await readTryOutcome(stopped.id), { runScript });
  assert.equal(v2.checks[2].value, 'Not run: the try did not finish');
  assert.equal(calls.length, 1);
});

test('a script check runs on a copy of the result folder, waits while the bench is busy, and passes on clean', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF } });
  const seen = [];
  let busy = 1;
  const runBench = async (req, deps) => {
    if (busy-- > 0) throw Object.assign(new Error('busy'), { code: 'BUSY' });
    seen.push({ copied: existsSync(join(req.cwd.dir, 'brief.md')), allow: deps.allowDirCwd, kind: req.cwd.kind, dir: req.cwd.dir });
    return { status: 'clean', summary: '' };
  };
  const ok = await runScriptCheck({ kind: 'script', key: 'lint-md', params: {} }, { pipelineId: t.id, runBench, waitMs: 1 });
  assert.deepEqual(ok, { met: true, value: 'Met' });
  assert.deepEqual([seen[0].copied, seen[0].allow, seen[0].kind], [true, true, 'dir']);
  assert.equal(existsSync(seen[0].dir), false, 'the copy is removed afterwards');
  assert.ok(existsSync(join(t.dir, 'work', 'brief.md')), 'the try\'s own result is untouched');
  const bad = await runScriptCheck({ kind: 'script', key: 'lint-md' }, { pipelineId: t.id, runBench: async () => ({ status: 'blocking', summary: 'Heading levels skip\nmore' }) });
  assert.deepEqual(bad, { met: false, value: 'Heading levels skip' });
  const gone = await runScriptCheck({ kind: 'script', key: 'nope' }, { pipelineId: t.id, runBench: async () => { throw Object.assign(new Error('script "nope" not found'), { code: 'NOT_FOUND' }); } });
  assert.deepEqual(gone, { met: false, value: 'The script is no longer in the Library.' }, 'U-T2: a deleted script is a normal Not met check, not a Worca problem');
  assert.equal(gone.worcaProblem, undefined);
  const threw = await runScriptCheck({ kind: 'script', key: 'x' }, { pipelineId: t.id, runBench: async () => { throw new Error('bench exploded'); } });
  assert.equal(threw.worcaProblem, true, 'another bench throw stays a Worca problem');
});

test('a stuck script check times out, frees the queue, and still removes its copy once it settles', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF } });
  let release; let stuckDir = null;
  const stuck = (req) => { stuckDir = req.cwd.dir; return new Promise((r) => { release = r; }); };
  const first = runScriptCheck({ kind: 'script', key: 'a' }, { pipelineId: t.id, runBench: stuck, deadlineMs: 50 });
  const second = runScriptCheck({ kind: 'script', key: 'b' }, { pipelineId: t.id, runBench: async () => ({ status: 'clean', summary: '' }), deadlineMs: 50 });
  assert.deepEqual(await first, { met: false, value: 'Not met', error: 'timed out', worcaProblem: true }, 'U-T2: the backstop is Worca\'s');
  assert.deepEqual(await second, { met: true, value: 'Met' });
  assert.equal(existsSync(stuckDir), true, 'still there while the job is stuck');
  release({ status: 'clean' });
  for (let i = 0; i < 50 && existsSync(stuckDir); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(existsSync(stuckDir), false, 'removed once the stuck job settles');
});

test('a setup error becomes a not-met check and checkTry keeps the other results', async () => {
  const r = await runScriptCheck({ kind: 'script', key: 'a' }, { pipelineId: 'no-such-pipeline', runBench: async () => ({ status: 'clean' }) });
  assert.equal(r.met, false);
  assert.equal(r.value, 'Not met');
  assert.equal(r.error, 'The try was not found.');
  const t = await seedTry({ work: { 'brief.md': BRIEF } });
  const example = { basics: {}, checks: [
    { id: 's1', ...normaliseCheck({ kind: 'script', key: 'a' }).check },
    { id: 'f1', ...normaliseCheck({ kind: 'file', name: 'brief.md' }).check },
  ] };
  const outcome = await readTryOutcome(t.id);
  const v = await checkTry(example, outcome, { runScript: (c) => runScriptCheck(c, { pipelineId: 'no-such-pipeline', runBench: async () => ({ status: 'clean' }) }) });
  assert.equal(v.checks.length, 2);
  assert.deepEqual(v.checks.map((c) => c.met), [false, true]);
  assert.ok(v.checks[0].error);
});

test('U-T2: a check Worca could not run is marked worcaProblem; a check that ran and missed is not', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF } });
  const threw = await runScriptCheck({ kind: 'script', key: 'a' }, { pipelineId: t.id, runBench: async () => { throw new Error('spawn EPERM'); } });
  assert.deepEqual(threw, { met: false, value: 'Not met', error: 'spawn EPERM', worcaProblem: true });
  const missed = await runScriptCheck({ kind: 'script', key: 'a' }, { pipelineId: t.id, runBench: async () => ({ status: 'blocking', summary: 'Too long' }) });
  assert.deepEqual(missed, { met: false, value: 'Too long' });
  const example = { basics: {}, checks: [
    { id: 's1', ...normaliseCheck({ kind: 'script', key: 'a' }).check },
    { id: 'f1', ...normaliseCheck({ kind: 'file', name: 'brief.md' }).check },
  ] };
  const outcome = await readTryOutcome(t.id);
  const v = await checkTry(example, outcome, { runScript: (c) => runScriptCheck(c, { pipelineId: t.id, runBench: async () => { throw new Error('spawn EPERM'); } }) });
  assert.deepEqual([v.checks[0].worcaProblem, v.checks[1].worcaProblem], [true, undefined], 'the bench throw reaches the verdict');
  const cmd = { basics: {}, checks: [{ id: 'c1', ...normaliseCheck({ kind: 'command', cmd: 'node x.mjs' }).check }] };
  const project = { ...outcome, project: { checkoutDir: null } };
  const gone = await checkTry(cmd, project);
  assert.deepEqual([gone.checks[0].value, gone.checks[0].worcaProblem], ['Not run: the copy of the project is gone', true]);
  const ranThrew = await checkTry(cmd, { ...outcome, project: { checkoutDir: projectDir } }, { runCommand: async () => { throw new Error('spawn ENOENT'); } });
  assert.deepEqual([ranThrew.checks[0].value, ranThrew.checks[0].worcaProblem, ranThrew.checks[0].error], ['Ended with an error', true, 'spawn ENOENT']);
  const ranFailed = await checkTry(cmd, { ...outcome, project: { checkoutDir: projectDir } }, { runCommand: async () => ({ met: false, value: '1 failed', output: 'x' }) });
  assert.equal(ranFailed.checks[0].worcaProblem, undefined, 'a command that ran and failed is the workflow\'s');
});

test('the bench gets the script own timeout, the backstop deadline follows it, and a timed-out job stops retrying BUSY', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF } });
  const reqs = [];
  const ok = await runScriptCheck({ kind: 'script', key: 'long' }, { pipelineId: t.id, timeoutOf: async () => 7200000,
    runBench: async (req) => { reqs.push(req); return { status: 'clean' }; } });
  assert.equal(ok.met, true, JSON.stringify(ok));
  assert.equal(reqs[0].timeoutMs, 7200000);
  // the backstop is the declared timeout plus a margin, so a 2 h script is not cut at 10 minutes
  const real = global.setTimeout; const delays = [];
  global.setTimeout = (fn, ms, ...a) => { delays.push(ms); return real(fn, ms, ...a); };
  try { await runScriptCheck({ kind: 'script', key: 'long' }, { pipelineId: t.id, timeoutOf: async () => 7200000, runBench: async () => ({ status: 'clean' }) }); } finally { global.setTimeout = real; }
  assert.ok(delays.includes(7200000 + SCRIPT_CHECK_MARGIN_MS));
  // BUSY retries stop once the deadline fired
  let calls = 0;
  const r = await runScriptCheck({ kind: 'script', key: 'busy' }, { pipelineId: t.id, timeoutOf: async () => 1000, deadlineMs: 30, waitMs: 20,
    runBench: async () => { calls += 1; throw Object.assign(new Error('busy'), { code: 'BUSY' }); } });
  assert.equal(r.error, 'timed out');
  await new Promise((res) => setTimeout(res, 200));
  assert.ok(calls <= 3, `retried ${calls} times after the deadline`);
});

test('concern 8: an outcome says when Claude Code ignored Worca\'s settings for the try (the canary\'s mark in its run folder)', async () => {
  const t = await seedTry();
  assert.equal('settingsIgnored' in await readTryOutcome(t.id), false);
  await writeFile(join(t.dir, SETTINGS_IGNORED_FILE), 'x\n');
  assert.equal((await readTryOutcome(t.id)).settingsIgnored, true);
  // re-review 3 (m4): the verdict under a fresh name (a link at the usual name was refused) marks it too
  const u = await seedTry();
  await writeFile(join(u.dir, 'settings-ignored-0a1b2c3d4e5f6a7b.ndjson'), 'x\n');
  assert.equal((await readTryOutcome(u.id)).settingsIgnored, true);
});
