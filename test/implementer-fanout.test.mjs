// test/implementer-fanout.test.mjs
// Runner-path smoke: runImplementer runs end-to-end in mock mode so the new
// `fanOutDirective(ctxFanOut(ctx))` line EXECUTES for solo, decomposed, and fan-out-off
// nodes. We do NOT (cannot) assert the assembled user prompt offline — runClaude is a
// static import and the mock keys on MOCK_ROLE, not prompt text — so the directive VALUE
// is pinned in test/fanout-trigger.test.mjs and the runner PATH is exercised here (plan §3 D5).
// Mock trigger: ctx.claudeOpts.mock -> runOpts copies it to runClaude({mock}) -> runMock.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImplementer } from '../src/core/phases.mjs';

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-impl-fanout-')); dirs.push(d); return d; }

function ctxFor(dir, node) {
  return {
    projectDir: dir,
    pipelineDir: dir,
    taskPrompt: 'demo task',
    toolInstruction: '',
    agentPrompts: { implementer: 'You are the implementer.' },
    node,
    claudeOpts: { mock: true },
    cycle: 1,
    onEvent: () => {},
  };
}

test('runImplementer (mock) executes with a SOLO fan-out node and returns a summary', async () => {
  const dir = await tmp();
  const { summary } = await runImplementer(ctxFor(dir, { key: 'implementer', fanOut: true }), {
    planPath: join(dir, 'plan.md'),
    mode: 'implement',
  });
  assert.ok(summary, 'solo implementer returns a summary');
});

test('runImplementer (mock) executes with a DECOMPOSED fan-out task node', async () => {
  const dir = await tmp();
  const { summary } = await runImplementer(ctxFor(dir, { key: 'implementer', decomposedTask: true, fanOut: true }), {
    planPath: join(dir, 'plan.md'),
    taskPath: join(dir, 'tasks', 'p1-t1.md'),
    mode: 'implement',
  });
  assert.ok(summary, 'decomposed task implementer returns a summary');
});

test('runImplementer (mock) with fanOut OFF still runs (no-regression)', async () => {
  const dir = await tmp();
  const { summary } = await runImplementer(ctxFor(dir, { key: 'implementer', fanOut: false }), {
    planPath: join(dir, 'plan.md'),
    mode: 'implement',
  });
  assert.ok(summary, 'non-fan-out implementer unaffected');
});
