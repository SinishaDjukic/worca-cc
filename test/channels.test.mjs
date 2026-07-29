import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, bindInputs, publish, legacyFields, CHANNEL_IDS } from '../src/core/channels.mjs';
import { reviewKindOf } from '../src/core/artifacts.mjs';

const ALLOC = { projectDir: '/p', pipelineDir: '/pipe', baseName: 'feat', datePrefix: '03-06-26', cycle: 1 };

test('CHANNEL_IDS is the closed set (workspace added in M3)', () => {
  assert.deepEqual([...CHANNEL_IDS].sort(),
    ['checklist', 'clarify', 'code', 'decomposition', 'plan', 'review', 'userPrompt', 'workspace']);
});

test('▲ C1: allocate mints the planner plan at v1 and the refiner plan at cycle+1', () => {
  const planner = allocate('plan', { ...ALLOC, key: 'planner', cycle: 1 });
  const refiner = allocate('plan', { ...ALLOC, key: 'refiner', cycle: 1 });
  assert.match(planner.path, /\/plans\/03-06-26-feat\.md$/);      // canonical v1, NO -v suffix
  assert.match(refiner.path, /\/plans\/03-06-26-feat-v2\.md$/);   // refiner versions up
  assert.notEqual(planner.path, refiner.path, 'planner v1 must differ from refiner v2');
  const replan = allocate('plan', { ...ALLOC, key: 'planner', cycle: 2 });
  assert.match(replan.path, /\/plans\/03-06-26-feat-v2\.md$/); // replanned planner versions up (no clobber)
});

test('allocate review: reviewer/web-ui carry an md; ▲ C2: refiner md is null', () => {
  const rev = allocate('review', { ...ALLOC, key: 'reviewer' });
  assert.match(rev.jsonPath, /\/impl-review-cycle1\.json$/);
  assert.match(rev.mdPath, /-feat-impl-review\.md$/);
  const refine = allocate('review', { ...ALLOC, key: 'refiner' });
  assert.match(refine.jsonPath, /\/refine-review-cycle1\.json$/);
  assert.equal(refine.mdPath, null, 'refiner review is private (no md)');
  const web = allocate('review', { ...ALLOC, key: 'manualWebUiTesting' });
  assert.match(web.mdPath, /\/webui-review-cycle1\.md$/);
  assert.equal(allocate('code', ALLOC).kind, 'worktree');
  const planRev = allocate('review', { ...ALLOC, key: 'planReviewer' });
  assert.match(planRev.jsonPath, /\/plan-review-cycle1\.json$/);
  assert.match(planRev.mdPath, /-feat-plan-review\.md$/, 'plan-review md is non-null so it publishes to the bus');
  // reviewKind tags each review with its provenance (the implementer gate reads this)
  assert.equal(allocate('review', { ...ALLOC, key: 'planReviewer' }).reviewKind, 'plan-review');
  assert.equal(allocate('review', { ...ALLOC, key: 'reviewer' }).reviewKind, 'impl-review');
});

test('bindInputs reads latest values; optional null omitted, required null passes through', () => {
  const bus = { plan: { kind: 'artifact', path: '/x.md' }, review: null };
  const got = bindInputs(['plan', 'review'], ['review'], bus);
  assert.deepEqual(got.plan, { kind: 'artifact', path: '/x.md' });
  assert.equal('review' in got, false); // null optional channel omitted
  const got2 = bindInputs(['plan'], [], { plan: null });
  assert.equal(got2.plan, null);        // required null passes through
});

test('publish folds plan/review/checklist and clears review on code', () => {
  // plan fold
  const bus = { plan: null, review: null, checklist: null };
  publish(['plan'], { planPath: '/p/v1.md' }, { plan: { path: '/p/v1.md' } }, bus);
  assert.equal(bus.plan.path, '/p/v1.md');
  // review fold (reviewer: has md)
  publish(['review'], { review: { ok: true }, reviewMdPath: '/r.md' }, { review: { mdPath: '/r.md', jsonPath: '/r.json' } }, bus);
  assert.equal(bus.review.mdPath, '/r.md');
  assert.deepEqual(bus.review.verdict, { ok: true });
  // ▲ C2: refiner review (no md) is NOT folded
  const bus2 = { review: null };
  publish(['review'], { review: { ok: false } }, { review: { mdPath: null, jsonPath: '/refine.json' } }, bus2);
  assert.equal(bus2.review, null, 'md-less (refiner) review must not reach the shared channel');
  // clear on code
  const bus3 = { review: { kind: 'review', mdPath: '/r.md' }, code: { kind: 'worktree' } };
  publish(['code'], { summary: 'done' }, {}, bus3);
  assert.equal(bus3.review, null, 'review cleared on code publish (fix-mode reset)');
});

test('▲ C3: legacyFields reproduces the runner ABI for ALL six roles', () => {
  const baseName = 'feat';
  // planner (no review -> normal plan; reviewPath threaded as undefined)
  assert.deepEqual(
    legacyFields({ key: 'planner' }, { userPrompt: { answers: ['a'] } }, { plan: { path: '/v1.md' } }, 1, baseName),
    { planFilePath: '/v1.md', baseName: 'feat', answers: ['a'], reviewPath: undefined },
  );
  // planner (review bound -> replan: reviewPath flows through)
  assert.equal(
    legacyFields({ key: 'planner' }, { userPrompt: { answers: [] }, review: { mdPath: '/pr.md' } }, { plan: { path: '/v2.md' } }, 2, baseName).reviewPath,
    '/pr.md',
  );
  // refiner
  assert.deepEqual(
    legacyFields({ key: 'refiner' }, { plan: { path: '/in.md' } }, { plan: { path: '/out.md' }, review: { jsonPath: '/rj.json' } }, 2, baseName),
    { inPlanPath: '/in.md', outPlanPath: '/out.md', reviewJsonPath: '/rj.json', cycle: 2 },
  );
  // implementer: review present (md) => fix
  const fix = legacyFields({ key: 'implementer' }, { plan: { path: '/p.md' }, review: { mdPath: '/r.md' } }, {}, 2, baseName);
  assert.equal(fix.planPath, '/p.md'); assert.equal(fix.reviewPath, '/r.md'); assert.equal(fix.mode, 'fix');
  // implementer: no review => implement
  assert.equal(legacyFields({ key: 'implementer' }, { plan: { path: '/p.md' } }, {}, 1, baseName).mode, 'implement');
  // implementer: present-but-md-less review => still implement (defensive ?.mdPath)
  assert.equal(legacyFields({ key: 'implementer' }, { plan: { path: '/p.md' }, review: { mdPath: null } }, {}, 1, baseName).mode, 'implement');
  // implementer: a plan-review on the bus must NOT flip a first-pass implementer into fix
  assert.equal(legacyFields({ key: 'implementer' }, { plan: { path: '/p.md' }, review: { mdPath: '/pr.md', reviewKind: 'plan-review' } }, {}, 1, baseName).mode, 'implement');
  // implementer: a code (impl) review on a linear forward edge DOES fix, even at cycle 1
  assert.equal(legacyFields({ key: 'implementer' }, { plan: { path: '/p.md' }, review: { mdPath: '/r.md', reviewKind: 'impl-review' } }, {}, 1, baseName).mode, 'fix');
  // reviewer
  assert.deepEqual(
    legacyFields({ key: 'reviewer' }, { plan: { path: '/p.md' } }, { review: { mdPath: '/r.md', jsonPath: '/r.json' } }, 1, baseName),
    { planPath: '/p.md', reviewMdPath: '/r.md', reviewJsonPath: '/r.json', cycle: 1 },
  );
  // manualTestsChecklist
  assert.deepEqual(
    legacyFields({ key: 'manualTestsChecklist' }, { plan: { path: '/p.md' } }, { checklist: { path: '/c.md' } }, 1, baseName),
    { planPath: '/p.md', checklistPath: '/c.md' },
  );
  // manualWebUiTesting
  assert.deepEqual(
    legacyFields({ key: 'manualWebUiTesting' }, { checklist: { path: '/c.md' } }, { review: { mdPath: '/w.md', jsonPath: '/w.json' } }, 3, baseName),
    { checklistPath: '/c.md', reviewMdPath: '/w.md', reviewJsonPath: '/w.json', cycle: 3 },
  );
  // planReviewer (verifier): consumes plan, mints review md+json
  assert.deepEqual(
    legacyFields({ key: 'planReviewer' }, { plan: { path: '/p.md' } }, { review: { mdPath: '/pr.md', jsonPath: '/pr.json' } }, 1, baseName),
    { planPath: '/p.md', reviewMdPath: '/pr.md', reviewJsonPath: '/pr.json', cycle: 1 },
  );
});

// ── Task 3.12 — allocate() surfaces a stable reviewKind for the reviews-table map ──
// Verification-only: no production change. allocate('review') already mints the FS
// json path the agent writes AND carries reviewKind, the exact discriminator Task
// 3.11's reviews-table mapping (reviewKindOf) consumes. Pin it for all 5 verifiers.
test('allocate(review) exposes a stable reviewKind for the reviews-table mapping', () => {
  const ctx = { projectDir: '/p', pipelineDir: '/p/dir', baseName: 'feat', datePrefix: '01-06-26', cycle: 1 };
  assert.equal(allocate('review', { ...ctx, key: 'reviewer' }).reviewKind, 'impl-review');
  assert.equal(allocate('review', { ...ctx, key: 'refiner' }).reviewKind, 'refine-review');
  assert.equal(allocate('review', { ...ctx, key: 'planReviewer' }).reviewKind, 'plan-review');
  assert.equal(allocate('review', { ...ctx, key: 'workspaceReviewer' }).reviewKind, 'ws-review');
  assert.equal(allocate('review', { ...ctx, key: 'manualWebUiTesting' }).reviewKind, 'webui-review');
  // A2: the discriminator maps cleanly onto the 5-value reviews.kind open set.
  assert.deepEqual(
    ['reviewer', 'refiner', 'planReviewer', 'workspaceReviewer', 'manualWebUiTesting']
      .map((key) => reviewKindOf(allocate('review', { ...ctx, key }).reviewKind)).sort(),
    ['impl', 'plan', 'refine', 'webui', 'ws']);
});
