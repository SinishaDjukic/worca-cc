// test/workflow-test-store.test.mjs — examples, files, runs and tries (plans/workflow-tests-part2-plan.md Task 2, D26, D31).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftstore-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const WF = 'wf_brief';
const input = (over = {}) => ({
  name: 'Bulk invoice export', request: 'Write the product brief for a bulk invoice export.',
  answers: [{ question: 'Which file formats?', answer: 'PDF and CSV, in one ZIP file.' }],
  otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: 1.5 },
  checks: [{ kind: 'words', min: 400, max: 900 }], tries: 3, ...over,
});

test('create, read, list and update an example; new checks get an id', () => {
  const ex = store.createExample(WF, input(), { by: 'Tomica' });
  assert.equal(ex.name, 'Bulk invoice export');
  assert.match(ex.checks[0].id, /^c_[0-9a-f]{10}$/);
  assert.deepEqual(ex.basics, { noError: true, noHelp: true, maxCostUsd: 1.5, maxSentBack: null });
  assert.equal(ex.createdBy, 'Tomica');
  assert.match(ex.fingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(store.listExamples(WF).map((e) => e.id), [ex.id]);
  const up = store.updateExample(WF, ex.id, { name: 'Bulk export', tries: 5 });
  assert.deepEqual([up.name, up.tries, up.checks[0].id], ['Bulk export', 5, ex.checks[0].id]);
  assert.equal(store.readExample('wf_other', ex.id), null);
  assert.throws(() => store.updateExample(WF, 999, {}), { code: 'NOT_FOUND' });
  assert.throws(() => store.createExample(WF, input({ name: ' ' })), { code: 'BAD_REQUEST', message: 'the name must be 1 to 120 characters' });
  assert.throws(() => store.createExample(WF, input({ tries: 4 })), { message: 'tries must be 1, 3 or 5' });
  assert.throws(() => store.createExample(WF, input({ checks: [{ kind: 'words' }] })), { message: 'give a smallest or a largest number of words' });
});

test('the fingerprint follows what a try gets and how it is judged, not the name, note or tries (D26)', () => {
  const ex = store.createExample(WF, input());
  const same = (over) => store.updateExample(WF, ex.id, over).fingerprint;
  assert.equal(same({ name: 'Renamed', note: 'A note', tries: 1 }), ex.fingerprint);
  assert.notEqual(same({ request: 'Another request' }), ex.fingerprint);
  const b = store.updateExample(WF, ex.id, { request: ex.request });
  assert.equal(b.fingerprint, ex.fingerprint);
  assert.notEqual(same({ otherwise: 'fail' }), ex.fingerprint);
  store.updateExample(WF, ex.id, { otherwise: 'pick' });
  assert.notEqual(store.putExampleFile(WF, ex.id, { name: 'notes.md', data: Buffer.from('# Notes') }).fingerprint, ex.fingerprint);
});

test('files: stored as bytes, replaced by name, refused when too large, too many or oddly named', () => {
  const ex = store.createExample(WF, input());
  let e = store.putExampleFile(WF, ex.id, { name: 'interview-notes.md', data: Buffer.from('hello') });
  assert.deepEqual(e.files.map((f) => [f.name, f.size]), [['interview-notes.md', 5]]);
  e = store.putExampleFile(WF, ex.id, { name: 'interview-notes.md', data: Buffer.from('hello again') });
  assert.equal(e.files[0].size, 11);
  assert.deepEqual(store.readExampleFiles(ex.id).map((f) => [f.name, f.data.toString()]), [['interview-notes.md', 'hello again']]);
  assert.throws(() => store.putExampleFile(WF, ex.id, { name: '../x.md', data: Buffer.from('x') }), { code: 'BAD_REQUEST' });
  assert.throws(() => store.putExampleFile(WF, ex.id, { name: 'big.bin', data: Buffer.alloc(store.FILE_MAX_BYTES + 1) }), { message: 'big.bin is larger than 5 MB' });
  for (let i = 1; i < store.FILES_MAX; i += 1) store.putExampleFile(WF, ex.id, { name: `f${i}.txt`, data: Buffer.from('x') });
  assert.throws(() => store.putExampleFile(WF, ex.id, { name: 'one-more.txt', data: Buffer.from('x') }), { message: 'an example has at most 8 files' });
  assert.equal(store.deleteExampleFile(WF, ex.id, 'f1.txt').files.length, store.FILES_MAX - 1);
});

test('files: a name Windows cannot write is refused (reserved names, a trailing dot or space, a case-only twin)', () => {
  const ex = store.createExample(WF, input());
  store.putExampleFile(WF, ex.id, { name: 'Notes.md', data: Buffer.from('a') });
  const plain = { code: 'BAD_REQUEST', message: 'give the file a plain name, such as notes.md' };
  for (const name of ['con', 'NUL', 'nul.txt', 'Aux.md', 'prn', 'com1', 'COM9.log', 'lpt3', 'lpt0.txt', 'notes.', 'notes.md.', 'notes.md ', 'notes ', 'notes.MD', 'NOTES.md']) {
    assert.throws(() => store.putExampleFile(WF, ex.id, { name, data: Buffer.from('x') }), plain, JSON.stringify(name));
  }
  assert.equal(store.putExampleFile(WF, ex.id, { name: 'Notes.md', data: Buffer.from('again') }).files[0].size, 5, 'the exact same name replaces');
  for (const name of ['console.md', 'nullable.txt', 'com10.txt', 'my.con.md']) store.putExampleFile(WF, ex.id, { name, data: Buffer.from('x') });
  assert.deepEqual(store.readExample(WF, ex.id).files.map((f) => f.name), ['Notes.md', 'com10.txt', 'console.md', 'my.con.md', 'nullable.txt']);
});

test('uses are stored as text: draft or a version number', () => {
  assert.deepEqual([store.parseUse('draft'), store.parseUse('4'), store.parseUse(4), store.parseUse('0'), store.parseUse('x')], ['draft', 4, 4, null, null]);
  assert.deepEqual([store.useRef('draft'), store.useRef(4), store.useOf('4'), store.useOf('draft')], ['draft', '4', 4, 'draft']);
});

test('runs and tries: reuse only finished tries with the same fingerprints, mock setting and connectors mode', () => {
  const ex = store.createExample(WF, input());
  const run = store.createTestRun({ workflowId: WF, a: 4, b: 'draft', aFp: 'fa', bFp: 'fb', exampleIds: [ex.id], tries: 3, capUsd: 15, by: 'Tomica' });
  assert.deepEqual([run.a, run.b, run.status, run.exampleIds, run.capUsd, run.connectors], [4, 'draft', 'running', [ex.id], 15, 'pretend']);
  assert.equal(store.createTestRun({ workflowId: 'wf_real', b: 'draft', bFp: 'x', exampleIds: [ex.id], tries: 1, connectors: 'real' }).connectors, 'real');
  assert.equal(store.runningTestRun(WF).id, run.id);
  const mk = (n, status, over = {}) => {
    const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 4, fp: 'fa', exampleFp: ex.fingerprint, tryNo: n, ...over });
    store.linkTry(run.id, t.id, 'a');
    return store.updateTry(t.id, { status, costUsd: 0.5, finishedAt: `2026-10-26T10:0${n}:00Z`, verdict: { passed: status === 'passed' } });
  };
  mk(1, 'passed'); mk(2, 'failed'); mk(3, 'stopped'); mk(4, 'passed', { mock: true }); mk(5, 'passed', { connectors: 'real' });
  const reuse = (over = {}) => store.reusableTries({ workflowId: WF, exampleId: ex.id, use: 4, fp: 'fa', exampleFp: ex.fingerprint, mock: false, limit: 3, ...over });
  assert.deepEqual(reuse().map((t) => t.tryNo), [2, 1]);
  assert.deepEqual(reuse({ fp: 'changed' }), []);
  assert.deepEqual(reuse({ exampleFp: 'changed' }), []);
  assert.deepEqual(reuse({ mock: true }).map((t) => t.tryNo), [4]);
  assert.deepEqual(reuse({ connectors: 'real' }).map((t) => [t.tryNo, t.connectors]), [[5, 'real']], 'D35: pretend and real are never reused for each other');
  assert.equal(store.readTry(reuse()[0].id).connectors, 'pretend');
  assert.equal(store.spentOfRun(run.id), 2.5);
  assert.deepEqual(store.triesOfRun(run.id).map((t) => [t.tryNo, t.side]), [[1, 'a'], [2, 'a'], [3, 'a'], [4, 'a'], [5, 'a']]);
  assert.deepEqual(store.latestTriesFor({ workflowId: WF, exampleId: ex.id, use: 4 }).map((t) => t.status), ['passed', 'failed', 'passed', 'passed']);
  const done = store.updateTestRun(run.id, { status: 'done', finishedAt: '2026-10-26T11:00:00Z' });
  assert.deepEqual([done.status, done.stopReason], ['done', null]);
  assert.equal(store.runningTestRun(WF), null);
});

test('deleting an example refuses while a test tries it; a restart stops running tests and tries, keeps their cost, drops their resume point', () => {
  const ex = store.createExample(WF, input());
  const run = store.createTestRun({ workflowId: WF, a: 1, b: 'draft', aFp: 'a', bFp: 'b', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'b', exampleFp: ex.fingerprint, tryNo: 1 });
  store.updateTry(t.id, { status: 'running', pipelineId: 'abcd1234' });
  // The try's run, as the boot reconcile leaves it: interrupted, with a resume point and what it spent so far.
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test, resume_point, total_cost_usd)
    VALUES ('abcd1234', 'no-project-00000000', 'interrupted', 1, '{"version":2}', 0.75)`).run();
  assert.throws(() => store.deleteExample(WF, ex.id), { code: 'BUSY' });
  const out = store.recoverInterruptedTestRuns();
  assert.deepEqual([out.runs, out.tries], [1, [{ id: t.id, pipelineId: 'abcd1234' }]]);
  assert.deepEqual([store.readTestRun(run.id).status, store.readTestRun(run.id).stopReason, store.readTry(t.id).status], ['stopped', 'restart', 'stopped']);
  assert.equal(store.readTry(t.id).costUsd, 0.75, 'its cost so far counts in the test (Finish the rest checks the cap with it)');
  assert.equal(getDb().prepare("SELECT resume_point FROM pipelines WHERE id = 'abcd1234'").get().resume_point, null, 'a try never resumes, so nothing pins it');
  assert.equal(store.deleteExample(WF, ex.id), true);
  assert.equal(store.readExample(WF, ex.id), null);
  assert.deepEqual(store.readExampleFiles(ex.id), []);
});
