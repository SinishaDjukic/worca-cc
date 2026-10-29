// test/workflow-test-project-store.test.mjs — workflow tests 3a, Task 2 (D41, D53, D64): an example's project, its pinned
// start, the fingerprint, and what a try records.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { canon } from '../src/shared/graph/diff-graphs.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftps-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const pin = (over = {}) => ({ key: 'worca-cc-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z',
  startCommit: SHA, changes: null, setupCmd: 'npm ci', ...over });

test('a Part 2 example keeps its fingerprint byte for byte (D64)', () => {
  const ex = store.createExample('wf_p', { name: 'Brief', request: 'Write it.', checks: [{ kind: 'mentions', text: 'x' }] });
  const old = createHash('sha256').update(canon({ r: ex.request, f: [], a: ex.answers, o: ex.otherwise, b: ex.basics,
    c: ex.checks.map(({ id: _id, ...c }) => c) })).digest('hex').slice(0, 16);
  assert.equal(ex.fingerprint, old);
  assert.equal(ex.project, null);
});

test('an example with a project: stored, read back, and part of its fingerprint', () => {
  const ex = store.createExample('wf_p', { name: 'Ticket 482', request: 'Fix it.' }, { project: pin() });
  assert.deepEqual(ex.project, { key: 'worca-cc-1a2b3c4d', name: null, startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z',
    startCommit: SHA, changesSha256: null, changesBytes: 0, setupCmd: 'npm ci' });
  const fp = ex.fingerprint;
  const named = store.updateExample('wf_p', ex.id, {}, { project: pin({ name: 'worca-cc' }) });
  assert.deepEqual([named.project.name, named.fingerprint], ['worca-cc', fp], 'the name is kept with the pin, outside the fingerprint');
  assert.notEqual(store.updateExample('wf_p', ex.id, {}, { project: pin({ setupCmd: 'npm install' }) }).fingerprint, fp, 'the setup counts');
  assert.notEqual(store.updateExample('wf_p', ex.id, {}, { project: pin({ startCommit: SHA2, startSha: SHA2 }) }).fingerprint, fp, 'the start counts');
  assert.equal(store.updateExample('wf_p', ex.id, {}, { project: pin() }).fingerprint, fp, 'the same pin, the same fingerprint');
  assert.equal(store.updateExample('wf_p', ex.id, { note: 'n' }).project.startCommit, SHA, 'undefined keeps the pin');
  assert.equal(store.updateExample('wf_p', ex.id, {}, { project: null }).project, null, 'null removes it');
});

test('uncommitted changes are kept as bytes with their hash, at most 5 MB', () => {
  const changes = Buffer.from('diff --git a/x b/x\n');
  const ex = store.createExample('wf_p', { name: 'With changes', request: 'r' }, { project: pin({ changes, startCommit: SHA2 }) });
  assert.equal(ex.project.changesSha256, createHash('sha256').update(changes).digest('hex'));
  assert.equal(ex.project.changesBytes, changes.length);
  assert.deepEqual(store.readExampleChanges(ex.id), changes);
  assert.throws(() => store.createExample('wf_p', { name: 'Big', request: 'r' },
    { project: pin({ changes: Buffer.alloc(store.PIN_MAX_CHANGES + 1), startCommit: SHA2 }) }), /larger than 5 MB/);
});

test('a pin is checked before it is written', () => {
  const bad = (over, re) => assert.throws(() => store.createExample('wf_p', { name: 'x', request: 'r' }, { project: pin(over) }), re);
  bad({ key: 'Not a key' }, /project/);
  bad({ startSha: 'abc' }, /commit/);
  bad({ startCommit: '-x' }, /commit/);
  bad({ setupCmd: 'a\nb' }, /one line/);
  bad({ setupCmd: 'x'.repeat(store.SETUP_MAX + 1) }, /one line/);
  bad({ startRef: 'bad\u0000ref' }, /branch/);
});

test('the command check needs a project (the kind itself comes in Task 6; this refusal comes first)', () => {
  assert.throws(() => store.createExample('wf_p', { name: 'x', request: 'r', checks: [{ kind: 'command', cmd: 'npm test' }] }), /needs a project/);
});

test('deleting an example deletes its project row', () => {
  const ex = store.createExample('wf_p', { name: 'x', request: 'r' }, { project: pin({ changes: Buffer.from('p'), startCommit: SHA2 }) });
  store.deleteExample('wf_p', ex.id);
  assert.equal(store.readExampleChanges(ex.id), null);
});

test('a try records its start, disk, setup and changes; the last disk size and setup time are read back', () => {
  const ex = store.createExample('wf_p', { name: 'x', request: 'r' }, { project: pin() });
  const run = store.createTestRun({ workflowId: 'wf_p', kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: 'wf_p', exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  const changes = { files: [{ status: 'added', path: 'src/x.mjs', added: 3, removed: 0 }], counts: { added: 1, changed: 0, removed: 0 }, added: 3, removed: 0, total: 1 };
  const u = store.updateTry(t.id, { status: 'passed', startCommit: SHA, diskBytes: 1234, setup: { cmd: 'npm ci', ok: true, ms: 90000 }, changes });
  assert.deepEqual([u.startCommit, u.diskBytes, u.setup.ms, u.changes.total], [SHA, 1234, 90000, 1]);
  assert.equal(store.lastDiskBytes(ex.id, SHA), 1234);
  assert.equal(store.avgSetupMs(ex.id, SHA), 90000);
  assert.equal(store.lastDiskBytes(ex.id, SHA2), null);
});
