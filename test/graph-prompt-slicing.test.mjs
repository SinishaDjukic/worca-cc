// test/graph-prompt-slicing.test.mjs
// Shape it first, slice 4 (spec §3.8, L1/L2/L6): the Planner's slicing / outline-feedback / flat-note blocks and the
// slice-scope block ride the prompt only through the ctx fields the orchestrator sets (`shapeSlicing`,
// `shapeOutlineNote`, `shapeSliceScope`) — every other prompt stays byte-identical.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  buildAgentPrompt, SLICE_PLANNER_KEY, SLICE_SCOPE_AGENT_KEYS,
} from '../src/core/graph/executor.mjs';
import { BUILTIN_KEYS, makeCtxFor } from './helpers/prompt-ctx.mjs';

useTempHome(after);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const ctxFor = makeCtxFor({ projectDir: tmp('worca-slice-proj-'), pipelineDir: tmp('worca-slice-pipe-') });

const FILE = '/abs/pipeline/slices.json';
const OUTLINE = {
  why: 'Two shippable steps.',
  slices: [
    { id: 's1', title: 'First step', goal: 'g1', inScope: [], outOfScope: [], acceptance: ['a1'], dependsOn: [], estimate: 'small' },
    { id: 's2', title: 'Second step', goal: 'g2', inScope: [], outOfScope: [], acceptance: ['a2'], dependsOn: ['s1'], estimate: 'small' },
  ],
};
const SCOPE = { index: 2, total: 2, outline: OUTLINE, earlier: [] };

test('the exported keys name the planner and the planner+refiner pair', () => {
  assert.equal(SLICE_PLANNER_KEY, 'planner');
  assert.deepEqual([...SLICE_SCOPE_AGENT_KEYS].sort(), ['planner', 'refiner']);
});

test('the planner with shapeSlicing gets the slicing block and the MOCK_SLICES marker', () => {
  const prompt = buildAgentPrompt({ ...ctxFor('planner'), shapeSlicing: { file: FILE } });
  assert.ok(prompt.includes('## Plan in slices'));
  assert.ok(prompt.includes(`Write the outline as JSON to: ${FILE}`));
  assert.ok(prompt.includes(`MOCK_SLICES: ${FILE}`));
  assert.ok(!prompt.includes('This task was judged large.'));
  assert.ok(!prompt.includes('## Changes asked for the outline'));
});

test('shapeSlicing.size "large" adds the judged-large sentence', () => {
  const prompt = buildAgentPrompt({ ...ctxFor('planner'), shapeSlicing: { file: FILE, size: 'large' } });
  assert.ok(prompt.includes('This task was judged large.'));
});

test('a revise note adds the outline feedback block after the slicing block', () => {
  const prompt = buildAgentPrompt({
    ...ctxFor('planner'),
    shapeSlicing: { file: FILE },
    shapeOutlineNote: { decision: 'revise', feedback: 'merge s1 and s2' },
  });
  assert.ok(prompt.includes('## Plan in slices'));
  const at = prompt.indexOf('## Changes asked for the outline');
  assert.ok(at > prompt.indexOf('## Plan in slices'));
  assert.ok(prompt.includes('merge s1 and s2'));
});

test('a flat note (no shapeSlicing) contains only the Do not slice block', () => {
  const prompt = buildAgentPrompt({ ...ctxFor('planner'), shapeOutlineNote: { decision: 'flat' } });
  assert.ok(prompt.includes('## Do not slice'));
  assert.ok(!prompt.includes('## Plan in slices'));
  assert.ok(!prompt.includes('MOCK_SLICES'));
});

test('a flat note wins over shapeSlicing', () => {
  const prompt = buildAgentPrompt({
    ...ctxFor('planner'), shapeSlicing: { file: FILE }, shapeOutlineNote: { decision: 'flat' },
  });
  assert.ok(prompt.includes('## Do not slice'));
  assert.ok(!prompt.includes('## Plan in slices'));
});

test('an approve note adds nothing', () => {
  const base = ctxFor('planner');
  assert.equal(buildAgentPrompt({ ...base, shapeOutlineNote: { decision: 'approve' } }), buildAgentPrompt(base));
});

test('shapeSliceScope reads "Write the plan" on the planner and "Judge the plan" on the refiner', () => {
  const planner = buildAgentPrompt({ ...ctxFor('planner'), shapeSliceScope: SCOPE });
  assert.ok(planner.includes('## This is slice 2 of 2'));
  assert.ok(planner.includes('Write the plan for slice 2 only'));
  assert.ok(!planner.includes('Judge the plan for slice 2 only'));
  const refiner = buildAgentPrompt({ ...ctxFor('refiner'), shapeSliceScope: SCOPE });
  assert.ok(refiner.includes('Judge the plan for slice 2 only'));
  assert.ok(!refiner.includes('Write the plan for slice 2 only'));
});

test('D19: shapeSliceScope.outlineChangeFile reaches the planner prompt only', () => {
  const scope = { ...SCOPE, outlineChangeFile: '/p/outline-change.md' };
  assert.ok(buildAgentPrompt({ ...ctxFor('planner'), shapeSliceScope: scope }).includes('/p/outline-change.md'));
  assert.ok(!buildAgentPrompt({ ...ctxFor('refiner'), shapeSliceScope: scope }).includes('/p/outline-change.md'));
});

test('the slice scope comes before the slicing block on the planner', () => {
  const prompt = buildAgentPrompt({ ...ctxFor('planner'), shapeSliceScope: SCOPE, shapeSlicing: { file: FILE } });
  assert.ok(prompt.indexOf('## This is slice 2 of 2') < prompt.indexOf('## Plan in slices'));
});

test('shapeSlicing on the refiner adds nothing', () => {
  const base = ctxFor('refiner');
  assert.equal(buildAgentPrompt({ ...base, shapeSlicing: { file: FILE } }), buildAgentPrompt(base));
  assert.equal(buildAgentPrompt({ ...base, shapeOutlineNote: { decision: 'flat' } }), buildAgentPrompt(base));
});

test('byte identity: every other agent ignores all three fields', () => {
  for (const key of BUILTIN_KEYS.filter((k) => k !== 'planner' && k !== 'refiner')) {
    const ctx = ctxFor(key);
    const withAll = {
      ...ctx,
      shapeSlicing: { file: FILE },
      shapeOutlineNote: { decision: 'revise', feedback: 'x' },
      shapeSliceScope: SCOPE,
    };
    assert.equal(buildAgentPrompt(withAll), buildAgentPrompt(ctx), key);
  }
});

test('byte identity: the planner and refiner without the fields are unchanged', () => {
  for (const key of ['planner', 'refiner']) {
    const ctx = ctxFor(key);
    assert.equal(
      buildAgentPrompt({ ...ctx, shapeSlicing: null, shapeOutlineNote: null, shapeSliceScope: null }),
      buildAgentPrompt(ctx),
      key,
    );
  }
});
