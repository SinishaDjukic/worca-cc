// test/skill-mock.test.mjs — the fan-out mock emits a MAIN-stream Skill + mcp__*
// block and a child (parent_tool_use_id) envelope carrying a Skill + two mcp__*
// blocks on ONE server, so smoke / UI runs surface every pill KIND offline:
// skill:<slug>, mcp:<server>:<tool>, and two tools of one server as two pills
// (§7.6). Mirrors test/subagent-mock.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-skill-mock-')); dirs.push(d); return d; }

function toolUseNames(content) {
  return Array.isArray(content) ? content.filter((c) => c?.type === 'tool_use').map((c) => c.name) : [];
}

test('the implementer mock emits a main-stream Skill block and a child Skill + mcp__* block', async () => {
  const dir = await tmp();
  const events = [];
  await runClaude({ cwd: dir, mock: true, onEvent: (e) => events.push(e),
    prompt: 'MOCK_ROLE: implementer' });

  // (1) A MAIN-stream Skill block (no parent_tool_use_id).
  const mainSkill = events.some((e) =>
    e?.raw?.parent_tool_use_id == null && toolUseNames(e?.raw?.message?.content).includes('Skill'));
  assert.ok(mainSkill, 'a main-agent Skill tool_use is emitted');

  // (2) A child envelope (parent_tool_use_id set) carrying a Skill + an mcp__* block.
  const childSkillMcp = events.some((e) => {
    if (e?.raw?.parent_tool_use_id == null) return false;
    const names = toolUseNames(e?.raw?.message?.content);
    return names.includes('Skill') && names.some((n) => typeof n === 'string' && n.startsWith('mcp__'));
  });
  assert.ok(childSkillMcp, 'a sub-agent Skill + mcp__* tool_use is emitted on a child stream');
});

// §7.6: run the mock's events through the REAL capture so the labels a mock run
// produces are pinned end to end (this is what `npm run smoke` surfaces offline).
test('§7.6 the mock produces the three-part MCP labels the pills render', async () => {
  const dir = await tmp();
  const attr = { nodeId: 'n1', stepIndex: 0, cycle: 1, stepKey: '0:n1' };
  const orch = createOrchestrator({ projectDir: dir });
  orch.state.steps.push({ key: attr.stepKey, nodeId: attr.nodeId, cycle: attr.cycle, status: 'running' });
  await runClaude({ cwd: dir, mock: true, prompt: 'MOCK_ROLE: implementer',
    onEvent: (e) => orch._onAgentEvent('implementer', e, attr) });

  // MAIN agent: a named skill AND an MCP tool (so the group-header row exercises both).
  assert.deepEqual(orch.state.steps[0].skills, ['skill:graphify', 'mcp:playwright:browser_snapshot']);

  // Sub-agent: a named skill + TWO tools of the SAME server -> two distinct pills.
  const rec = orch.state.subAgents.find((s) => Array.isArray(s.skills) && s.skills.length);
  assert.deepEqual(rec.skills,
    ['skill:brainstorming', 'mcp:playwright:browser_navigate', 'mcp:playwright:browser_click'],
    'per-tool granularity is visible offline: one server, two tools, two labels');
  assert.ok(!orch.state.steps[0].skills.concat(rec.skills).some((t) => t.startsWith('overflow:')),
    'a mock run stays well under the 64 cap -> no sentinel noise in smoke output');
});
