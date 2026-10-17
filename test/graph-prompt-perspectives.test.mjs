// test/graph-prompt-perspectives.test.mjs
// Shape it first (spec D3/D5): a node's own `config.promptHints` lands after the sidecar hints, and the
// Perspectives block rides the planner/refiner prompt of a shaped run — and ONLY there: every other prompt
// stays byte-identical to the one an unshaped run builds.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildAgentPrompt } from '../src/core/graph/executor.mjs';
import { REGISTRY, BUILTIN_KEYS, makeCtxFor } from './helpers/prompt-ctx.mjs';

useTempHome(after);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const ctxFor = makeCtxFor({ projectDir: tmp('worca-persp-proj-'), pipelineDir: tmp('worca-persp-pipe-') });

/** The Perspectives block of a prompt: from its heading to the next top-level block. */
const blockOf = (prompt) => {
  const i = prompt.indexOf('## Perspectives');
  assert.ok(i >= 0, 'the prompt has a Perspectives block');
  const rest = prompt.slice(i);
  const end = rest.indexOf('\n## ', 3);
  return end < 0 ? rest : rest.slice(0, end);
};

test('a planner of a product+qa run gets the Perspectives block with only Product and QA sections', () => {
  const block = blockOf(buildAgentPrompt({ ...ctxFor('planner'), shape: { perspectives: ['product', 'qa'] } }));
  for (const want of ['1. Problem and goal (Product)', '2. Testing (QA)', '3. Out of scope (Product)', '4. Open questions', 'R-qa-1']) {
    assert.ok(block.includes(want), `block carries ${want}`);
  }
  for (const not of ['Decisions', 'Code layout', 'Threats']) {
    assert.ok(!block.split('\n').some((l) => /^\d+\. /.test(l) && l.includes(not)), `no ${not} section line`);
  }
});

test('architect and security add Decisions, Code layout, Threats and their R- prefixes', () => {
  const block = blockOf(buildAgentPrompt({ ...ctxFor('planner'), shape: { perspectives: ['product', 'architect', 'security'] } }));
  for (const want of ['Decisions', 'Code layout', 'Threats', 'R-arch-', 'R-sec-']) assert.ok(block.includes(want), want);
});

test('the refiner gets the same block plus the refiner line', () => {
  const shape = { perspectives: ['product', 'qa'] };
  const planner = blockOf(buildAgentPrompt({ ...ctxFor('planner'), shape }));
  const refiner = blockOf(buildAgentPrompt({ ...ctxFor('refiner'), shape }));
  assert.ok(refiner.startsWith(planner.replace(/\n+$/, '')), 'the planner block is the refiner block\'s prefix');
  assert.ok(refiner.includes('As the refiner'));
  assert.ok(!planner.includes('As the refiner'));
});

test('byte identity: a prompt without `shape` is the prompt with shape:null, for every builtin', () => {
  for (const key of BUILTIN_KEYS) {
    const ctx = ctxFor(key);
    assert.equal(buildAgentPrompt(ctx), buildAgentPrompt({ ...ctx, shape: null }), key);
    assert.ok(!buildAgentPrompt(ctx).includes('## Perspectives'), `${key}: no block`);
  }
});

test('byte identity: a non-planner/refiner node ignores `shape`', () => {
  for (const key of BUILTIN_KEYS.filter((k) => k !== 'planner' && k !== 'refiner')) {
    const ctx = ctxFor(key);
    assert.equal(buildAgentPrompt({ ...ctx, shape: { perspectives: ['qa'] } }), buildAgentPrompt(ctx), key);
  }
});

test('config.promptHints follows the sidecar hints on a planner node', () => {
  const base = ctxFor('planner');
  assert.ok(REGISTRY.planner.promptHints, 'the planner sidecar carries hints');
  const ctx = { ...base, node: { ...base.node, config: { promptHints: 'EXTRA HINT' } } };
  const prompt = buildAgentPrompt(ctx);
  const sidecar = buildAgentPrompt(base);
  const hints = REGISTRY.planner.promptHints.trim();
  assert.ok(prompt.includes(`${hints}\n\nEXTRA HINT\n\n`), 'sidecar hints, blank line, then the node hints');
  assert.equal(prompt.replace('EXTRA HINT\n\n', ''), sidecar, 'and nothing else differs');
});

test('config.promptHints on a node without sidecar hints lands right after the base instruction', () => {
  const base = ctxFor('clarify');
  assert.ok(!REGISTRY.clarify.promptHints, 'clarify has no sidecar hints');
  const prompt = buildAgentPrompt({ ...base, node: { ...base.node, config: { promptHints: 'EXTRA HINT' } } });
  const baseline = buildAgentPrompt(base);
  assert.ok(prompt.includes('\n\nEXTRA HINT\n\n'));
  assert.equal(prompt.replace('EXTRA HINT\n\n', ''), baseline);
});

test('blank or absent config.promptHints change nothing', () => {
  const base = ctxFor('planner');
  const expected = buildAgentPrompt(base);
  for (const promptHints of [undefined, '', '   \n']) {
    assert.equal(buildAgentPrompt({ ...base, node: { ...base.node, config: { promptHints } } }), expected);
  }
});

test('a reviewer with checklistItems lists them between the task header and "What to do" (spec D7)', () => {
  const ctx = ctxFor('reviewer');
  const items = [{ id: 'R-qa-1', perspective: 'qa', text: 'Rejects empty input.' }];
  const prompt = buildAgentPrompt({ ...ctx, checklistItems: items });
  assert.ok(prompt.includes('## Perspective checklist'));
  assert.ok(prompt.includes('`R-qa-1` (QA): Rejects empty input.'));
  const at = prompt.indexOf('## Perspective checklist');
  assert.ok(at > prompt.indexOf('## Original request'), 'after the original request');
  assert.ok(at < prompt.indexOf('## What to do'), 'before What to do');
});

test('byte identity: empty or absent checklistItems change nothing, for every builtin (spec D7)', () => {
  for (const key of BUILTIN_KEYS) {
    const ctx = ctxFor(key);
    assert.equal(buildAgentPrompt({ ...ctx, checklistItems: [] }), buildAgentPrompt(ctx), key);
    assert.equal(buildAgentPrompt({ ...ctx, checklistItems: undefined }), buildAgentPrompt(ctx), key);
  }
});
