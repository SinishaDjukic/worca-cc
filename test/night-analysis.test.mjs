// test/night-analysis.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis, buildAnalysisPrompt, runNightAnalysis, readMemoryText, capText } from '../src/core/night/analysis.mjs';
import { writeMemory, memoryRoot, projectScope, GLOBAL_SCOPE } from '../src/core/memory-store.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveModelEnv } from '../src/core/config.mjs';

useTempHome(after);

test('normalizeAnalysis maps per-question decisions and drops junk', () => {
  const out = normalizeAnalysis({ decisions: [
    { id: 'q1', choice: 'A', confidence: 150, rationale: 'r', reversible: true, scores: { A: { reversible: 9, bogus: 3 } } },
    { id: 7 },
  ] });
  assert.deepEqual(Object.keys(out), ['q1']);
  assert.equal(out.q1.confidence, 100);
  assert.deepEqual(out.q1.scores, { A: { reversible: 9 } });
});

test('normalizeAnalysis redacts secrets from the rationale (stored, broadcast and served)', () => {
  const key = 'sk-ant-' + 'a'.repeat(24);
  const out = normalizeAnalysis({ decisions: [{ id: 'q1', choice: 'A', confidence: 80, rationale: `the .env holds ${key}`, reversible: true, scores: {} }] });
  assert.ok(!out.q1.rationale.includes(key));
  assert.match(out.q1.rationale, /sk-ant-<redacted>/);
});

test('prompt carries question, options, criteria weights, memory and task', () => {
  const p = buildAnalysisPrompt({ questions: [{ id: 'q1', question: 'Store?', options: ['Redis', 'Postgres'] }],
    task: 'build it', planPaths: ['/p/plan.md'], memory: '- prefer Postgres', criteria: { matchesMemory: 3, cost: 1 } });
  for (const s of ['Store?', 'Redis', 'Postgres', 'matchesMemory (weight 3)', 'prefer Postgres', 'build it', '/p/plan.md']) assert.ok(p.includes(s), s);
});

test('runNightAnalysis parses the reply and reports cost', async () => {
  let seen = null;
  const run = async (o) => {
    seen = o;
    o.onEvent({ type: 'result', text: '', costUsd: 0.02, isError: false, usage: { input_tokens: 10, output_tokens: 5 } });
    return { text: '```json\n{"decisions":[{"id":"q1","choice":"Redis","confidence":70,"rationale":"r","reversible":true,"scores":{}}]}\n```' };
  };
  const r = await runNightAnalysis({ questions: [{ id: 'q1', question: '?', options: ['Redis'] }], cwd: '/tmp', run, memory: '', task: 't' });
  assert.equal(r.byId.q1.choice, 'Redis');
  assert.ok(r.costUsd > 0);
  assert.deepEqual(r.usage, { input_tokens: 10, output_tokens: 5 });
  assert.deepEqual(seen.allowedTools, ['Read', 'Grep', 'Glob'], 'read-only tools only');
  // Its prompt carries agent-written question text: no MCP servers, user hooks/plugins or
  // slash commands, no edit mode, and the Ask Worca secret-path denies.
  assert.equal(seen.permissionMode, 'dontAsk');
  assert.equal(seen.strictMcpConfig, true);
  assert.deepEqual(seen.settingSources, ['project']);
  assert.equal(seen.disableSlashCommands, true);
  for (const rule of ['Bash', 'Edit', 'Write', 'Read(~/.ssh/**)', 'Read(//**/.env*)']) assert.ok(seen.permissionRules.deny.includes(rule), rule);
  // ...but it must still read the run's checkout and its plan files.
  assert.ok(!seen.permissionRules.deny.some((r) => /\.worca-cc\/(store|runs)\//.test(r)), 'the run checkout and plan stay readable');
});

test('mock mode answers offline: recommended else first, confident', async () => {
  const r = await runNightAnalysis({ mock: true, questions: [{ id: 'a', options: ['x', 'y'], recommended: 'y' }, { id: 'b', options: ['p'] }] });
  assert.deepEqual([r.byId.a.choice, r.byId.b.choice, r.costUsd], ['y', 'p', 0]);
});

test('runNightAnalysis runs the model and effort it is given (medium when none), with that model\'s env', async () => {
  const seen = [];
  const run = async (o) => { seen.push(o); return { text: '{"decisions":[]}' }; };
  const qs = [{ id: 'q1', question: '?', options: ['a'] }];
  await runNightAnalysis({ questions: qs, cwd: '/tmp', run, memory: '', task: 't', model: 'claude-haiku-4-5', effort: 'high' });
  await runNightAnalysis({ questions: qs, cwd: '/tmp', run, memory: '', task: 't' });
  assert.deepEqual(seen.map((o) => [o.model, o.effort]), [['claude-haiku-4-5', 'high'], [null, 'medium']]);
  assert.deepEqual(seen[0].modelEnv, resolveModelEnv('claude-haiku-4-5'));
  assert.equal(seen[1].modelEnv, undefined, 'no model, no routing env');
  let called = false;
  const r = await runNightAnalysis({ mock: true, model: 'claude-haiku-4-5', effort: 'max', run: async () => { called = true; return { text: '' }; }, questions: [{ id: 'a', options: ['x'] }] });
  assert.equal(called, false, 'the mock branch still returns before any spawn');
  assert.deepEqual([r.byId.a.choice, r.costUsd], ['x', 0]);
});

test('capText cuts at a byte budget, never inside a character, and says why', () => {
  assert.equal(capText('short', 100, 'x'), 'short');
  const cut = capText('é'.repeat(10), 5, 'the rest is elsewhere');   // 2 bytes each: 2 whole characters fit
  assert.equal(cut, 'éé\n…(truncated: the rest is elsewhere)');
});

test('the task is capped in the prompt and points to task.md for the rest', () => {
  const p = buildAnalysisPrompt({ questions: [{ id: 'q1', question: '?', options: ['a', 'b'] }], task: 'x'.repeat(40_000), criteria: {} });
  assert.ok(p.includes('…(truncated: the full task is in task.md when it is listed below)'));
  assert.ok(!p.includes('x'.repeat(16_001)), 'at most 16 KB of the task is inlined');
});

test('memory: project rules come before global ones, so a cut drops global rules first', async () => {
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'global-rule', 'prefer small diffs');
  await writeMemory(memoryRoot(), projectScope('proj-00000001'), 'project-rule', 'use Postgres here');
  const text = await readMemoryText('proj-00000001');
  assert.ok(text.indexOf('### Project: project-rule') >= 0);
  assert.ok(text.indexOf('### Project: project-rule') < text.indexOf('### Global: global-rule'));
});

test('runNightAnalysis reports the fullest its own context got (sub-agent turns do not count)', async () => {
  const run = async (o) => {
    const turn = (usage, parent = null) => o.onEvent({ type: 'usage', messageId: null, parentId: parent, usage, phase: 'message' });
    turn({ input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 200 });
    turn({ input_tokens: 300, cache_read_input_tokens: 2700 });
    turn({ input_tokens: 99_999 }, 'toolu_sub');
    // A partial-message start repeats the call's prompt usage; only completed messages count.
    o.onEvent({ type: 'usage', messageId: 'msg_x', parentId: null, usage: { input_tokens: 88_888 }, phase: 'start' });
    o.onEvent({ type: 'result', text: '', costUsd: 0.01, isError: false, usage: { input_tokens: 1300, output_tokens: 40 } });
    return { text: '{"decisions":[]}' };
  };
  const r = await runNightAnalysis({ questions: [{ id: 'q1', question: '?', options: ['a'] }], cwd: '/tmp', run, memory: '', task: 't' });
  assert.equal(r.peakContextTokens, 3000);
});

test('runNightAnalysis normalizes a raw Claude envelope handed to its onEvent (a test seam)', async () => {
  const run = async (o) => {
    o.onEvent({ type: 'assistant', raw: { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', usage: { input_tokens: 700, cache_read_input_tokens: 300 } } } });
    o.onEvent({ type: 'result', costUsd: 0.01, raw: { type: 'result', total_cost_usd: 0.01, usage: { input_tokens: 700, output_tokens: 9 } } });
    return { text: '{"decisions":[]}' };
  };
  const r = await runNightAnalysis({ questions: [{ id: 'q1', question: '?', options: ['a'] }], cwd: '/tmp', run, memory: '', task: 't' });
  assert.equal(r.peakContextTokens, 1000);
  assert.deepEqual(r.usage, { input_tokens: 700, output_tokens: 9 });
  assert.ok(r.costUsd > 0);
});
