// test/subagent-mock.test.mjs — runMock emits fake sub-agent spawn+finish events
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-sub-mock-')); dirs.push(d); return d; }

function subBlocks(events) {
  const spawns = events.filter((e) => e.type === 'subagent' && e.event === 'spawn').map((e) => e.toolUseId);
  const finishes = events.filter((e) => e.type === 'subagent' && (e.event === 'finish' || e.event === 'error')).map((e) => e.toolUseId);
  return { spawns, finishes };
}

test('the implementer mock emits ≥2 sub-agent spawns each with a matching finish', async () => {
  const dir = await tmp();
  const events = [];
  await runClaude({ cwd: dir, mock: true, onEvent: (e) => events.push(e),
    prompt: 'MOCK_ROLE: implementer' });
  const { spawns, finishes } = subBlocks(events);
  assert.ok(spawns.length >= 2, `expected ≥2 fake spawns, got ${spawns.length}`);
  for (const id of spawns) assert.ok(finishes.includes(id), `spawn ${id} has a matching finish`);
});
