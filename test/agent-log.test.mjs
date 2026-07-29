// test/agent-log.test.mjs
// _onAgentEvent should surface concrete tool calls instead of the bare
// stream-json envelope types (the old noisy `[planner] user` / `system` lines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

function capture(role, evt, projectDir = '/tmp/proj') {
  const orch = createOrchestrator({ projectDir });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  orch._onAgentEvent(role, evt);
  return logs;
}

// Drive several [role, event] (optionally [role, event, attr]) tuples through ONE
// orchestrator so sub-agent label state (this._subAgentLabels / _subAgentFallbackSeq)
// accumulates across them.
function captureSeq(events, projectDir = '/tmp/proj') {
  const orch = createOrchestrator({ projectDir });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  for (const [role, evt, attr] of events) orch._onAgentEvent(role, evt, attr);
  return logs;
}

test('assistant tool_use is logged as a readable tool call, not bare "assistant"', () => {
  const logs = capture('planner', {
    type: 'assistant',
    raw: {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/src/app.js' } }] },
    },
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, 'planner');
  assert.equal(logs[0].text, '→ Read src/app.js');
});

test('bare user (tool_result) envelope events are dropped (log) and emit no subagent', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const logs = []; const subs = [];
  orch.on('log', (l) => logs.push(l));
  orch.on('subagent', (m) => subs.push(m));
  orch._onAgentEvent('planner', {
    type: 'user',
    raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
  });
  assert.equal(logs.length, 0, 'tool_result echoes carry no log line');
  assert.equal(subs.length, 0, 'an untracked tool_use_id is not a sub-agent finish');
});

test('system init envelope events are dropped', () => {
  const logs = capture('planner', { type: 'system', raw: { type: 'system', subtype: 'init' } });
  assert.equal(logs.length, 0);
});

test('assistant text still logs at info unchanged', () => {
  const logs = capture('planner', { type: 'assistant', text: 'Considering the design.', raw: {} });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'info');
  assert.equal(logs[0].text, 'Considering the design.');
});

test('Bash tool_use shows the command', () => {
  const logs = capture('implementer', {
    type: 'assistant',
    raw: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].text, '→ Bash npm test');
});

test('Grep tool_use shows pattern and relative path', () => {
  const logs = capture('planner', {
    type: 'assistant',
    raw: {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'role', path: '/tmp/proj/src' } }] },
    },
  });
  assert.equal(logs[0].text, '→ Grep "role" src');
});

test('multiple tool_use blocks in one event each get their own line', () => {
  const logs = capture('planner', {
    type: 'assistant',
    raw: {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/a.js' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/proj/b.js' } },
        ],
      },
    },
  });
  assert.deepEqual(logs.map((l) => l.text), ['→ Read a.js', '→ Write b.js']);
});

test('unknown tool with no recognizable target logs just its name', () => {
  const logs = capture('planner', {
    type: 'assistant',
    raw: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [] } }] } },
  });
  assert.equal(logs[0].text, '→ TodoWrite');
});

test('mock tool_use events (text + raw.file) still log their message at info', () => {
  // The offline mock emits { type:'tool_use', text:'wrote <path>', raw:{file} }.
  const logs = capture('implementer', {
    type: 'tool_use',
    text: 'wrote /tmp/proj/out.json',
    raw: { mock: true, file: '/tmp/proj/out.json' },
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'info');
  assert.equal(logs[0].text, 'wrote /tmp/proj/out.json');
});

// ── Sub-agent log separation (fan-out) ──────────────────────────────────────

test('sub-agent assistant text is tagged "role ▸ <desc>" with sub=true; parent Task stays plain', () => {
  const TASK_ID = 'toolu_01';
  const logs = captureSeq([
    ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: TASK_ID, name: 'Task', input: { description: 'research auth' } },
    ] } } }],
    ['planner', { type: 'assistant', text: 'Reading the auth module.',
      raw: { type: 'assistant', parent_tool_use_id: TASK_ID, message: { content: [] } } }],
  ]);
  assert.equal(logs[0].source, 'planner');                 // parent's own Task call
  assert.equal(logs[0].text, '→ Task research auth');
  assert.equal(logs[0].sub, undefined);
  assert.equal(logs[1].source, 'planner ▸ research auth'); // the sub-agent's text
  assert.equal(logs[1].level, 'info');
  assert.equal(logs[1].text, 'Reading the auth module.');
  assert.equal(logs[1].sub, true);
});

test('a sub-agent tool_use (Read) is tagged + sub by the same parent id', () => {
  const TASK_ID = 'toolu_02';
  const logs = captureSeq([
    ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: TASK_ID, name: 'Task', input: { description: 'research auth' } } ] } } }],
    ['planner', { type: 'assistant', raw: { type: 'assistant', parent_tool_use_id: TASK_ID, message: { content: [
      { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/src/auth.js' } } ] } } }],
  ]);
  assert.equal(logs[1].source, 'planner ▸ research auth');
  assert.equal(logs[1].text, '→ Read src/auth.js');
  assert.equal(logs[1].sub, true);
});

test('main-agent events are unchanged: plain role source, no sub', () => {
  const logs = captureSeq([
    ['planner', { type: 'assistant', text: 'Thinking.', raw: { type: 'assistant', message: { content: [] } } }],
  ]);
  assert.equal(logs[0].source, 'planner');
  assert.equal(logs[0].sub, undefined);
});

test('fallback: an unregistered parent id gets a stable sub-agent-N ordinal', () => {
  const logs = captureSeq([
    ['planner', { type: 'assistant', text: 'a', raw: { type: 'assistant', parent_tool_use_id: 'orphan_A', message: { content: [] } } }],
    ['planner', { type: 'assistant', text: 'b', raw: { type: 'assistant', parent_tool_use_id: 'orphan_B', message: { content: [] } } }],
    ['planner', { type: 'assistant', text: 'c', raw: { type: 'assistant', parent_tool_use_id: 'orphan_A', message: { content: [] } } }],
  ]);
  assert.equal(logs[0].source, 'planner ▸ sub-agent-1');
  assert.equal(logs[1].source, 'planner ▸ sub-agent-2');
  assert.equal(logs[2].source, 'planner ▸ sub-agent-1'); // same id → same ordinal
});

test('two distinct described sub-agents get distinct description tags', () => {
  const logs = captureSeq([
    ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 't1', name: 'Task',  input: { description: 'research auth' } },
      { type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'audit deps' } } ] } } }],
    ['planner', { type: 'assistant', text: 'x', raw: { type: 'assistant', parent_tool_use_id: 't1', message: { content: [] } } }],
    ['planner', { type: 'assistant', text: 'y', raw: { type: 'assistant', parent_tool_use_id: 't2', message: { content: [] } } }],
  ]);
  assert.equal(logs.find((l) => l.text === 'x').source, 'planner ▸ research auth');
  assert.equal(logs.find((l) => l.text === 'y').source, 'planner ▸ audit deps');
});

// OPTIONAL — a sub-agent line retains its step attribution (nodeId/stepIndex/cycle)
test('sub-agent line preserves nodeId/stepIndex/cycle attribution and adds sub', () => {
  const TASK_ID = 'toolu_03';
  const attr = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: 'planner@1' };
  const logs = captureSeq([
    ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: TASK_ID, name: 'Task', input: { description: 'research auth' } } ] } } }, attr],
    ['planner', { type: 'assistant', text: 'child line',
      raw: { type: 'assistant', parent_tool_use_id: TASK_ID, message: { content: [] } } }, attr],
  ]);
  const child = logs.find((l) => l.text === 'child line');
  assert.equal(child.source, 'planner ▸ research auth');
  assert.equal(child.sub, true);
  assert.equal(child.nodeId, 'n1');
  assert.equal(child.stepIndex, 2);
  assert.equal(child.cycle, 1);
});

// OPTIONAL — a string `raw` on a child-shaped event falls back to the plain role
test('string raw (non-JSON runner line) stays under the plain role, no sub', () => {
  const logs = captureSeq([
    ['planner', { type: 'log', text: 'a non-JSON stdout line', raw: 'a non-JSON stdout line' }],
  ]);
  assert.equal(logs[0].source, 'planner');
  assert.equal(logs[0].text, 'a non-JSON stdout line');
  assert.equal(logs[0].sub, undefined);
});
