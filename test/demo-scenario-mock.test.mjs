// test/demo-scenario-mock.test.mjs — with WORCA_DEMO_SCENARIO the Ask mock streams the scripted answer (no "[mock]",
// no cards), with realistic usage/cost/context; without it the mock is unchanged.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createTurnReducer } from '../src/core/ask/events.mjs';

const SYS = 'You are Chat.\n\nMOCK_ROLE: ask\n';
afterEach(() => { delete process.env.WORCA_DEMO_SCENARIO; });

async function turn(prompt) {
  const dir = await mkdtemp(join(tmpdir(), 'demo-mock-'));
  const events = [];
  const reducer = createTurnReducer({ onFrame: () => {}, onProposal: () => {} });
  const out = await runClaude({ cwd: dir, mock: true, systemPrompt: SYS, prompt, onEvent: (e) => { events.push(e); reducer.push(e); } });
  return { out, events, summary: reducer.finish() };
}

test('scripted answer streams in several deltas, with cost and a context window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-sc-'));
  const f = join(dir, 's.json');
  await writeFile(f, JSON.stringify({ chunkMs: 0, ask: [{ match: 'start the trial', answer: 'The **Start trial** button sits 6 px low.', costUsd: 0.07,
    usage: { input_tokens: 21000, output_tokens: 380, cache_read_input_tokens: 14000, cache_creation_input_tokens: 0 } }] }));
  process.env.WORCA_DEMO_SCENARIO = f;
  // "start" would trip the run-proposal arm: the scenario must win before arm detection.
  const { out, events, summary } = await turn('Why does start the trial look off?');
  assert.equal(out.text, 'The **Start trial** button sits 6 px low.');
  // runClaude hands out normalized events (type 'text' + delta, 'result' with costUsd/modelUsage), not raw frames.
  const deltas = events.filter((e) => e.type === 'text' && e.delta);
  assert.ok(deltas.length >= 3);
  assert.equal(deltas.map((d) => d.text).join(''), out.text);
  assert.ok(!events.some((e) => JSON.stringify(e).includes('[mock]')));
  assert.ok(!events.some((e) => JSON.stringify(e).includes('propose_run')));
  const result = events.find((e) => e.type === 'result');
  assert.equal(result.costUsd, 0.07);
  assert.equal(result.modelUsage.mock.contextWindow, 200000);
  assert.equal(summary.usage?.ctxWindow, 200000);
});

test('without the env var the mock still answers "[mock] …"', async () => {
  const { out } = await turn('hello there');
  assert.match(out.text, /^\[mock\] hello there/);
});
