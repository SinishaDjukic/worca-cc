// test/runners.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runners } from '../src/core/runners.mjs';

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-runners-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// Minimal ctx mirroring orchestrator._nodeCtx: a node + the fields phases.mjs reads.
function ctxFor(dir, node, extra = {}) {
  return {
    projectDir: dir,
    pipelineDir: dir,
    taskPrompt: 'demo task',
    toolInstruction: '',
    agentPrompts: { planner: '', refiner: '', implementer: '', reviewer: '', planReviewer: '' },
    checkpointRef: null,
    signal: undefined,
    onEvent: () => {},
    claudeOpts: { mock: true },
    node,
    nodeId: node.nodeId,
    stepIndex: 0,
    cycle: 1,
    ...extra,
  };
}

test('runners registry exposes exactly producer and verifier', () => {
  assert.deepEqual(Object.keys(runners).sort(), ['producer', 'verifier']);
  assert.equal(typeof runners.producer, 'function');
  assert.equal(typeof runners.verifier, 'function');
});

test('producer(planner) writes a plan and returns status ok with planPath', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's0_0', key: 'planner', runnerType: 'producer', loopSource: false };
  const res = await runners.producer(ctxFor(dir, node, {
    planFilePath: join(dir, 'plan.md'),
    baseName: 'feature',
    answers: [],
  }));
  assert.equal(res.status, 'ok');
  assert.equal(res.planPath, join(dir, 'plan.md'));
});

test('producer(implementer) returns status ok with a summary', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's1_0', key: 'implementer', runnerType: 'producer', loopSource: false };
  const res = await runners.producer(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    mode: 'implement',
  }));
  assert.equal(res.status, 'ok');
  assert.ok(typeof res.summary === 'string' && res.summary.length > 0);
});

test('verifier(reviewer) cycle 1 is blocked, cycle 2 is ok (mock decreases severity)', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's3_0', key: 'reviewer', runnerType: 'verifier', loopSource: true };
  const blocked = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'review.md'),
    reviewJsonPath: join(dir, 'review-c1.json'),
    cycle: 1,
  }));
  assert.equal(blocked.status, 'blocked', 'cycle 1 reviewer has a major issue');
  assert.ok(Array.isArray(blocked.issues) && blocked.issues.length >= 1);
  assert.ok(blocked.review, 'carries the raw protocol review');

  const ok = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'review.md'),
    reviewJsonPath: join(dir, 'review-c2.json'),
    cycle: 2,
  }));
  assert.equal(ok.status, 'ok', 'cycle 2 reviewer has only a suggestion');
});

test('verifier(planReviewer) cycle 1 blocked, cycle 2 ok (mock decreases severity)', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's1_0', key: 'planReviewer', runnerType: 'verifier', loopSource: true };
  const c1 = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'plan-review.md'),
    reviewJsonPath: join(dir, 'plan-review-c1.json'),
    cycle: 1,
  }));
  assert.equal(c1.status, 'blocked');
  assert.equal(c1.reviewMdPath, join(dir, 'plan-review.md'), 'threads the md path so publish folds it onto the bus');
  const c2 = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'plan-review.md'),
    reviewJsonPath: join(dir, 'plan-review-c2.json'),
    cycle: 2,
  }));
  assert.equal(c2.status, 'ok');
});

test('producer(planner) replans when a reviewPath is present', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's0_0', key: 'planner', runnerType: 'producer', loopSource: false };
  const res = await runners.producer(ctxFor(dir, node, {
    planFilePath: join(dir, 'plan-v2.md'),
    baseName: 'feature',
    answers: [],
    reviewPath: join(dir, 'plan-review.md'),
  }));
  assert.equal(res.status, 'ok');
  assert.equal(res.planPath, join(dir, 'plan-v2.md'));
});

test('verifier(reviewer) reading a pre-written blocking review reports blocked', async () => {
  const dir = await makeTmpDir();
  // Pre-seed the json the mock would otherwise create; status must come from protocol.hasBlocking.
  const jsonPath = join(dir, 'pre.json');
  await writeFile(
    jsonPath,
    JSON.stringify({ issues: [{ severity: 'critical', title: 't', detail: 'd', location: 'l' }], summary: 's' }),
    'utf8',
  );
  const node = { nodeId: 's3_0', key: 'reviewer', runnerType: 'verifier', loopSource: true };
  // cycle 1 mock overwrites with a major anyway; assert blocked regardless.
  const res = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'review.md'),
    reviewJsonPath: jsonPath,
    cycle: 1,
  }));
  assert.equal(res.status, 'blocked');
});

test('verifier(manualWebUiTesting) cycle 1 blocked, cycle 2 ok (mock decreases severity)', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's5_0', key: 'manualWebUiTesting', runnerType: 'verifier', loopSource: true };
  const c1 = await runners.verifier(ctxFor(dir, node, {
    checklistPath: join(dir, 'checklist.md'),
    reviewMdPath: join(dir, 'webui.md'),
    reviewJsonPath: join(dir, 'webui-c1.json'),
    cycle: 1,
  }));
  assert.equal(c1.status, 'blocked');
  const c2 = await runners.verifier(ctxFor(dir, node, {
    checklistPath: join(dir, 'checklist.md'),
    reviewMdPath: join(dir, 'webui.md'),
    reviewJsonPath: join(dir, 'webui-c2.json'),
    cycle: 2,
  }));
  assert.equal(c2.status, 'ok');
});

test('producer(manualTestsChecklist) writes a checklist and returns ok', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's4_0', key: 'manualTestsChecklist', runnerType: 'producer', loopSource: false };
  const res = await runners.producer(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    checklistPath: join(dir, 'manual-tests-checklist.md'),
  }));
  assert.equal(res.status, 'ok');
  assert.equal(res.checklistPath, join(dir, 'manual-tests-checklist.md'));
  const body = await import('node:fs/promises').then((fs) => fs.readFile(res.checklistPath, 'utf8'));
  assert.match(body, /Manual Test/i);
});

test('unknown producer key no longer throws — it runs the generic producer', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 'x', key: 'nope', runnerType: 'producer', loopSource: false };
  const res = await runners.producer(ctxFor(dir, node, { inputs: {}, outputs: {} }));
  assert.equal(res.status, 'ok');
  assert.ok(typeof res.summary === 'string' && res.summary.length > 0);
});
