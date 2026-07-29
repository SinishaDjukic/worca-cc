import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app, runs, _testing } from '../ui/server.mjs';

let srv, base;
const tmpDirs = [];

before(async () => {
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeProjectDir() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-runs-id-'));
  tmpDirs.push(d);
  return d;
}

function makeEntry(overrides = {}) {
  return {
    id: 'uuid-AAAA',
    orch: new EventEmitter(),
    projectDir: '/tmp/x',
    title: 't',
    status: 'starting',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    ...overrides,
  };
}

// ── unit: wireRun captures the short id from the orchestrator's state event ──
test('wireRun: state.id is captured onto entry.pipelineId; null does not clobber', () => {
  const entry = makeEntry({ id: 'uuid-AAAA' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);

    // Pre-createPipeline snapshots in the orchestrator have id=null. Must NOT
    // clobber a missing pipelineId with null/undefined.
    entry.orch.emit('state', { id: null, status: 'running', phase: 'preflight' });
    assert.equal(entry.pipelineId, undefined, 'null id is ignored');
    assert.equal(entry.status, 'running', 'status still mirrored');

    // Post-createPipeline snapshot carries the short id.
    entry.orch.emit('state', { id: 'ab12cd34', status: 'running', phase: 'preflight' });
    assert.equal(entry.pipelineId, 'ab12cd34', 'short id captured');

    // A later snapshot without an id must not erase the captured value.
    entry.orch.emit('state', { status: 'done' });
    assert.equal(entry.pipelineId, 'ab12cd34', 'missing id leaves capture intact');
    assert.equal(entry.status, 'done');
  } finally {
    runs.delete(entry.id);
  }
});

// ── unit: 'subagent' is a wired event — buffered + tagged, no status side-effect ──
test("wireRun: 'subagent' events are buffered/tagged and do NOT mutate status", () => {
  const entry = makeEntry({ id: 'uuid-SUB1', status: 'running' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('subagent', {
      transition: 'spawn', id: 'tool_1', label: 'research auth',
      nodeId: 's0_0', stepKey: '0:s0_0', stepIndex: 0, cycle: 0,
      status: 'running', ts: 123,
    });
    const buffered = entry.events.filter((e) => e.type === 'subagent');
    assert.equal(buffered.length, 1, "subagent event is buffered for replay");
    assert.equal(buffered[0].runId, 'uuid-SUB1', 'tagged with runId for client routing');
    assert.equal(buffered[0].transition, 'spawn');
    assert.equal(buffered[0].id, 'tool_1');
    assert.equal(entry.status, 'running', "a 'subagent' event must not change run status");

    entry.orch.emit('subagent', { transition: 'finish', id: 'tool_1', status: 'finished', ts: 456 });
    assert.equal(entry.events.filter((e) => e.type === 'subagent').length, 2, 'finish also buffered');
    assert.equal(entry.status, 'running', 'finish still does not change run status');
  } finally {
    runs.delete(entry.id);
  }
});

// ── regression: a payload carrying its OWN runId must NOT override the run UUID ──
// orchestrator._subAgentTransition USED TO emit { runId: state.id, … } where state.id
// is the pipeline SHORT id (e.g. 'ab12cd34'), not the run UUID. Before this fix the
// server's `{ runId: id, ...event }` let the payload runId win, so the broadcast was
// re-tagged with the short id and the client spawned a phantom "(untitled)" run keyed
// by it. The server runId (the runs-Map key) must always win — matching wireScan. We
// hand-build the payload (not via the orchestrator) so this guard survives Task 1.
test("wireRun: a payload's own runId never overrides the authoritative run UUID", () => {
  const entry = makeEntry({ id: 'uuid-REAL', status: 'running' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('subagent', {
      runId: 'ab12cd34',          // pipeline short id (state.id) — the old bug source
      transition: 'spawn', id: 'tool_1', label: 'research auth',
      nodeId: 's0_0', status: 'running', ts: 123,
    });
    const buffered = entry.events.filter((e) => e.type === 'subagent');
    assert.equal(buffered.length, 1, 'subagent event buffered');
    assert.equal(buffered[0].runId, 'uuid-REAL',
      'server runId (Map key) wins over the payload runId — no phantom run');
  } finally {
    runs.delete(entry.id);
  }
});

// ── integration: /api/runs exposes id=pipelineId, runId=uuid so dedup works ──
test('/api/runs: live entries expose the pipeline short id when known', async () => {
  const projectDir = await makeProjectDir();
  const entry = makeEntry({
    id: 'uuid-BBBB',
    projectDir,
    pipelineId: 'ab12cd34',
    title: 'My run',
    status: 'done',
  });
  runs.set(entry.id, entry);
  try {
    const res = await fetch(
      `${base}/api/runs?projectDir=${encodeURIComponent(projectDir)}`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.live.length, 1, 'one live entry for this projectDir');
    assert.equal(body.live[0].id, 'ab12cd34', 'id is the short pipeline id');
    assert.equal(body.live[0].runId, 'uuid-BBBB', 'runId remains the UUID for WS routing');
    assert.equal(body.live[0].live, true);
  } finally {
    runs.delete(entry.id);
  }
});

// ── integration: before createPipeline fires a state-with-id, id falls back to UUID ──
test('/api/runs: live entries fall back to UUID before any state event with an id', async () => {
  const projectDir = await makeProjectDir();
  const entry = makeEntry({
    id: 'uuid-CCCC',
    projectDir,
    title: 'preflight',
    status: 'starting',
  });
  runs.set(entry.id, entry);
  try {
    const res = await fetch(
      `${base}/api/runs?projectDir=${encodeURIComponent(projectDir)}`,
    );
    const body = await res.json();
    assert.equal(body.live.length, 1);
    assert.equal(body.live[0].id, 'uuid-CCCC', 'no pipelineId yet → id is the UUID');
    assert.equal(body.live[0].runId, 'uuid-CCCC');
  } finally {
    runs.delete(entry.id);
  }
});
