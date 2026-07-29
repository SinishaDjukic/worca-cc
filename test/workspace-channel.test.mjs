// test/workspace-channel.test.mjs
// M4: the workspace channel/review wiring the two new agents depend on. The
// produces===['workspace'] canary (the §6.9 ordering hazard) and the
// workspaceReviewer arm in allocate('review') + legacyFields (mirrors `reviewer`).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHANNEL_IDS, allocate, legacyFields } from '../src/core/channels.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

const ALLOC = { projectDir: '/p', pipelineDir: '/pipe', baseName: 'feat', datePrefix: '05-06-26', cycle: 2 };
const WS_KEY = 'wks-demo-1a2b3c4d';

test('CHANNEL_IDS contains "workspace" BEFORE the sidecars load (hard ordering dep)', () => {
  assert.ok(CHANNEL_IDS.includes('workspace'),
    '"workspace" must be in CHANNEL_IDS or produces:["workspace"] silently collapses');
});

test('CANARY: the scanner sidecar keeps produces:["workspace"] (id list + sidecar in sync)', () => {
  const reg = loadAgentRegistry();
  assert.deepEqual(reg.workspaceScanner.produces, ['workspace'],
    'if this is [] the channel id was missing when the sidecar loaded (§6.9)');
});

test('allocate(review) for workspaceReviewer uses a ws-review base + workspace store md path', () => {
  const h = allocate('review', { ...ALLOC, key: 'workspaceReviewer', workspaceKey: WS_KEY });
  assert.equal(h.kind, 'review');
  assert.equal(h.reviewKind, 'ws-review');
  assert.match(h.mdPath, new RegExp(`/store/workspaces/${WS_KEY}/reviews/05-06-26-feat-ws-review\\.md$`));
  // The json verdict stays per-cycle in the pipeline dir (store-root independent).
  assert.match(h.jsonPath, /\/pipe\/ws-review-cycle2\.json$/);
});

test('allocate(review) for the single-project reviewer is unchanged (byte-identity)', () => {
  const h = allocate('review', { ...ALLOC, key: 'reviewer' });
  assert.equal(h.reviewKind, 'impl-review');
  assert.match(h.jsonPath, /\/impl-review-cycle2\.json$/);
});

test('legacyFields(workspaceReviewer) threads the same fields as reviewer', () => {
  const inputs = { plan: { path: '/plan.md' }, code: { kind: 'worktree' } };
  const outputs = { review: { mdPath: '/pipe/ws.md', jsonPath: '/pipe/ws.json' } };
  const wsR = legacyFields({ key: 'workspaceReviewer' }, inputs, outputs, 3, 'feat');
  const r = legacyFields({ key: 'reviewer' }, inputs, outputs, 3, 'feat');
  assert.deepEqual(wsR, r, 'workspaceReviewer ctx fields mirror reviewer exactly');
  assert.equal(wsR.planPath, '/plan.md');
  assert.equal(wsR.reviewMdPath, '/pipe/ws.md');
  assert.equal(wsR.reviewJsonPath, '/pipe/ws.json');
  assert.equal(wsR.cycle, 3);
});
