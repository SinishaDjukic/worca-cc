// test/subagent-hook-stream.test.mjs — sub-agent hook telemetry against REAL
// captured stream-json (test/fixtures/hooks/*.jsonl, see *.meta.json).
//
// Captured with Claude Code 2.1.282 through the telemetry settings worca sends
// (`--include-hook-events` + a PostToolUse hook matched to `Agent` running `cat`).
// Hook lifecycle lines look like
//   {"type":"system","subtype":"hook_started"|"hook_response","hook_name":"PostToolUse:Agent",
//    "hook_event":"PostToolUse","output":…,"stdout":…,"exit_code":0,"outcome":"success",…}
// There is no `hook-event` type and no top-level `hook_event_name`. The
// PostToolUse payload (tool_use_id, tool_response) is not on the envelope at all:
// it only reaches the stream as the hook command's echoed stdout.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, isHookEvent, buildHookSettings } from '../src/core/claude-runner.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hooks');
const FOREGROUND = join(FIXTURES, 'subagent-foreground.jsonl');
const BACKGROUND = join(FIXTURES, 'subagent-background.jsonl');
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };
const ATTR = { nodeId: 'n1', stepIndex: 0, cycle: 1, stepKey: '0:n1' };

const tmpDirs = [];
after(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

let prevMock, prevOrch;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK;
  prevOrch = process.env.ORCH_MOCK;
  delete process.env.WORCA_MOCK;
  delete process.env.ORCH_MOCK;
});
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
  delete process.env.WORCA_SUBAGENT_HOOKS;
});

/** A fake `claude` that replays a captured stream on stdout. */
async function replayBin(fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-hooks-'));
  tmpDirs.push(dir);
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, `#!/bin/sh\ncat ${JSON.stringify(fixture)}\n`, 'utf8');
  await chmod(bin, 0o755);
  return { bin, dir };
}

async function replay(fixture) {
  const { bin, dir } = await replayBin(fixture);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  return events;
}

const agentToolUseId = (file) => lines(file)
  .flatMap((f) => (f.type === 'assistant' && Array.isArray(f.message?.content) ? f.message.content : []))
  .find((c) => c.type === 'tool_use' && c.name === 'Agent').id;

test('isHookEvent matches the captured hook lifecycle lines and nothing else', () => {
  const all = lines(FOREGROUND);
  const hooks = all.filter(isHookEvent);
  assert.deepEqual(hooks.map((h) => h.subtype), ['hook_started', 'hook_response']);
  assert.ok(hooks.every((h) => h.hook_name === 'PostToolUse:Agent' && h.hook_event === 'PostToolUse'));
  assert.equal(isHookEvent({ type: 'system', subtype: 'hook_progress', hook_event: 'PostToolUse' }), true);
  assert.equal(isHookEvent({ type: 'system', subtype: 'init' }), false);
  assert.equal(isHookEvent({ type: 'system', subtype: 'task_notification' }), false);
  assert.equal(isHookEvent({ type: 'assistant', subtype: 'hook_response' }), false);
  assert.equal(isHookEvent(null), false);
});

// runClaude delivers the normalized vocabulary (engines/claude-events.mjs): a hook line is `{type:'hook', raw}`.
test('the runner surfaces captured hook lines as hook events, and only as hook events', POSIX_SHIM, async () => {
  const events = await replay(FOREGROUND);
  const hooks = events.filter((e) => e.type === 'hook');
  assert.deepEqual(hooks.map((h) => h.raw.subtype), ['hook_started', 'hook_response']);
  assert.ok(!events.some((e) => e.type !== 'hook' && /^hook_/.test(e.raw?.subtype ?? '')),
    'hook lines are not also emitted as generic system events');
});

test('a foreground hook_response fills duration and tokens from the echoed payload', POSIX_SHIM, async () => {
  const events = await replay(FOREGROUND);
  const id = agentToolUseId(FOREGROUND);
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  // Spawn from the captured sub-agent spawn, then ONLY the hook line: proves the
  // hook path on its own, independent of the tool_use_result finish path.
  orch._onAgentEvent('planner', events.find((e) => e.type === 'subagent' && e.event === 'spawn' && e.toolUseId === id), ATTR);
  const deltas = [];
  orch.on('subagent', (m) => deltas.push(m));
  orch._onAgentEvent('planner', events.find((e) => e.type === 'hook' && e.raw.subtype === 'hook_response'), ATTR);
  const rec = orch.state.subAgents.find((s) => s.id === id);
  assert.equal(rec.durationMs, 1513);
  assert.equal(rec.tokens, 20479);
  assert.equal(rec.costUsd, undefined, 'the CLI payload carries no cost figure');
  assert.deepEqual(deltas.map((d) => d.transition), ['update']);
});

test('the whole foreground stream drives the record to finished with telemetry', POSIX_SHIM, async () => {
  const events = await replay(FOREGROUND);
  const id = agentToolUseId(FOREGROUND);
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  for (const e of events) orch._onAgentEvent('planner', e, ATTR);
  const rec = orch.state.subAgents.find((s) => s.id === id);
  assert.equal(rec.status, 'finished');
  assert.equal(rec.durationMs, 1513);
  assert.equal(rec.tokens, 20479);
});

test('a background launch ack in the hook payload is not telemetry', POSIX_SHIM, async () => {
  const events = await replay(BACKGROUND);
  const id = agentToolUseId(BACKGROUND);
  const hook = events.find((e) => e.type === 'hook' && e.raw.subtype === 'hook_response');
  assert.equal(JSON.parse(hook.raw.stdout).tool_response.status, 'async_launched', 'fixture is a launch ack');
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', events.find((e) => e.type === 'subagent' && e.event === 'spawn' && e.toolUseId === id), ATTR);
  const deltas = [];
  orch.on('subagent', (m) => deltas.push(m));
  orch._onAgentEvent('planner', hook, ATTR);
  assert.equal(deltas.length, 0, 'no update delta for an ack');
  const rec = orch.state.subAgents.find((s) => s.id === id);
  assert.equal(rec.durationMs, undefined);
  assert.equal(rec.status, 'running');
});

test('the whole background stream still closes the record via task_notification', POSIX_SHIM, async () => {
  const events = await replay(BACKGROUND);
  const id = agentToolUseId(BACKGROUND);
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  for (const e of events) orch._onAgentEvent('planner', e, ATTR);
  const rec = orch.state.subAgents.find((s) => s.id === id);
  assert.equal(rec.status, 'finished');
  assert.equal(rec.durationMs, 2142, 'duration from task_notification.usage');
  assert.equal(rec.tokens, 39233);
});

test('hook_started, other hook events, and non-JSON stdout are ignored', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const spawn = { type: 'assistant', raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'toolu_X', name: 'Agent', input: { description: 'd' } }] } } };
  orch._onAgentEvent('planner', spawn, ATTR);
  const payload = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_X',
    tool_response: { status: 'completed', totalDurationMs: 7, totalTokens: 8 } });
  const envelope = (over) => ({ type: 'hook-event', raw: { type: 'system', subtype: 'hook_response',
    hook_name: 'PostToolUse:Agent', hook_event: 'PostToolUse', output: payload, stdout: payload, ...over } });
  orch._onAgentEvent('planner', envelope({ subtype: 'hook_started', output: undefined, stdout: undefined }));
  orch._onAgentEvent('planner', envelope({ hook_event: 'SessionStart', hook_name: 'SessionStart:startup' }));
  orch._onAgentEvent('planner', envelope({ output: 'not json', stdout: 'not json' }));
  assert.equal(orch.state.subAgents[0].durationMs, undefined);
});

test('the telemetry hook echoes its payload synchronously', () => {
  process.env.WORCA_SUBAGENT_HOOKS = '1';
  const [entry] = buildHookSettings().hooks.PostToolUse;
  assert.equal(entry.matcher, 'Agent');
  assert.deepEqual(entry.hooks, [{ type: 'command', command: 'cat' }]);
});
