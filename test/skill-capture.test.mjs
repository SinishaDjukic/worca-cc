// test/skill-capture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { _testing } from '../src/core/run-harness.mjs';

const { mergeSkills, SKILLS_MAX } = _testing;
// n distinct MCP-tool labels' worth of tool_use blocks (one server, n tools).
const nTools = (n, from = 0) => Array.from({ length: n }, (_, i) =>
  ({ type: 'tool_use', id: `t${from + i}`, name: `mcp__srv__tool_${from + i}`, input: {} }));
const nLabels = (n, from = 0) => Array.from({ length: n }, (_, i) => `mcp:srv:tool_${from + i}`);

const ATTR = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };

// One assistant turn (MAIN stream: no parent_tool_use_id) with the given tool_use blocks.
const mainTurn = (blocks) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: blocks } } });
// One assistant turn on a SUB-agent stream (parent_tool_use_id = the spawn id).
const subTurn = (parentId, blocks) => ({
  type: 'assistant',
  raw: { type: 'assistant', parent_tool_use_id: parentId, message: { content: blocks } },
});
const spawn = (id, name = 'Agent', description = 'area A') => mainTurn([{ type: 'tool_use', id, name, input: { description } }]);

function orchWithStep() {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.state.steps.push({ key: ATTR.stepKey, nodeId: ATTR.nodeId, cycle: ATTR.cycle, status: 'running' });
  return orch;
}

test('main-agent Skill tool_use attaches a "skill:<name>" to its step + emits stepskills', () => {
  const orch = orchWithStep();
  const deltas = [];
  orch.on('stepskills', (d) => deltas.push(d));
  orch._onAgentEvent('planner', mainTurn([{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'graphify' } }]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills, ['skill:graphify']);
  assert.equal(deltas.length, 1);
  assert.deepEqual(deltas[0].skills, ['skill:graphify']);
  assert.equal(deltas[0].nodeId, 'n1');
  assert.equal(deltas[0].cycle, 1);
});

// §7.1: the MCP branch keeps the TOOL token -> three-part `mcp:<server>:<tool>`.
test('MCP tool_use becomes "mcp:<server>:<tool>" (plugin_ stripped, dup words collapsed)', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 't2', name: 'mcp__plugin_playwright_playwright__browser_navigate', input: { url: 'x' } },
    { type: 'tool_use', id: 't3', name: 'mcp__firebase__firebase_deploy', input: {} },
  ]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills,
    ['mcp:playwright:browser_navigate', 'mcp:firebase:firebase_deploy']);
});

// The whole point of the granularity change: one server, two tools, TWO pills.
test('§7.1 granularity: two tools on the SAME server yield two distinct labels', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'a', name: 'mcp__plugin_playwright_playwright__browser_navigate', input: {} },
    { type: 'tool_use', id: 'b', name: 'mcp__plugin_playwright_playwright__browser_click', input: {} },
  ]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills,
    ['mcp:playwright:browser_navigate', 'mcp:playwright:browser_click']);
});

// §7.1: "legacy shape when no tool token" — the two-part label is still reachable.
test('an mcp__<server> name with no tool token keeps the legacy two-part label', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'p', name: 'mcp__echo', input: {} },
    { type: 'tool_use', id: 'q', name: 'mcp__echo__', input: {} },   // empty tool token
  ]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills, ['mcp:echo']);
});

// §5.5's `__`-normalization keeps the grammar unambiguous, but a tool token may
// itself contain `__`; it must survive WHOLE (split/slice(2)/join('__')).
test('a tool token containing __ survives whole (never truncated at the first pair)', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'z', name: 'mcp__srv__deep__nested__tool', input: {} },
  ]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills, ['mcp:srv:deep__nested__tool']);
});

test('the real doubled plugin_<x>_<x> prefix collapses (env-accurate names)', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'f', name: 'mcp__plugin_firebase_firebase__firebase_deploy', input: {} },
  ]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills, ['mcp:firebase:firebase_deploy']);
});

test('core/spawn tools are NOT skills (Read/Bash/Grep/Glob/Task/Agent/WebFetch excluded)', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/x' } },
    { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } },
    { type: 'tool_use', id: 'c', name: 'Task', input: { description: 'd' } },
  ]), ATTR);
  assert.equal(orch.state.steps[0].skills, undefined); // nothing recorded, no emit
});

test('sub-agent skills attach to the spawned record by parent_tool_use_id; deltas carry skills', () => {
  const orch = orchWithStep();
  const subDeltas = [];
  orch.on('subagent', (d) => subDeltas.push(d));
  orch._onAgentEvent('planner', spawn('sub_1'), ATTR);                                  // spawn
  orch._onAgentEvent('planner', subTurn('sub_1', [
    { type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'brainstorming' } },
    { type: 'tool_use', id: 'm', name: 'mcp__plugin_playwright_playwright__browser_click', input: {} },
  ]), ATTR);
  const rec = orch.state.subAgents.find((s) => s.id === 'sub_1');
  assert.deepEqual(rec.skills, ['skill:brainstorming', 'mcp:playwright:browser_click']);
  const last = subDeltas.at(-1);
  assert.equal(last.transition, 'update');
  assert.deepEqual(last.skills, ['skill:brainstorming', 'mcp:playwright:browser_click']);
});

// ── §7.1 the raised cap and its overflow sentinel ────────────────────────────

test('§7.1 the per-agent cap is 64 (raised from 24 for per-tool granularity)', () => {
  assert.equal(SKILLS_MAX, 64);
});

test('§7.1 exactly-at-cap labels all land with NO sentinel', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn(nTools(SKILLS_MAX)), ATTR);
  assert.deepEqual(orch.state.steps[0].skills, nLabels(SKILLS_MAX));
  assert.ok(!orch.state.steps[0].skills.some((t) => t.startsWith('overflow:')), 'cap not bound -> no sentinel');
});

test('§7.1 (b) 70 distinct labels yield 64 pills plus one trailing overflow:6', () => {
  const orch = orchWithStep();
  const deltas = [];
  orch.on('stepskills', (d) => deltas.push(d));
  orch._onAgentEvent('planner', mainTurn(nTools(70)), ATTR);
  const skills = orch.state.steps[0].skills;
  assert.equal(skills.length, 65, '64 real labels + exactly one sentinel');
  assert.deepEqual(skills.slice(0, 64), nLabels(64), 'the first 64 distinct labels are kept, in order');
  assert.equal(skills.at(-1), 'overflow:6', 'the sentinel is last and counts the 6 dropped labels');
  assert.deepEqual(deltas.at(-1).skills, skills, 'the delta carries the sentinel too (live UI sees it)');
});

test('§7.1 (c) two successive over-cap merges yield ONE sentinel with the larger count, kept last', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn(nTools(70)), ATTR);            // 64 kept, 6 dropped
  orch._onAgentEvent('planner', mainTurn(nTools(5, 100)), ATTR);        // 5 more, all dropped
  const skills = orch.state.steps[0].skills;
  assert.equal(skills.filter((t) => t.startsWith('overflow:')).length, 1, 'exactly one sentinel');
  assert.equal(skills.at(-1), 'overflow:11', 'the count is summed (6 + 5) and larger than before');
  assert.equal(skills.length, 65, 'the sentinel never consumes a cap slot');
  assert.deepEqual(skills.slice(0, 64), nLabels(64), 'no real label landed AFTER the sentinel');
});

// §7.1 step 3 is `overflow = prevOverflow + dropped`, where `dropped` counts the
// labels rejected by the cap THIS merge. The sentinel is therefore a monotonic
// SUM, not a distinct-ever-omitted count: re-presenting an already-rejected label
// in a later turn raises it again (the count-only sentinel cannot remember which
// labels it stood for). Pinned here so the behavior is a decision, not a surprise.
test('§7.1 the sentinel is a monotonic SUM — re-presented rejects raise it again', () => {
  const orch = orchWithStep();
  const deltas = [];
  orch.on('stepskills', (d) => deltas.push(d));
  orch._onAgentEvent('planner', mainTurn(nTools(70)), ATTR);
  orch._onAgentEvent('planner', mainTurn(nTools(70)), ATTR);   // the very same 70 labels
  assert.equal(orch.state.steps[0].skills.at(-1), 'overflow:12', '6 + the same 6 again');
  assert.equal(deltas.length, 2, 'a risen overflow count IS growth -> it persists + emits');
  assert.equal(orch.state.steps[0].skills.length, 65, 'still exactly one sentinel, still 64 real');
});

// A turn that re-presents only labels ALREADY held is not growth at all.
test('§7.1 a fully-known over-cap turn is not growth (no re-emit, no count change)', () => {
  const orch = orchWithStep();
  let emits = 0;
  orch.on('stepskills', () => { emits += 1; });
  orch._onAgentEvent('planner', mainTurn(nTools(70)), ATTR);
  orch._onAgentEvent('planner', mainTurn(nTools(10)), ATTR);   // all 10 are among the kept 64
  assert.equal(emits, 1, 'nothing new and nothing newly rejected -> mergeSkills returns null');
  assert.equal(orch.state.steps[0].skills.at(-1), 'overflow:6');
});

test('§7.1 a repeated dropped label is counted ONCE (distinct rejected labels)', () => {
  const orch = orchWithStep();
  const dup = { type: 'tool_use', id: 'd', name: 'mcp__srv__over_the_top', input: {} };
  orch._onAgentEvent('planner', mainTurn([...nTools(SKILLS_MAX), dup, { ...dup, id: 'd2' }]), ATTR);
  assert.equal(orch.state.steps[0].skills.at(-1), 'overflow:1', 'the same rejected label counts once');
});

test('§7.1 a non-overflowing merge onto a sentinel-carrying array preserves the sentinel LAST', () => {
  const orch = orchWithStep();
  // A resumed/persisted array: a few real labels plus a sentinel from an earlier over-cap merge.
  orch.state.steps[0].skills = ['skill:graphify', 'overflow:3'];
  orch._onAgentEvent('planner', mainTurn([{ type: 'tool_use', id: 'n', name: 'Skill', input: { skill: 'brainstorming' } }]), ATTR);
  assert.deepEqual(orch.state.steps[0].skills, ['skill:graphify', 'skill:brainstorming', 'overflow:3'],
    'the new label lands among the real labels; the sentinel stays last with its count intact');
});

test("§7.1 mergeSkills: a sentinel in `incoming` folds its count instead of duplicating it", () => {
  // The snapshot-rebuild shape: BOTH sides are persisted arrays carrying sentinels.
  const merged = mergeSkills(['skill:a', 'overflow:4'], ['skill:b', 'overflow:9']);
  assert.deepEqual(merged, ['skill:a', 'skill:b', 'overflow:9'],
    'one sentinel, the larger n (a monotonic floor), never treated as a label');
  // A smaller incoming sentinel with nothing new is not growth -> null (no persist/emit).
  assert.equal(mergeSkills(['skill:a', 'overflow:9'], ['skill:a', 'overflow:4']), null);
  // A LARGER incoming sentinel alone IS growth (the count rose).
  assert.deepEqual(mergeSkills(['skill:a', 'overflow:4'], ['overflow:9']), ['skill:a', 'overflow:9']);
});

test('repeated skills dedup and the set only grows (no duplicate, no re-emit when unchanged)', () => {
  const orch = orchWithStep();
  let emits = 0;
  orch.on('stepskills', () => { emits += 1; });
  const turn = mainTurn([{ type: 'tool_use', id: 'x', name: 'Skill', input: { skill: 'graphify' } }]);
  orch._onAgentEvent('planner', turn, ATTR);
  orch._onAgentEvent('planner', turn, ATTR); // same skill again
  assert.deepEqual(orch.state.steps[0].skills, ['skill:graphify']);
  assert.equal(emits, 1, 'no re-emit when the set did not change');
});
