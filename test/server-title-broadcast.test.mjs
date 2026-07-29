// test/server-title-broadcast.test.mjs — wireRun must forward the new 'title'
// event through the pass-through broadcast (tagged with the run UUID, carrying
// the payload's pipelineId) AND refresh entry.title so a late-joining client's
// hello/summarizeRuns reports the settled title. EVENT_NAMES is not exported, so
// assert BEHAVIORALLY via the buffered events on the run entry (mirrors
// test/server-event-names.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runs, _testing } from '../ui/server.mjs';

function makeEntry(overrides = {}) {
  return {
    id: 'uuid-T1',
    orch: new EventEmitter(),
    projectDir: '/tmp/x',
    title: 'Provisional title',
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    ...overrides,
  };
}

test("wireRun: 'title' events are forwarded with pipelineId and refresh entry.title", () => {
  const entry = makeEntry({ id: 'uuid-T1' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('title', { title: 'Concise LLM Title', provisional: false, pipelineId: 'p1' });
    const buffered = entry.events.filter((e) => e.type === 'title');
    assert.equal(buffered.length, 1, 'title event is buffered/forwarded');
    assert.equal(buffered[0].runId, 'uuid-T1', 'tagged with the run UUID');
    assert.equal(buffered[0].title, 'Concise LLM Title');
    assert.equal(buffered[0].pipelineId, 'p1', 'pipelineId rides through to the client');
    assert.equal(buffered[0].provisional, false);
    assert.equal(entry.title, 'Concise LLM Title', 'entry.title refreshed for late-join hello');
    assert.equal(entry.status, 'running', 'a title event must not change run status');
  } finally {
    runs.delete(entry.id);
  }
});

test("wireRun: a 'title' event with no title string does not clobber entry.title", () => {
  const entry = makeEntry({ id: 'uuid-T2', title: 'Keep me' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('title', { provisional: false, pipelineId: 'p2' });
    assert.equal(entry.title, 'Keep me', 'entry.title preserved when payload omits title');
  } finally {
    runs.delete(entry.id);
  }
});
