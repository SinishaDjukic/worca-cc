// test/server-event-names.test.mjs — wireRun must forward the new 'stepskills'
// event through the pass-through broadcast (tagged with the run UUID), exactly as
// it forwards 'subagent'. EVENT_NAMES is not exported, so assert BEHAVIORALLY via
// the buffered events on the run entry (mirrors ui-runs-live-id.test.mjs).
// §7.3 adds 'stepgraphify' to the same list: the orchestrator emitted it and the
// client handled it, but the server never forwarded it, so the badge only ever
// appeared after a reload (via the persisted column), never live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runs, _testing } from '../ui/server.mjs';

function makeEntry(overrides = {}) {
  return {
    id: 'uuid-SK1',
    orch: new EventEmitter(),
    projectDir: '/tmp/x',
    title: 't',
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    ...overrides,
  };
}

test("wireRun: 'stepskills' events are forwarded, tagged with the run UUID", () => {
  const entry = makeEntry({ id: 'uuid-SK1' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('stepskills', { nodeId: 'n1', cycle: 1, skills: ['skill:graphify'] });
    const buffered = entry.events.filter((e) => e.type === 'stepskills');
    assert.equal(buffered.length, 1, 'stepskills event is buffered/forwarded');
    assert.equal(buffered[0].runId, 'uuid-SK1', 'tagged with the run UUID');
    assert.deepEqual(buffered[0].skills, ['skill:graphify']);
    assert.equal(buffered[0].nodeId, 'n1');
    assert.equal(buffered[0].cycle, 1);
    assert.equal(entry.status, 'running', 'a stepskills event must not change run status');
  } finally {
    runs.delete(entry.id);
  }
});

test("§7.3 wireRun: 'stepgraphify' events are forwarded, tagged with the run UUID", () => {
  const entry = makeEntry({ id: 'uuid-GR1' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('stepgraphify', { nodeId: 'n1', cycle: 1, graphifyCount: 3 });
    const buffered = entry.events.filter((e) => e.type === 'stepgraphify');
    assert.equal(buffered.length, 1, 'stepgraphify event is buffered/forwarded');
    assert.equal(buffered[0].runId, 'uuid-GR1', 'tagged with the run UUID');
    assert.equal(buffered[0].graphifyCount, 3);
    assert.equal(buffered[0].nodeId, 'n1');
    assert.equal(buffered[0].cycle, 1);
    assert.equal(entry.status, 'running', 'a stepgraphify event must not change run status');
  } finally {
    runs.delete(entry.id);
  }
});

// The three-part MCP labels and the overflow sentinel are opaque strings to the
// transport — pinned so a future "validate the payload" change cannot drop them.
test('§7.1/§7.3 stepskills carries three-part MCP labels and the overflow sentinel verbatim', () => {
  const entry = makeEntry({ id: 'uuid-SK2' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    const skills = ['skill:graphify', 'mcp:playwright:browser_navigate', 'overflow:6'];
    entry.orch.emit('stepskills', { nodeId: 'n1', cycle: 1, skills });
    assert.deepEqual(entry.events.filter((e) => e.type === 'stepskills')[0].skills, skills);
  } finally {
    runs.delete(entry.id);
  }
});

// wireRun's status arm is SHARED, not v1: P8 rewrote `name === 'phase' || name
// === 'exec'` down to `name === 'exec'`, and DELETING it instead would leave
// every run stuck at the status it was created with until the first `state`
// frame. Nothing pinned it before, so a mutation that removed it stayed green.
test("wireRun: an 'exec' event flips a queued run to running", () => {
  const entry = makeEntry({ id: 'uuid-EX1', status: 'queued' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('exec', { nodeId: 'n_plan', executionId: 'x:n_plan:1', status: 'start' });
    assert.equal(entry.status, 'running', 'the exec arm is what marks the run live');
    const buffered = entry.events.filter((e) => e.type === 'exec');
    assert.equal(buffered.length, 1, 'and the event itself is forwarded');
    assert.equal(buffered[0].runId, 'uuid-EX1');
  } finally {
    runs.delete(entry.id);
  }
});

test("wireRun: a 'phase' event is NOT forwarded — the v1 event vocabulary is gone", () => {
  const entry = makeEntry({ id: 'uuid-PH1', status: 'queued' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('phase', { phase: 'plan', cycle: 1, status: 'start' });
    assert.equal(entry.events.filter((e) => e.type === 'phase').length, 0, 'phase left EVENT_NAMES');
    assert.equal(entry.status, 'queued', 'and it moves nothing');
  } finally {
    runs.delete(entry.id);
  }
});
