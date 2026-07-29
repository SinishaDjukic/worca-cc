// test/channels-custom.test.mjs
// Open channel vocabulary: allocate() mints generic pipeline-dir paths for custom
// channels (channelDefs override kind/filename), publish() folds them onto the bus,
// custom verifier keys get their own review basenames (no impl-review clobber), and
// PRESEEDED_CHANNELS is the exported single source the validator derives from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, publish, legacyFields, PRESEEDED_CHANNELS } from '../src/core/channels.mjs';

const ALLOC = { projectDir: '/p', pipelineDir: '/pipe', baseName: 'feat', datePrefix: '03-06-26', cycle: 1 };

test('PRESEEDED_CHANNELS is exported and stable', () => {
  assert.deepEqual(PRESEEDED_CHANNELS, ['userPrompt', 'plan', 'checklist', 'code']);
});

test('allocate(custom, no def) mints <pipelineDir>/<id>.md, cycle-suffixed on re-runs', () => {
  assert.deepEqual(allocate('spec', { ...ALLOC, key: 'specWriter' }),
    { kind: 'artifact', path: '/pipe/spec.md', channel: 'spec' });
  assert.equal(allocate('spec', { ...ALLOC, key: 'specWriter', cycle: 2 }).path, '/pipe/spec-cycle2.md');
});

test('allocate(custom, with def) honors kind json + filename', () => {
  const channelDefs = { spec: { id: 'spec', kind: 'json', filename: 'api-spec.json' } };
  assert.equal(allocate('spec', { ...ALLOC, channelDefs }).path, '/pipe/api-spec.json');
  assert.equal(allocate('spec', { ...ALLOC, channelDefs, cycle: 3 }).path, '/pipe/api-spec-cycle3.json');
});

test('allocate(review) for a CUSTOM verifier key mints its own basenames (no impl-review clobber)', () => {
  const r = allocate('review', { ...ALLOC, key: 'specAuditor' });
  assert.equal(r.jsonPath, '/pipe/specAuditor-review-cycle1.json');
  assert.equal(r.mdPath, '/pipe/specAuditor-review-cycle1.md');
  assert.equal(r.reviewKind, 'specAuditor-review');
});

test('allocate(review) built-in keys are byte-identical to before', () => {
  assert.match(allocate('review', { ...ALLOC, key: 'reviewer' }).mdPath, /-feat-impl-review\.md$/);
  assert.match(allocate('review', { ...ALLOC, key: 'reviewer' }).jsonPath, /\/impl-review-cycle1\.json$/);
  assert.equal(allocate('review', { ...ALLOC, key: 'refiner' }).mdPath, null);
  assert.match(allocate('review', { ...ALLOC, key: 'planReviewer' }).mdPath, /-feat-plan-review\.md$/);
  assert.match(allocate('review', { ...ALLOC, key: 'manualWebUiTesting' }).mdPath, /\/webui-review-cycle1\.md$/);
  assert.match(allocate('review', { ...ALLOC, key: 'workspaceReviewer' }).mdPath, /-feat-ws-review\.md$/);
});

test('publish folds a custom channel artifact onto the bus; absent path is not folded', () => {
  const bus = {};
  publish(['spec'], { summary: 'ok' }, { spec: { kind: 'artifact', path: '/pipe/spec.md' } }, bus);
  assert.deepEqual(bus.spec, { kind: 'artifact', path: '/pipe/spec.md' });
  const bus2 = {};
  publish(['spec'], { summary: 'ok' }, { spec: null }, bus2);
  assert.equal('spec' in bus2, false);
});

test('legacyFields default branch returns the generic { cycle, inputs, outputs }', () => {
  const inputs = { spec: { kind: 'artifact', path: '/pipe/spec.md' } };
  const outputs = { metrics: { kind: 'artifact', path: '/pipe/metrics.md' } };
  assert.deepEqual(legacyFields({ key: 'specAuditor' }, inputs, outputs, 2, 'feat'),
    { cycle: 2, inputs, outputs });
});
