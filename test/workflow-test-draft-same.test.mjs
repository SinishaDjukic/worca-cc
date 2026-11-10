// test/workflow-test-draft-same.test.mjs — U-T7 (F13, D7): a draft whose useFingerprint equals a saved version's is not a
// new version. testsOverview names the newest such version (draftSameAs) and drops the draft column; testPlan's draft
// side carries the same check (sameAs).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORCA_FLAGS = 'workflowTests';
const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
const { createVersion } = await import('../src/core/workflow-versions.mjs');
const { _resetForTests } = await import('../src/core/db.mjs');
const service = await import('../src/core/workflow-tests/service.mjs');

const homes = [];
let deps;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftsame-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  const md = join(dir, 'planner.md');
  await writeFile(md, 'Plan it.');
  deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {} };
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const tpl = (name = 'Same') => ({
  id: 'wf_same', name, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
const fps = (map) => async (_id, use) => { if (!(use in map)) throw new Error('no fingerprint'); return map[use]; };

async function threeVersions() {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_same', { deps });
  await writeGraphWorkflow(tpl('Same 2'));
  await createVersion('wf_same', { deps });
  await writeGraphWorkflow(tpl('Same 3'));
  await createVersion('wf_same', { deps });
}

test('an identical draft: draftSameAs is the newest version with the draft\'s fingerprint, and there is no draft column', async () => {
  await threeVersions();
  const fingerprintOf = fps({ 1: 'A', 2: 'D', 3: 'D', draft: 'D' });
  const o = await service.testsOverview('wf_same', { registry: deps.registry, fingerprintOf });
  assert.equal(o.draftSameAs, 3);
  assert.deepEqual(o.columns.map((c) => c.use), [1], 'only the version in use (v1): the draft is not a column');
});

test('an older version that matches counts too', async () => {
  await threeVersions();
  const o = await service.testsOverview('wf_same', { registry: deps.registry, fingerprintOf: fps({ 1: 'D', 2: 'B', 3: 'C', draft: 'D' }) });
  assert.equal(o.draftSameAs, 1);
});

test('a changed draft: draftSameAs is null and the draft column stays', async () => {
  await threeVersions();
  const o = await service.testsOverview('wf_same', { registry: deps.registry, fingerprintOf: fps({ 1: 'A', 2: 'B', 3: 'C', draft: 'D' }) });
  assert.equal(o.draftSameAs, null);
  assert.deepEqual(o.columns.map((c) => c.use), [1, 'draft']);
});

test('a fingerprint that cannot be read is never "the same"', async () => {
  await threeVersions();
  const o = await service.testsOverview('wf_same', { registry: deps.registry, fingerprintOf: fps({}) });
  assert.equal(o.draftSameAs, null);
});

test('testPlan: the draft side names the version it equals (sameAs); other sides do not', async () => {
  await threeVersions();
  const same = await service.testPlan('wf_same', { a: 1, b: 'draft', tries: 1 }, { fingerprintOf: fps({ 1: 'A', 2: 'D', 3: 'C', draft: 'D' }) });
  assert.deepEqual([same.a.sameAs, same.b.sameAs], [null, 2]);
  const diff = await service.testPlan('wf_same', { a: 1, b: 'draft', tries: 1 }, { fingerprintOf: fps({ 1: 'A', 2: 'D', 3: 'C', draft: 'E' }) });
  assert.equal(diff.b.sameAs, null);
});
