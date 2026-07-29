// test/workspace-runners.test.mjs
// M4: the runners.mjs wiring for the workspace agents.
//  - verifier(workspaceReviewer): routes to runWorkspaceReviewer; cycle 1 blocked,
//    cycle 2 ok (mock decreases blocking count so the loop terminates).
//  - the off-pipeline scanner has NO bespoke producer branch: dispatching it as a
//    node falls through to the generic producer (the off-pipeline contract is now
//    "no workflow ever declares it as a node", not a runner throw).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runners } from '../src/core/runners.mjs';

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-ws-runners-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const WS = {
  key: 'wks-demo-1a2b3c4d', name: 'Demo',
  description: '# Workspace: Demo\n\nTwo services share a REST contract.',
  projects: [
    { projectKey: 'iam-1a2b3c4d', projectName: 'iam', worktreeDir: '/wt/iam', checkpointRef: 'sha-iam' },
    { projectKey: 'ui-5e6f7a8b', projectName: 'ui', worktreeDir: '/wt/ui', checkpointRef: 'sha-ui' },
  ],
};

function ctxFor(dir, node, extra = {}) {
  return {
    projectDir: dir,
    pipelineDir: dir,
    taskPrompt: 'demo task',
    toolInstruction: '',
    agentPrompts: { workspaceReviewer: '', workspaceScanner: '' },
    checkpointRef: null,
    signal: undefined,
    onEvent: () => {},
    claudeOpts: { mock: true },
    workspace: WS,
    node,
    nodeId: node.nodeId,
    stepIndex: 0,
    cycle: 1,
    ...extra,
  };
}

test('verifier(workspaceReviewer) cycle 1 blocked, cycle 2 ok (mock decreases blocking)', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's3_0', key: 'workspaceReviewer', runnerType: 'verifier', loopSource: true };
  const c1 = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'ws-review.md'),
    reviewJsonPath: join(dir, 'ws-review-c1.json'),
    cycle: 1,
  }));
  assert.equal(c1.status, 'blocked', 'cycle 1 has blocking issues across members');
  assert.ok(Array.isArray(c1.issues) && c1.issues.length >= 1);
  assert.equal(c1.reviewMdPath, join(dir, 'ws-review.md'), 'threads md path so a loop rewind reads it');

  const c2 = await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'ws-review.md'),
    reviewJsonPath: join(dir, 'ws-review-c2.json'),
    cycle: 2,
  }));
  assert.equal(c2.status, 'ok', 'cycle 2 has only a suggestion -> loop terminates');
});

test('workspaceReviewer mock writes a merged union review (projectKey-prefixed locations)', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's3_0', key: 'workspaceReviewer', runnerType: 'verifier', loopSource: true };
  await runners.verifier(ctxFor(dir, node, {
    planPath: join(dir, 'plan.md'),
    reviewMdPath: join(dir, 'ws-review.md'),
    reviewJsonPath: join(dir, 'ws-review-c1.json'),
    cycle: 1,
  }));
  const json = JSON.parse(await readFile(join(dir, 'ws-review-c1.json'), 'utf8'));
  // The union must not be collapsed — cycle 1 carries one issue per member.
  assert.ok(json.issues.length >= 2, 'union of per-project issues, never collapsed');
  for (const i of json.issues) {
    assert.match(i.location, /^[a-z0-9-]+:/i, `location prefixed with "<projectKey>: " (${i.location})`);
  }
});

test('dispatching the off-pipeline scanner as a node no longer throws — generic producer', async () => {
  // Since the generic-runner fallthrough, an unknown producer key (including the
  // off-pipeline scanner) runs runGenericProducer instead of throwing. The scanner
  // stays off-pipeline because no workflow declares it as a node — not via a throw.
  const dir = await makeTmpDir();
  const node = { nodeId: 'x', key: 'workspaceScanner', runnerType: 'producer', loopSource: false };
  const res = await runners.producer(ctxFor(dir, node, { inputs: {}, outputs: {} }));
  assert.equal(res.status, 'ok');
  assert.ok(typeof res.summary === 'string' && res.summary.length > 0);
});
