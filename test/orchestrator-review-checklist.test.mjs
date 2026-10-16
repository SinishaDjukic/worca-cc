// test/orchestrator-review-checklist.test.mjs — the orchestrator's checklist merge (spec D7, slice 3): the approved
// plan's items are read, merged into the reviewer's verdict before it is routed and stored, and the findings are
// written into the review Markdown the Implementer reads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { wellShapedPlan } from './helpers/shape-plan.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

const scratch = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cl-orch-')); scratch.push(d); return d; };
after(async () => { for (const d of scratch) await rm(d, { recursive: true, force: true }); });

const SHAPE = { perspectives: ['product', 'architect', 'qa'] };
const orch = () => createOrchestrator({ projectDir: gitDir('cl'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: SHAPE });
const ITEMS = [
  { id: 'R-arch-1', perspective: 'architect', text: 'Defs.' },
  { id: 'R-qa-1', perspective: 'qa', text: 'Rejects.' },
];
const CL = [{ id: 'R-arch-1', status: 'met', evidence: 'a' }, { id: 'R-qa-1', status: 'na', evidence: '' }];

test('_applyReviewChecklist without items', async () => {
  const o = orch();
  const clean = { verdict: { issues: [], summary: 's' } };
  assert.equal(await o._applyReviewChecklist({}, clean), clean, 'the same result object');
  const withCl = { verdict: { issues: [], summary: 's', checklist: CL }, warnings: ['w'] };
  const out = await o._applyReviewChecklist({ checklistItems: [] }, withCl);
  assert.equal(Object.hasOwn(out.verdict, 'checklist'), false);
  assert.deepEqual(out.warnings, ['w']);
  const noVerdict = { warnings: [] };
  assert.equal(await o._applyReviewChecklist({}, noVerdict), noVerdict);
});

test('_applyReviewChecklist with items', async () => {
  const o = orch();
  const dir = await tmp();
  const path = join(dir, 'review.md');
  const ctx = { checklistItems: ITEMS, outputs: { review: { path } }, startedMs: Date.now() - 1000, ordinal: 2 };

  const ok = await o._applyReviewChecklist(ctx, { verdict: { issues: [], summary: 's', checklist: CL }, warnings: ['w'] });
  assert.deepEqual(ok.verdict.issues, []);
  assert.equal(ok.verdict.checklist.length, 2);
  assert.deepEqual(ok.warnings, ['w']);
  await assert.rejects(readFile(path, 'utf8'), { code: 'ENOENT' }, 'nothing written when nothing was added');

  const missing = await o._applyReviewChecklist(ctx, { verdict: { issues: [], summary: '', missing: true } });
  assert.equal(missing.verdict.issues.length, 1);
  assert.equal(missing.verdict.issues[0].severity, 'major');
  assert.equal(Object.hasOwn(missing.verdict, 'missing'), false);
  const fresh = await readFile(path, 'utf8');
  assert.match(fresh, /^# Implementation Review \(cycle 2\)/);
  assert.match(fresh, /## Perspective checklist \(added by Worca\)/);
});

test('findings are appended to a review file written this execution, replace a stale one, and create an absent one', async () => {
  const o = orch();
  const dir = await tmp();
  const path = join(dir, 'review.md');
  const unmet = { verdict: { issues: [], summary: '', checklist: [{ id: 'R-arch-1', status: 'unmet', evidence: 'no' }, { id: 'R-qa-1', status: 'na', evidence: '' }] } };
  const ctx = (startedMs) => ({ checklistItems: ITEMS, outputs: { review: { path } }, startedMs, ordinal: 1 });

  await writeFile(path, '# Review\n\nThe reviewer text.\n', 'utf8');
  await o._applyReviewChecklist(ctx(Date.now() - 5000), unmet);
  let text = await readFile(path, 'utf8');
  assert.match(text, /^# Review\n\nThe reviewer text\./);
  assert.match(text, /## Perspective checklist \(added by Worca\)[\s\S]*R-arch-1 not met/);

  await writeFile(path, '# Old cycle\n', 'utf8');
  const old = new Date(Date.now() - 60000);
  await utimes(path, old, old);
  await o._applyReviewChecklist(ctx(Date.now() - 1000), unmet);
  text = await readFile(path, 'utf8');
  assert.ok(!text.includes('Old cycle'));
  assert.match(text, /^# Implementation Review \(cycle 1\)/);

  const sub = join(dir, 'nested', 'x.md');
  await o._applyReviewChecklist({ ...ctx(0), outputs: { review: { path: sub } } }, unmet);
  assert.match(await readFile(sub, 'utf8'), /R-arch-1 not met/);
});

test('_reviewChecklistItems', async () => {
  const o = orch();
  const dir = await tmp();
  const file = join(dir, 'plan.md');
  await writeFile(file, wellShapedPlan(), 'utf8');
  o.state.shaping = { ...(o.state.shaping || {}), approved: { round: 1, file } };
  assert.deepEqual((await o._reviewChecklistItems({})).map((i) => i.id), ['R-arch-1', 'R-qa-1', 'R-qa-2']);

  const o2 = orch();
  o2.state.shaping = { ...(o2.state.shaping || {}), approved: { round: 1, file: join(dir, 'gone.md') } };
  assert.deepEqual(await o2._reviewChecklistItems({}), []);

  const o3 = orch();
  o3.state.shaping = { ...(o3.state.shaping || {}), approved: null };
  assert.deepEqual((await o3._reviewChecklistItems({ bindings: { plan: { path: file } } })).length, 3);
  assert.deepEqual(await o3._reviewChecklistItems({}), []);
});
