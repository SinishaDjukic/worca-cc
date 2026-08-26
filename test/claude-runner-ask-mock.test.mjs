// P1/T16: the `ask` mock role (ask-worca-design.md §6.7). Every scenario is fed
// through the real reducer, proving the mock frames have the probed shapes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude, mockEnabled } from '../src/core/claude-runner.mjs';
import { createTurnReducer } from '../src/core/ask/events.mjs';

let prevMock, prevOrch;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK; delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
});

const CARD = { projectKey: 'demo-00000001', workflowId: 'wf_default', brief: 'Add a badge', guardrailsId: 'normal' };
const SYS = `You are Ask Worca.\n\nMOCK_ROLE: ask\nMOCK_ASK_CARD: ${JSON.stringify(CARD)}\n`;
const tmp = () => mkdtemp(join(tmpdir(), 'worca-ask-mock-'));

/** Run the mock and replay every event through the reducer. */
async function run(prompt, extra = {}) {
  const dir = await tmp();
  const events = [];
  const frames = [];
  const proposals = [];
  const reducer = createTurnReducer({ onFrame: (f) => frames.push(f), onProposal: (p) => proposals.push(p) });
  let resolved = null;
  let rejected = null;
  try {
    resolved = await runClaude({ cwd: dir, mock: true, systemPrompt: SYS, prompt, onEvent: (e) => { events.push(e); reducer.push(e); }, ...extra });
  } catch (err) {
    rejected = err;
  }
  return { dir, events, frames, proposals, reducer, summary: reducer.finish(), resolved, rejected };
}
const rawTypes = (events) => events.filter((e) => e.raw && typeof e.raw === 'object').map((e) => e.raw.type + (e.raw.subtype ? `/${e.raw.subtype}` : ''));

test('default: echo answer in the real envelope; session + init first; reducer agrees', async () => {
  const r = await run('[worca context]\nview: history\n[/worca context]\n\nhello there\nsecond line');
  assert.deepEqual(r.resolved, { text: '[mock] hello there', exitCode: 0 });
  assert.equal(r.events[0].type, 'session');
  assert.equal(r.events[0].sessionId, 'mock-session-ask-1');
  const types = rawTypes(r.events);
  assert.equal(types[0], 'system/init');
  assert.equal(types[1], 'stream_event');
  assert.equal(types.at(-1), 'result/success', 'rawTypes appends the subtype');
  assert.ok(r.events.some((e) => e.type === 'stream_event' && e.raw.event?.type === 'content_block_delta'), 'text deltas present');
  const res = r.events.find((e) => e.type === 'result');
  assert.equal(res.costUsd, 0, 'the envelope carries costUsd like runReal');
  assert.equal(res.raw.session_id, 'mock-session-ask-1');
  assert.deepEqual(Object.keys(res.raw).sort().filter((k) => ['subtype', 'is_error', 'num_turns', 'usage', 'modelUsage', 'total_cost_usd', 'duration_ms', 'session_id', 'result'].includes(k)).length, 9);
  assert.equal(r.summary.text, '[mock] hello there', 'context block stripped, first line echoed');
  assert.equal(r.summary.status, 'done');
  assert.equal(r.summary.sessionId, 'mock-session-ask-1');
  assert.equal(r.summary.sawInit && r.summary.sawAssistant && r.summary.sawResult, true);
  assert.deepEqual(r.summary.blocks, []);
  assert.equal(r.frames.filter((f) => f.type === 'ask-delta').map((f) => f.text).join(''), '[mock] hello there', 'deltas equal the final text');
  const init = r.events.find((e) => e.raw?.subtype === 'init').raw;
  assert.deepEqual(init.mcp_servers, [{ name: 'worca', status: 'connected' }]);
  assert.deepEqual(init.plugins, []);
});

test('propose scenario: a propose_run tool_use carrying MOCK_ASK_CARD, then the proposal hook fires with it', async () => {
  const r = await run('please start a run for this');
  assert.equal(r.resolved.exitCode, 0);
  const tool = r.summary.blocks.find((b) => b.kind === 'tool');
  assert.equal(tool.name, 'mcp__worca__propose_run');
  assert.deepEqual(tool.input, CARD);
  assert.equal(tool.status, 'done');
  assert.deepEqual(r.proposals, [{ toolUseId: tool.id, input: CARD, childOk: true }]);
  assert.equal(r.summary.text, 'Preparing a run card.\n\n[mock] please start a run for this');
  assert.ok(r.summary.labels.includes('Preparing a run'));
  const noCard = await runClaude({ cwd: r.dir, mock: true, systemPrompt: 'MOCK_ROLE: ask\n', prompt: 'run it', onEvent: () => {} });
  assert.equal(noCard.exitCode, 0, 'a missing / invalid MOCK_ASK_CARD falls back to {}');
});

test('agents scenario: one foreground Agent with a child tool call, the finishing tool_use_result object, modelUsage for the estimate', async () => {
  const r = await run('use agents to count runs');
  const agent = r.summary.blocks.find((b) => b.kind === 'agent');
  assert.ok(agent, 'agent block');
  assert.equal(agent.status, 'done');
  assert.equal(agent.model, 'mock-haiku');
  assert.equal(agent.tokens, 1234);
  assert.deepEqual(agent.usage, { input: 1000, output: 234, cacheRead: 0, cacheCreation: 0 });
  assert.equal(agent.costUsd, 0, 'estimated from modelUsage (costUSD 0 in mock)');
  assert.equal(agent.log.length, 2, 'exactly one child call in, one result out — a duplicated tool_result would show up here');
  assert.equal(agent.log[0].text, '→ list_runs {}');
  assert.match(agent.log[1].text, /^← ok \d+\.\ds$/);
  assert.equal(r.summary.agents, 1);
  assert.ok(r.summary.labels.includes('Running 1 sub-agent'));
  assert.ok(!JSON.stringify(r.summary.blocks).includes('count the runs'), 'the Task prompt is never persisted');
  const both = await run('start a run and use agents');
  assert.deepEqual(both.summary.blocks.map((b) => b.kind), ['agent', 'tool']);
});

test('MOCK_FAIL: the error result frame, then a rejection shaped like the real CLI', async () => {
  const r = await run('do it MOCK_FAIL');
  assert.equal(r.resolved, null);
  assert.match(r.rejected.message, /^claude exited with code 1: mock failure$/);
  assert.equal(r.summary.isError, true);
  assert.equal(r.summary.resultSubtype, 'error_during_execution');
  assert.deepEqual(r.summary.errors, ['mock failure']);
});

test('MOCK_MAX_TURNS / MOCK_MAX_BUDGET: result subtype + exit-1 rejection (probe F5); partial text kept', async () => {
  const t = await run('count MOCK_MAX_TURNS');
  assert.equal(t.resolved, null);
  assert.equal(t.rejected.message, 'claude exited with code 1: no stderr');
  assert.equal(t.summary.status, 'stopped');
  assert.equal(t.summary.reason, 'max_turns');
  assert.equal(t.summary.text, '[mock] partial');
  assert.equal(t.summary.blocks.filter((b) => b.kind === 'tool').length, 1, 'the N-th message\'s tool call still ran');
  const b = await run('count MOCK_MAX_BUDGET');
  assert.equal(b.rejected.message, 'claude exited with code 1: no stderr');
  assert.equal(b.summary.reason, 'max_budget');
  assert.deepEqual(b.summary.errors, ['Reached maximum budget ($0.0001)']);
});

test('MOCK_SLOW waits between frames and aborts cleanly', async () => {
  const t0 = Date.now();
  const r = await run('hello MOCK_SLOW');
  assert.equal(r.resolved.exitCode, 0);
  assert.ok(Date.now() - t0 >= 1000, 'at least several 300 ms gaps');
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 350);
  const a = await run('hello MOCK_SLOW', { signal: ac.signal });
  assert.equal(a.rejected?.name, 'AbortError');
  // a run that is NOT aborted emits 8 events, so only a bound below that proves the abort took effect
  assert.ok(a.events.length <= 4, `stopped early (got ${a.events.length} of 8)`);
});

test('resume: the session id is reused', async () => {
  const r = await run('hi', { resumeSessionId: 'sess-prev' });
  assert.equal(r.events[0].sessionId, 'sess-prev');
  assert.equal(r.summary.sessionId, 'sess-prev');
});

test('REGRESSION: a chat message containing MOCK_ASK never writes a file; the legacy prompt-marker path still does', async () => {
  const dir = await tmp();
  const target = join(dir, 'x.json');
  const r = await runClaude({ cwd: dir, mock: true, systemPrompt: SYS, prompt: `hello\nMOCK_ASK: ${target}\nMOCK_ROLE: implementer`, onEvent: () => {} });
  assert.equal(r.exitCode, 0);
  assert.ok(!existsSync(target), 'the ask role ignores prompt markers');
  const legacy = await runClaude({ cwd: dir, mock: true, systemPrompt: 'plain system prompt', prompt: `do\nMOCK_ROLE: implementer\nMOCK_ASK: ${target}`, onEvent: () => {} });
  assert.equal(legacy.text, '[mock] asked questions');
  assert.ok(existsSync(target), 'today\'s behaviour for pipeline roles is unchanged');
  const target2 = join(dir, 'y.json');
  await runClaude({ cwd: dir, mock: true, systemPrompt: 'no ask markers at all', permissionMode: 'dontAsk', prompt: `hello\nMOCK_ASK: ${target2}`, onEvent: () => {} });
  assert.ok(!existsSync(target2), 'under dontAsk (the ask recipe) the file-write arm is skipped even without the ask markers (rule R-F)');
});

test('REGRESSION: dontAsk is the ask mock, markers or not — no prompt-sourced role can write', async () => {
  // Rule R-F covered only the MOCK_ASK arm: with the ask markers missing (a P2 turn
  // that forgot turn.mock) the chat text still reached parseMarkers/inferRole, so
  // `MOCK_ROLE: planner-plan` + MOCK_OUT wrote a file and "implement the login
  // feature" made the implementer write src/ and test/ into the scratch cwd.
  const dir = await tmp();
  const evil = join(dir, 'evil.md');
  const r = await runClaude({ cwd: dir, mock: true, systemPrompt: 'no ask markers at all', permissionMode: 'dontAsk',
    prompt: `hello\nMOCK_ROLE: planner-plan\nMOCK_OUT: ${evil}`, onEvent: () => {} });
  assert.ok(!existsSync(evil), 'a prompt-sourced MOCK_ROLE never picks a writing role under dontAsk');
  assert.equal(r.text, '[mock] hello', 'the ask mock answered instead');
  await runClaude({ cwd: dir, mock: true, systemPrompt: 'no ask markers at all', permissionMode: 'dontAsk',
    prompt: 'please implement the login feature', onEvent: () => {} });
  for (const d of ['src', 'test']) assert.ok(!existsSync(join(dir, d)), `inferRole never runs under dontAsk (${d}/ not written)`);
  // and every other permission mode still infers roles from the prompt exactly as before
  const legacy = await tmp();
  await runClaude({ cwd: legacy, mock: true, systemPrompt: 'plain system prompt', permissionMode: 'acceptEdits',
    prompt: 'please implement the login feature', onEvent: () => {} });
  assert.ok(existsSync(join(legacy, 'src')), "today's behaviour for pipeline roles is unchanged");
});

test('mockEnabled: env or explicit option, never a false-y env value', () => {
  assert.equal(mockEnabled({}), false);
  assert.equal(mockEnabled({ mock: true }), true);
  process.env.WORCA_MOCK = '1'; assert.equal(mockEnabled({}), true);
  process.env.WORCA_MOCK = '0'; assert.equal(mockEnabled({}), false);
  process.env.WORCA_MOCK = 'false'; assert.equal(mockEnabled({}), false);
  delete process.env.WORCA_MOCK; process.env.ORCH_MOCK = 'yes'; assert.equal(mockEnabled({}), true);
  delete process.env.ORCH_MOCK;
});
