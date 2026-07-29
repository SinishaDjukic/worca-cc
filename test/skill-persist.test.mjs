// test/skill-persist.test.mjs
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertSubAgent, listSubAgents, readPipeline } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-skill-persist-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('sub_agents.skills round-trips as a JSON array; NULL -> []', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-skill-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  upsertSubAgent(pid, { id: 'a1', label: 'AR sheet', nodeId: 'n1', stepIndex: 0, cycle: 1,
    status: 'finished', startedAt: '2026-06-20T00:00:00Z', skills: ['skill:graphify', 'mcp:playwright'] });
  upsertSubAgent(pid, { id: 'a2', label: 'AR items', nodeId: 'n1', stepIndex: 0, cycle: 1,
    status: 'finished', startedAt: '2026-06-20T00:00:01Z' }); // no skills

  const subs = listSubAgents(pid);
  assert.deepEqual(subs.find((s) => s.id === 'a1').skills, ['skill:graphify', 'mcp:playwright']);
  assert.deepEqual(subs.find((s) => s.id === 'a2').skills, [], 'absent skills surface as []');
});

// §7.2: the new label shapes are just more opaque strings in the same V6 column —
// three-part MCP tags AND §7.1's overflow sentinel round-trip beside legacy
// two-part rows, with no migration.
test('§7.2 three-part MCP tags, the overflow sentinel, and legacy tags coexist in one row', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-skill-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  const skills = ['skill:graphify', 'mcp:playwright:browser_navigate', 'mcp:playwright', 'overflow:6'];
  upsertSubAgent(pid, { id: 'a1', status: 'finished', startedAt: '2026-06-20T00:00:00Z', skills });
  assert.deepEqual(listSubAgents(pid)[0].skills, skills, 'verbatim, order preserved, sentinel last');
});

// The brief's assertion (b), sub-agent half: 64 pills + a `+6 more` that SURVIVES a reload.
test('§7.1 (b) a 64-label + overflow:6 array survives listSubAgents intact (65 entries)', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-skill-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  const skills = [...Array.from({ length: 64 }, (_, i) => `mcp:srv:tool_${i}`), 'overflow:6'];
  upsertSubAgent(pid, { id: 'a1', status: 'finished', startedAt: '2026-06-20T00:00:00Z', skills });
  const back = listSubAgents(pid)[0].skills;
  assert.equal(back.length, 65);
  assert.equal(back.at(-1), 'overflow:6', 'the sentinel survived the reload, still last');
  assert.deepEqual(back, skills);
});

// The brief's assertion (b), STEP half, end to end: the array is produced by the
// real capture path (70 distinct MCP tools in one turn), persisted through the
// production writer, and read back by the reload path — 64 labels + `+6 more`.
test('§7.1 (b) 70 captured labels persist as 64 + overflow:6 and survive a reload', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-skill-proj-'));

  // Capture: one turn, 70 distinct mcp__srv__tool_N blocks.
  const orch = createOrchestrator({ projectDir: proj });
  orch.state.steps.push({ key: '2:n1', nodeId: 'n1', cycle: 1, status: 'running' });
  orch._onAgentEvent('planner', { type: 'assistant', raw: { type: 'assistant', message: {
    content: Array.from({ length: 70 }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: `mcp__srv__tool_${i}`, input: {} })),
  } } }, { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' });
  const captured = orch.state.steps[0].skills;
  assert.equal(captured.length, 65, 'capture produced 64 real labels + one sentinel');

  // Persist through writeState, then read back through readPipeline (the reload path).
  const { id } = await seedPipeline(proj, { title: 'Run', status: 'done',
    steps: [{ key: '2:n1', nodeId: 'n1', cycle: 1, skills: captured }] });
  const back = (await readPipeline(proj, id)).state.steps.find((s) => s.key === '2:n1').skills;
  assert.deepEqual(back, captured, 'every label, and the sentinel last, survived the round-trip');
  assert.equal(back.filter((t) => t.startsWith('overflow:')).length, 1, 'still exactly one sentinel');
  assert.equal(back.at(-1), 'overflow:6', '64 shown, 6 omitted — still visible after reload');
});

test('a skills update never nulls the COALESCE-guarded skills (grows monotonically)', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-skill-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  upsertSubAgent(pid, { id: 'a1', status: 'running', startedAt: '2026-06-20T00:00:00Z', skills: ['skill:graphify'] });
  // A later status-only upsert (no skills) must NOT wipe the stored array (COALESCE guard).
  upsertSubAgent(pid, { id: 'a1', status: 'finished', finishedAt: '2026-06-20T00:00:09Z' });
  assert.deepEqual(listSubAgents(pid)[0].skills, ['skill:graphify'], 'skills preserved across a skill-less finish update');
});
