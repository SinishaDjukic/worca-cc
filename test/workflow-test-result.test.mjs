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
import { mainResult, readTryOutcome, checkTry, runScriptCheck } from '../src/core/workflow-tests/result.mjs';
import { normaliseCheck } from '../src/shared/workflow-tests/checks.mjs';

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
  assert.deepEqual(gone, { met: false, value: 'Not met', error: 'script "nope" not found' });
});
