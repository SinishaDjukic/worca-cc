// test/engines-registry.test.mjs — the engine registry and the capability map
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine, listEngines, CAPABILITY_KEYS } from '../src/core/engines/index.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

afterEach(() => { delete process.env.WORCA_MOCK; });

test('claude is the default engine', () => {
  assert.equal(getEngine().name, 'claude');
  assert.equal(getEngine('').name, 'claude');
  assert.equal(getEngine(' claude ').name, 'claude');
});

test('an unknown engine is a hard error, even in mock mode', () => {
  assert.throws(() => getEngine('codx'), /unknown engine "codx" \(known: claude, codex, mock\)/);
  assert.throws(() => getEngine('codx', { mock: true }), /unknown engine "codx"/);
});

test('mock:true resolves any known engine to the mock adapter', () => {
  assert.equal(getEngine('claude', { mock: true }).name, 'mock');
  assert.equal(getEngine('codex', { mock: true }).name, 'mock');
});

test('every engine is a full adapter', () => {
  assert.deepEqual(listEngines().map((e) => e.name), ['claude', 'codex', 'mock']);
  for (const engine of listEngines()) {
    assert.deepEqual(Object.keys(engine.capabilities).sort(), [...CAPABILITY_KEYS].sort(), engine.name);
    assert.equal(typeof engine.run, 'function');
    assert.equal(typeof engine.classifyError, 'function');
  }
});

test('the capability keys are the thirteen the design lists', () => {
  assert.deepEqual([...CAPABILITY_KEYS], [
    'resume', 'systemPromptFlag', 'allowedTools', 'effort', 'cost', 'subagents',
    'hookTelemetry', 'streamEvents', 'skills',
    'mcpTools', 'permissionRules', 'subagentSystemPrompt', 'turnBudget',
  ]);
});

test('claude and mock declare every key true, so nothing degrades', () => {
  for (const engine of listEngines().filter((e) => e.name === 'claude' || e.name === 'mock')) {
    for (const k of CAPABILITY_KEYS) assert.equal(engine.capabilities[k], true, `${engine.name}.${k}`);
    assert.equal(typeof engine.run, 'function');
    assert.equal(typeof engine.classifyError, 'function');
  }
});

test('WORCA_MOCK=1 routes runClaude to the mock adapter (no process spawned)', async () => {
  process.env.WORCA_MOCK = '1';
  const events = [];
  const r = await runClaude({ cwd: process.cwd(), prompt: 'x\nMOCK_ROLE: registrytest', onEvent: (e) => events.push(e) });
  assert.equal(r.exitCode, 0);
  assert.ok(events.some((e) => e.type === 'session' && e.sessionId === 'mock-session-registrytest-c1'));
});

import { isNormalized } from '../src/core/engines/events.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('runClaude emits only the normalized vocabulary (mock implementer: session, sub-agents, result)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'worca-registry-'));
  try {
    const events = [];
    await runClaude({ cwd, mock: true, prompt: 'x\nMOCK_ROLE: implementer', onEvent: (e) => events.push(e) });
    assert.ok(events.length > 0);
    for (const e of events) assert.ok(isNormalized(e), `not normalized: ${JSON.stringify(e).slice(0, 120)}`);
    const types = new Set(events.map((e) => e.type));
    for (const t of ['session', 'subagent', 'tool', 'result']) assert.ok(types.has(t), `has ${t}`);
    assert.equal(events.find((e) => e.type === 'result').costUsd, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
