// test/agent-log.test.mjs
// _onAgentEvent should surface concrete tool calls instead of the bare
// stream-json envelope types (the old noisy `[planner] user` / `system` lines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { posix } from './helpers/posix-path.mjs';
import { checkRows } from './helpers/rows.mjs';

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

test('tool_use lines per tool: Read/Bash/Grep target, several blocks, unknown tool', async () => {
  await checkRows([
    { name: 'assistant tool_use is logged as a readable tool call, not bare "assistant"', run: () => {
      const logs = capture('planner', {
        type: 'assistant',
        raw: {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/src/app.js' } }] },
        },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].source, 'planner');
      assert.equal(posix(logs[0].text), '→ Read src/app.js');
    } },
    { name: 'Bash tool_use shows the command', run: () => {
      const logs = capture('implementer', {
        type: 'assistant',
        raw: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].text, '→ Bash npm test');
    } },
    { name: 'Grep tool_use shows pattern and relative path', run: () => {
      const logs = capture('planner', {
        type: 'assistant',
        raw: {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'role', path: '/tmp/proj/src' } }] },
        },
      });
      assert.equal(posix(logs[0].text), '→ Grep "role" src');
    } },
    { name: 'multiple tool_use blocks in one event each get their own line', run: () => {
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
      assert.deepEqual(logs.map((l) => posix(l.text)), ['→ Read a.js', '→ Write b.js']);
    } },
    { name: 'unknown tool with no recognizable target logs just its name', run: () => {
      const logs = capture('planner', {
        type: 'assistant',
        raw: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [] } }] } },
      });
      assert.equal(logs[0].text, '→ TodoWrite');
    } },
  ]);
});

test('system init envelope logs [init] model=… at debug', () => {
  const logs = capture('planner', { type: 'system', raw: { type: 'system', subtype: 'init', model: 'claude-x' } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'debug');
  assert.equal(logs[0].text, '[init] model=claude-x');
  const noModel = capture('planner', { type: 'system', raw: { type: 'system', subtype: 'init' } });
  assert.equal(noModel.length, 1);
  assert.equal(noModel[0].text, '[init] model=?');
});

// The CLI retries a failed API call silently and reports each retry ONLY as this
// stdout frame (CLI 2.1.281, captured live against a dead endpoint): no text, no
// stderr. Dropping it left a run that retried a timing-out call for an hour with
// no log line at all (2026-09-28).
const apiRetry = (over = {}) => ({
  type: 'system',
  raw: { type: 'system', subtype: 'api_retry', attempt: 5, max_retries: 10, retry_delay_ms: 4103, error_status: null, error: 'unknown', session_id: 's', ...over },
});

test('api_retry frames log one warn line per category (no status, HTTP status, waited, named category)', async () => {
  await checkRows([
    { name: 'api_retry with no HTTP status logs a timeout/connection warning with the attempt and backoff', run: () => {
      const logs = capture('workspaceScanner', apiRetry());
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'warn');
      assert.equal(logs[0].source, 'workspaceScanner');
      assert.equal(logs[0].text, 'API call failed: no HTTP response (timeout or connection error); retry 5/10 in 4.1s');
    } },
    { name: 'api_retry with an HTTP status names the CLI category and the status', run: () => {
      const logs = capture('planner', apiRetry({ attempt: 2, error_status: 529, error: 'overloaded', retry_delay_ms: 1200 }));
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'warn');
      assert.equal(logs[0].text, 'API call failed: overloaded (HTTP 529); retry 2/10 in 1.2s');
    } },
    { name: 'api_retry reports how long a no-response attempt waited', run: () => {
      const logs = capture('planner', apiRetry({ attempt: 1, retry_delay_ms: 500, no_response: { waited_ms: 300000, retry_wait_ms: 500 } }));
      assert.equal(logs[0].text, 'API call failed: no HTTP response (timeout or connection error) after 300.0s; retry 1/10 in 0.5s');
    } },
    { name: 'api_retry with a status-less named category keeps the category', run: () => {
      const logs = capture('planner', apiRetry({ attempt: 1, error: 'cloud_credential_error', retry_delay_ms: 500 }));
      assert.equal(logs[0].text, 'API call failed: cloud_credential_error; retry 1/10 in 0.5s');
    } },
  ]);
});

test('api_retry from a sub-agent is attributed to it', () => {
  const logs = captureSeq([
    ['workspaceScanner', { type: 'assistant', raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_A', name: 'Agent', input: { description: 'Investigate hawkbit' } }] } } }],
    ['workspaceScanner', { type: 'system', raw: { ...apiRetry().raw, parent_tool_use_id: 'toolu_A' } }],
  ]);
  const retry = logs.find((l) => l.text.startsWith('API call failed'));
  assert.ok(retry, 'retry line logged');
  assert.equal(retry.source, 'workspaceScanner ▸ Investigate hawkbit');
  assert.equal(retry.sub, true);
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

test('sub-agent tagging: child text/tool_use/tool_result get "role ▸ desc" + sub; main-agent and string-raw lines stay plain', async () => {
  await checkRows([
    { name: 'sub-agent assistant text is tagged "role ▸ <desc>" with sub=true; parent Task stays plain', run: () => {
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
    } },
    { name: 'a sub-agent tool_use (Read) is tagged + sub by the same parent id', run: () => {
      const TASK_ID = 'toolu_02';
      const logs = captureSeq([
        ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
          { type: 'tool_use', id: TASK_ID, name: 'Task', input: { description: 'research auth' } } ] } } }],
        ['planner', { type: 'assistant', raw: { type: 'assistant', parent_tool_use_id: TASK_ID, message: { content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/src/auth.js' } } ] } } }],
      ]);
      assert.equal(logs[1].source, 'planner ▸ research auth');
      assert.equal(posix(logs[1].text), '→ Read src/auth.js');
      assert.equal(logs[1].sub, true);
    } },
    { name: 'child tool_result is tagged "role ▸ label" + sub', run: () => {
      const logs = captureSeq([
        ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
          { type: 'tool_use', id: 't1', name: 'Task', input: { description: 'research auth' } } ] } } }],
        ['planner', { type: 'user', raw: { type: 'user', parent_tool_use_id: 't1', message: { content: [
          { type: 'tool_result', tool_use_id: 'r1', content: 'ok' } ] } } }],
      ]);
      const line = logs.find((l) => l.text === '← result ok r1');
      assert.ok(line, 'child tool_result line exists');
      assert.equal(line.source, 'planner ▸ research auth');
      assert.equal(line.sub, true);
      assert.equal(line.level, 'debug');
    } },
    { name: 'main-agent events are unchanged: plain role source, no sub', run: () => {
      const logs = captureSeq([
        ['planner', { type: 'assistant', text: 'Thinking.', raw: { type: 'assistant', message: { content: [] } } }],
      ]);
      assert.equal(logs[0].source, 'planner');
      assert.equal(logs[0].sub, undefined);
    } },
    // OPTIONAL — a string `raw` on a child-shaped event falls back to the plain role
    { name: 'string raw (non-JSON runner line) stays under the plain role, no sub', run: () => {
      const logs = captureSeq([
        ['planner', { type: 'log', text: 'a non-JSON stdout line', raw: 'a non-JSON stdout line' }],
      ]);
      assert.equal(logs[0].source, 'planner');
      assert.equal(logs[0].text, 'a non-JSON stdout line');
      assert.equal(logs[0].sub, undefined);
    } },
  ]);
});

test('sub-agent labels: distinct descriptions, stable sub-agent-N fallback ordinals', async () => {
  await checkRows([
    { name: 'fallback: an unregistered parent id gets a stable sub-agent-N ordinal', run: () => {
      const logs = captureSeq([
        ['planner', { type: 'assistant', text: 'a', raw: { type: 'assistant', parent_tool_use_id: 'orphan_A', message: { content: [] } } }],
        ['planner', { type: 'assistant', text: 'b', raw: { type: 'assistant', parent_tool_use_id: 'orphan_B', message: { content: [] } } }],
        ['planner', { type: 'assistant', text: 'c', raw: { type: 'assistant', parent_tool_use_id: 'orphan_A', message: { content: [] } } }],
      ]);
      assert.equal(logs[0].source, 'planner ▸ sub-agent-1');
      assert.equal(logs[1].source, 'planner ▸ sub-agent-2');
      assert.equal(logs[2].source, 'planner ▸ sub-agent-1'); // same id → same ordinal
    } },
    { name: 'two distinct described sub-agents get distinct description tags', run: () => {
      const logs = captureSeq([
        ['planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
          { type: 'tool_use', id: 't1', name: 'Task',  input: { description: 'research auth' } },
          { type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'audit deps' } } ] } } }],
        ['planner', { type: 'assistant', text: 'x', raw: { type: 'assistant', parent_tool_use_id: 't1', message: { content: [] } } }],
        ['planner', { type: 'assistant', text: 'y', raw: { type: 'assistant', parent_tool_use_id: 't2', message: { content: [] } } }],
      ]);
      assert.equal(logs.find((l) => l.text === 'x').source, 'planner ▸ research auth');
      assert.equal(logs.find((l) => l.text === 'y').source, 'planner ▸ audit deps');
    } },
  ]);
});

// ── Agent-log parity: mixed turns, tool results, init ───────────────────────

test('assistant turns: text-only = one info line; mixed turns = info text then one debug line per tool, in order', async () => {
  await checkRows([
    { name: 'assistant text still logs at info unchanged', run: () => {
      const logs = capture('planner', { type: 'assistant', text: 'Considering the design.', raw: {} });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'info');
      assert.equal(logs[0].text, 'Considering the design.');
    } },
    { name: 'mixed turn logs text at info AND each tool call at debug', run: () => {
      const logs = capture('planner', {
        type: 'assistant',
        text: 'Planning.',
        raw: {
          type: 'assistant',
          message: { content: [
            { type: 'text', text: 'Planning.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/a.js' } },
          ] },
        },
      });
      assert.deepEqual(logs.map((l) => [l.level, posix(l.text)]), [
        ['info', 'Planning.'],
        ['debug', '→ Read a.js'],
      ]);
    } },
    { name: 'mixed turn with two tools logs one info + two debug, in order', run: () => {
      const logs = capture('planner', {
        type: 'assistant',
        text: 'Working.',
        raw: {
          type: 'assistant',
          message: { content: [
            { type: 'text', text: 'Working.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/proj/a.js' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
          ] },
        },
      });
      assert.deepEqual(logs.map((l) => [l.level, posix(l.text)]), [
        ['info', 'Working.'],
        ['debug', '→ Read a.js'],
        ['debug', '→ Bash npm test'],
      ]);
    } },
    { name: 'text-only turn stays a single info line (no trailing tool/result line)', run: () => {
      const logs = capture('planner', {
        type: 'assistant',
        text: 'Just text.',
        raw: { type: 'assistant', message: { content: [{ type: 'text', text: 'Just text.' }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'info');
      assert.equal(logs[0].text, 'Just text.');
    } },
  ]);
});

test('tool_result lines: ok/error, 8-char id, missing id, debug level, no sub-agent finish for an untracked id', async () => {
  await checkRows([
    { name: 'user tool_result envelope logs ← result at debug and emits no subagent', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      const logs = []; const subs = [];
      orch.on('log', (l) => logs.push(l));
      orch.on('subagent', (m) => subs.push(m));
      orch._onAgentEvent('planner', {
        type: 'user',
        raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'debug');
      assert.equal(logs[0].text, '← result ok x');
      assert.equal(subs.length, 0, 'an untracked tool_use_id is not a sub-agent finish');
    } },
    { name: 'tool_result ok truncates id to 8 chars', run: () => {
      const logs = capture('planner', {
        type: 'user',
        raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01ABCDEFGH', content: 'ok' }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'debug');
      assert.equal(logs[0].text, '← result ok toolu_01');
    } },
    { name: 'tool_result error renders error', run: () => {
      const logs = capture('planner', {
        type: 'user',
        raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_9fXYZ', is_error: true, content: 'boom' }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].text, '← result error toolu_9f');
    } },
    { name: 'tool_result with missing id renders ?', run: () => {
      const logs = capture('planner', {
        type: 'user',
        raw: { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].text, '← result ok ?');
    } },
  ]);
});

test('sub-agent finish still fires lifecycle AND logs a result line', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const logs = []; const subs = [];
  orch.on('log', (l) => logs.push(l));
  orch.on('subagent', (m) => subs.push(m));
  const attr = { nodeId: 'n1', stepIndex: 0, cycle: 1, stepKey: 'planner@1' };
  orch._onAgentEvent('planner', { type: 'assistant', raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 't1', name: 'Task', input: { description: 'research auth' } } ] } } }, attr);
  orch._onAgentEvent('planner', { type: 'user', raw: { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 't1', content: 'done' } ] } } }, attr);
  assert.ok(subs.some((m) => m.id === 't1' && m.status === 'finished'), 'a sub-agent finish delta fired');
  assert.ok(logs.some((l) => l.text === '← result ok t1'), 'the finish also logs a ← result line');
});

test('step attribution (nodeId/stepIndex/cycle) rides on sub-agent, init and stderr lines', async () => {
  await checkRows([
    // OPTIONAL — a sub-agent line retains its step attribution (nodeId/stepIndex/cycle)
    { name: 'sub-agent line preserves nodeId/stepIndex/cycle attribution and adds sub', run: () => {
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
    } },
    { name: 'init line carries step attribution', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      const logs = [];
      orch.on('log', (l) => logs.push(l));
      orch._onAgentEvent('planner',
        { type: 'system', raw: { type: 'system', subtype: 'init', model: 'claude-x' } },
        { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: 'planner@1' });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].text, '[init] model=claude-x');
      assert.equal(logs[0].nodeId, 'n1');
      assert.equal(logs[0].stepIndex, 2);
      assert.equal(logs[0].cycle, 1);
    } },
    { name: 'a stderr line carries step attribution like any other line', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      const logs = [];
      orch.on('log', (l) => logs.push(l));
      orch._onAgentEvent('implementer',
        { type: 'stderr', stream: 'err', text: 'API 529, backing off' },
        { nodeId: 'n2', stepIndex: 3, cycle: 2, stepKey: '3:n2#2' });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].nodeId, 'n2');
      assert.equal(logs[0].stepIndex, 3);
      assert.equal(logs[0].cycle, 2);
      assert.equal(logs[0].stream, 'err');
    } },
  ]);
});

// ── stderr (stream:'err') ───────────────────────────────────────────────────

test('stderr: warn + stream:"err" on the plain role; blank lines dropped; other lines carry no stream', async () => {
  await checkRows([
    { name: 'a stderr event logs at warn, tagged stream:"err"', run: () => {
      const logs = capture('planner', { type: 'stderr', stream: 'err', text: 'Overloaded, retrying in 4s' });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].source, 'planner', 'plain role — stderr is always main-stream');
      assert.equal(logs[0].level, 'warn', 'NOT error: this is mostly retry/throttle chatter');
      assert.equal(logs[0].stream, 'err');
      assert.equal(logs[0].text, 'Overloaded, retrying in 4s');
      assert.equal(logs[0].sub, undefined);
    } },
    { name: 'an empty/whitespace stderr event logs nothing', run: () => {
      assert.equal(capture('planner', { type: 'stderr', stream: 'err', text: '   ' }).length, 0);
      assert.equal(capture('planner', { type: 'stderr', stream: 'err' }).length, 0);
    } },
    { name: 'lines without stderr provenance carry no stream field', run: () => {
      const logs = capture('planner', { type: 'assistant', text: 'Planning.', raw: { type: 'assistant' } });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].stream, undefined);
    } },
  ]);
});

test('a stderr event never touches the tool/init/result branches', () => {
  // Poison raw: if the stderr early-return vanished, this tool_use payload
  // would fall through to the reducers and log '→ Read x.js'.
  const logs = capture('planner', {
    type: 'stderr', stream: 'err', text: 'plain noise',
    raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 't9', name: 'Read', input: { file_path: '/tmp/proj/x.js' } },
    ] } },
  });
  assert.equal(logs.length, 1, 'exactly the warn line, nothing from the reducers');
  assert.equal(logs[0].level, 'warn');
  assert.equal(logs[0].text, 'plain noise');
  assert.ok(!logs.some((l) => /^[←→]|\[init\]/.test(l.text)), 'no arrow/init line');
});

test('result event never logs a [done]/turns line', () => {
  const logs = capture('planner', {
    type: 'result',
    costUsd: 0,
    raw: { type: 'result', total_cost_usd: 0, result: '' },
  });
  assert.ok(!logs.some((l) => /turns|\[done\]/.test(l.text)), 'no [done]/turns line');
  assert.ok(!logs.some((l) => /^[←→]|\[init\]/.test(l.text)), 'no arrow/init line either');
});

test('Bash description (#911 slice 3): carried as desc, text keeps the raw command; Codex has none', async () => {
  await checkRows([
    { name: 'Claude Bash with a description logs both', run: () => {
      const logs = capture('implementer', {
        type: 'assistant',
        raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash',
          input: { command: 'node --test test/naming.test.mjs', description: 'Run the naming tests' } }] } },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].text, '→ Bash node --test test/naming.test.mjs');
      assert.equal(logs[0].desc, 'Run the naming tests');
    } },
    { name: 'no description: no desc key', run: () => {
      const logs = capture('implementer', {
        type: 'assistant',
        raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } },
      });
      assert.equal(logs[0].text, '→ Bash npm test');
      assert.equal('desc' in logs[0], false);
    } },
    { name: 'a Codex command (normalized, no description) stays raw', run: () => {
      const logs = capture('implementer', { type: 'tool', parentId: null,
        calls: [{ name: 'Bash', input: { command: "/bin/zsh -lc 'cat a.txt'" }, toolUseId: 'c1' }] });
      assert.equal(logs[0].text, "→ Bash /bin/zsh -lc 'cat a.txt'");
      assert.equal('desc' in logs[0], false);
    } },
    { name: 'a long description is clipped to 120; a non-string one is ignored', run: () => {
      const long = 'x'.repeat(200);
      const a = capture('implementer', { type: 'tool', parentId: null,
        calls: [{ name: 'Bash', input: { command: 'ls', description: long }, toolUseId: 'c2' }] });
      assert.equal(a[0].desc.length, 120);
      assert.ok(a[0].desc.endsWith('…'));
      const b = capture('implementer', { type: 'tool', parentId: null,
        calls: [{ name: 'Bash', input: { command: 'ls', description: { x: 1 } }, toolUseId: 'c3' }] });
      assert.equal('desc' in b[0], false);
    } },
    { name: 'a non-Bash tool with a description gets no desc, and its text is unchanged', run: () => {
      const logs = capture('planner', { type: 'tool', parentId: null,
        calls: [{ name: 'Read', input: { file_path: '/tmp/proj/a.js', description: 'nope' }, toolUseId: 'c4' }] });
      assert.equal(posix(logs[0].text), '→ Read a.js');   // the file's own posix() helper, as its Read rows use
      assert.equal('desc' in logs[0], false);
    } },
  ]);
});
