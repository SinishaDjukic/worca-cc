// test/runners-generic.test.mjs
// Generic runners: an agent key with NO bespoke switch branch runs through
// runGenericProducer/runGenericVerifier — prompt = taskHeader + Inputs/Outputs
// channel->path lists + agent .md body; verifiers keep the protocol verdict shape.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runners } from '../src/core/runners.mjs';
import { genericIoBlock } from '../src/core/phases.mjs';

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-generic-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

function ctxFor(dir, node, extra = {}) {
  return {
    projectDir: dir, pipelineDir: dir, taskPrompt: 'demo task', toolInstruction: '',
    agentPrompts: {}, checkpointRef: null, signal: undefined, onEvent: () => {},
    claudeOpts: { mock: true }, node, nodeId: node.nodeId, stepIndex: 1, cycle: 1, ...extra,
  };
}

test('genericIoBlock lists input channel paths and output write instructions', () => {
  const block = genericIoBlock(
    { plan: { kind: 'artifact', path: '/pipe/plan.md' }, code: { kind: 'worktree' }, userPrompt: { kind: 'value' } },
    { spec: { kind: 'artifact', path: '/pipe/api-spec.md' } },
  );
  assert.match(block, /## Inputs/);
  assert.match(block, /- plan: \/pipe\/plan\.md/);
  assert.match(block, /- code: \(the working tree/);
  assert.doesNotMatch(block, /userPrompt/, 'the task header already carries the request');
  assert.match(block, /## Outputs/);
  assert.match(block, /Write spec to: \/pipe\/api-spec\.md/);
});

test('producer(custom key) runs generically and the mock writes the declared output', async () => {
  const dir = await makeTmpDir();
  const outPath = join(dir, 'api-spec.md');
  const node = { nodeId: 's9_0', key: 'specWriter', runnerType: 'producer', loopSource: false,
    agentPrompt: 'You are the Spec Writer.' };
  const res = await runners.producer(ctxFor(dir, node, {
    inputs: { plan: { kind: 'artifact', path: join(dir, 'plan.md') } },
    outputs: { spec: { kind: 'artifact', path: outPath, channel: 'spec' } },
  }));
  assert.equal(res.status, 'ok');
  assert.ok(typeof res.summary === 'string' && res.summary.length > 0);
  const body = await readFile(outPath, 'utf8');
  assert.ok(body.length > 0, 'generic mock wrote the declared output artifact');
});

test('verifier(custom key) emits a protocol verdict: cycle 1 blocked, cycle 2 ok', async () => {
  const dir = await makeTmpDir();
  const node = { nodeId: 's9_1', key: 'specAuditor', runnerType: 'verifier', loopSource: true,
    agentPrompt: 'You are the Spec Auditor.' };
  const out = (cycle) => ({
    review: { kind: 'review', mdPath: join(dir, `specAuditor-review-cycle${cycle}.md`),
      jsonPath: join(dir, `specAuditor-review-cycle${cycle}.json`), reviewKind: 'specAuditor-review' },
  });
  const c1 = await runners.verifier(ctxFor(dir, node, {
    inputs: { spec: { kind: 'artifact', path: join(dir, 'api-spec.md') } }, outputs: out(1), cycle: 1,
  }));
  assert.equal(c1.status, 'blocked', 'mock cycle 1 carries a major issue');
  assert.ok(Array.isArray(c1.issues) && c1.issues.length >= 1);
  assert.equal(c1.reviewMdPath, join(dir, 'specAuditor-review-cycle1.md'), 'md path threaded for loop rewinds');
  const c2 = await runners.verifier(ctxFor(dir, node, {
    inputs: { spec: { kind: 'artifact', path: join(dir, 'api-spec.md') } }, outputs: out(2), cycle: 2,
  }));
  assert.equal(c2.status, 'ok');
});
