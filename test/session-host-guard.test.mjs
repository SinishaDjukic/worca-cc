// test/session-host-guard.test.mjs — the host-only hook refuses the main agent's own tools, never a sub-agent's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardDecision, sessionHostGuardSettings, SESSION_GUARD_REASON } from '../src/core/session-host-guard.mjs';

const FILE = fileURLToPath(new URL('../src/core/session-host-guard.mjs', import.meta.url));

test('decision: the main thread may only call Agent/Task; a sub-agent call (context field present) is never touched', () => {
  assert.equal(guardDecision({ tool_name: 'Bash' }, { field: 'agent_id' }), 'deny');
  assert.equal(guardDecision({ tool_name: 'Agent' }, { field: 'agent_id' }), 'allow');
  assert.equal(guardDecision({ tool_name: 'Write', agent_id: 'a1' }, { field: 'agent_id' }), 'allow');
  assert.equal(guardDecision({ tool_name: 'Bash' }, { field: null }), 'allow', 'no proven field: never guess (fail-open)');
});

test('the settings entry runs this file; the CLI half denies with the hook protocol and is fail-open on junk', () => {
  const s = sessionHostGuardSettings();
  assert.equal(s.hooks.PreToolUse[0].matcher, '*');
  const deny = spawnSync(process.execPath, [FILE], { input: JSON.stringify({ tool_name: 'Bash' }), env: { ...process.env, WORCA_SESSION_GUARD_FIELD: 'agent_id' }, encoding: 'utf8' });
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const junk = spawnSync(process.execPath, [FILE], { input: 'not json', encoding: 'utf8' });
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout.trim(), '');
});

// ── v2 ──
const run = (payload, args = [], env = {}) => spawnSync(process.execPath, [FILE, ...args],
  { input: typeof payload === 'string' ? payload : JSON.stringify(payload), env: { ...process.env, WORCA_SESSION_GUARD_FIELD: '', ...env }, encoding: 'utf8' });

test('v2 — decision edges: Task is a dispatch tool; an empty context value is the main thread; junk payloads allow', () => {
  assert.equal(guardDecision({ tool_name: 'Task' }, { field: 'agent_id' }), 'allow');
  assert.equal(guardDecision({ tool_name: 'Bash', agent_id: '' }, { field: 'agent_id' }), 'deny');
  assert.equal(guardDecision({ tool_name: 'Bash', agent_id: null }, { field: 'agent_id' }), 'deny');
  assert.equal(guardDecision({ tool_name: 'Bash', agent_id: 0 }, { field: 'agent_id' }), 'allow', 'any present value is a sub-agent');
  assert.equal(guardDecision(null, { field: 'agent_id' }), 'allow');
  assert.equal(guardDecision('Bash', { field: 'agent_id' }), 'allow');
  assert.equal(guardDecision({ tool_name: 'Bash' }), 'allow', 'the default field is none');
});

test('v2 — the hook command: node, this file and the field as quoted arguments; the CLI reads the field from argv first', () => {
  const s = sessionHostGuardSettings({ field: 'agent_id' });
  const h = s.hooks.PreToolUse[0].hooks[0];
  assert.equal(h.type, 'command');
  assert.equal(h.command, [process.execPath, FILE, 'agent_id'].map((x) => JSON.stringify(x.replaceAll('\\', '/'))).join(' '));
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(sessionHostGuardSettings().hooks.PreToolUse[0].hooks[0].command.endsWith(JSON.stringify(FILE.replaceAll('\\', '/'))), true, 'no field: no argument');
  const deny = run({ tool_name: 'Write' }, ['agent_id']);
  assert.deepEqual(JSON.parse(deny.stdout), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: SESSION_GUARD_REASON } });
  assert.equal(deny.status, 0);
  assert.equal(SESSION_GUARD_REASON, 'the main agent only dispatches');
  assert.equal(run({ tool_name: 'Write', agent_id: 'a1' }, ['agent_id']).stdout, '', 'a sub-agent\'s call: silent allow');
  assert.equal(run({ tool_name: 'Agent' }, ['agent_id']).stdout, '');
  assert.equal(run({ tool_name: 'Write' }).stdout, '', 'no field anywhere: allow');
});

test('v3 — S3 records the context field comma-joined: any listed name present marks a sub-agent\'s call', () => {
  const field = 'agent_id, agent_type';
  assert.equal(guardDecision({ tool_name: 'Write', agent_id: 'a1' }, { field }), 'allow');
  assert.equal(guardDecision({ tool_name: 'Write', agent_type: 'worca-x-n_a-1-a1' }, { field }), 'allow');
  assert.equal(guardDecision({ tool_name: 'Write' }, { field }), 'deny');
  assert.equal(guardDecision({ tool_name: 'Write' }, { field: ' , ' }), 'allow', 'no name at all: never guess');
  assert.equal(run({ tool_name: 'Write', agent_type: 'x' }, ['agent_id,agent_type']).stdout, '', 'the CLI reads the list too');
  assert.equal(JSON.parse(run({ tool_name: 'Write' }, ['agent_id,agent_type']).stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('v4 — fail-open: a payload with no string tool_name ({}, an array, a number) is allowed, by the function and the CLI', () => {
  for (const p of [{}, [], { tool_name: 42 }]) {
    assert.equal(guardDecision(p, { field: 'agent_id' }), 'allow', JSON.stringify(p));
    assert.equal(run(p, ['agent_id']).stdout, '', `the CLI: ${JSON.stringify(p)}`);
  }
});
