// test/ui-server-question-replay.test.mjs — a (re)connect must NOT replay a
// buffered `question` event once it has been answered. The ring buffer keeps the
// original question event forever; on refresh the server replays the whole buffer.
// If a resolved question is replayed, the client resurrects its clarify/gate card,
// which (a) shows a false "paused" state over an already-running pipeline and
// (b) makes any answer hit a no-longer-pending id ("answer() ignored"). The
// authoritative entry.pendingQuestion is the single source of truth: replay a
// `question` event ONLY while it is still the active pending question.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STEPPER = { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] }], feedbacks: [] };

let srv, wsBase, runs, prevHome, homeDir;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-qreplay-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs; srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

function waitFor(pred, timeoutMs = 4000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => { const v = pred(); if (v) return res(v); if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out')); setTimeout(tick, 15); };
    tick();
  });
}

// A run that asked clarify-1, then advanced. `pending` decides whether the
// question is still the active one (genuine reload mid-pause) or already
// answered (entry.pendingQuestion cleared, pipeline moved to plan).
function fakeRunWithBufferedQuestion(id, { pending }) {
  const orch = new EventEmitter();
  orch.state = { id, stepper: STEPPER, subAgents: [], status: 'running', steps: [] };
  orch.getState = () => JSON.parse(JSON.stringify(orch.state));
  const qEvent = {
    type: 'question', runId: id, id: 'clarify-1', kind: 'clarify',
    questions: [{ id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''] }],
  };
  return {
    id, runId: id, kind: 'run', orch, projectDir: '/tmp/x', title: 't',
    status: 'running', startedAt: new Date().toISOString(),
    events: [
      { type: 'phase', runId: id, phase: 'clarify', status: 'start' },
      qEvent,
      { type: 'phase', runId: id, phase: 'clarify', status: 'done' },
      { type: 'phase', runId: id, phase: 'plan', status: 'start' },
    ],
    pendingQuestion: pending ? qEvent : null,
  };
}

function connectAndCollect(id) {
  const ws = new WebSocket(`${wsBase}?runId=${id}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  return { ws, msgs };
}

test('reconnect does NOT replay a question that was already answered', async () => {
  const entry = fakeRunWithBufferedQuestion('p_answered', { pending: false });
  runs.set(entry.id, entry);
  const { ws, msgs } = connectAndCollect('p_answered');
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  // The state snapshot is sent AFTER the buffered-event replay, so its arrival
  // proves replay finished and nothing more is coming.
  await waitFor(() => msgs.some((m) => m.type === 'state' && m.runId === 'p_answered'));
  const questions = msgs.filter((m) => m.type === 'question');
  assert.equal(questions.length, 0, 'a resolved question must not be replayed on reconnect');
  ws.close();
  runs.delete('p_answered');
});

test('reconnect DOES replay a question that is still pending', async () => {
  const entry = fakeRunWithBufferedQuestion('p_pending', { pending: true });
  runs.set(entry.id, entry);
  const { ws, msgs } = connectAndCollect('p_pending');
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await waitFor(() => msgs.some((m) => m.type === 'state' && m.runId === 'p_pending'));
  const questions = msgs.filter((m) => m.type === 'question');
  assert.equal(questions.length, 1, 'a still-pending question is replayed so the card survives reload');
  assert.equal(questions[0].id, 'clarify-1');
  ws.close();
  runs.delete('p_pending');
});

// A run whose orchestrator can accept an answer. The orch.answer stub records
// the call (a real orchestrator would resolve the awaiting clarify/gate promise).
function fakeRunAnswerable(id) {
  const qEvent = {
    type: 'question', runId: id, id: 'clarify-1', kind: 'clarify',
    questions: [{ id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''] }],
  };
  const orch = new EventEmitter();
  orch.state = { id, stepper: STEPPER, subAgents: [], status: 'running', steps: [] };
  orch.getState = () => JSON.parse(JSON.stringify(orch.state));
  orch.answer = () => true;
  return {
    id, runId: id, kind: 'run', orch, projectDir: '/tmp/x', title: 't',
    status: 'running', startedAt: new Date().toISOString(), events: [qEvent], pendingQuestion: qEvent,
  };
}

const open = (ws) => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

test('POST /api/answer broadcasts question-resolved to EVERY connected client', async () => {
  const entry = fakeRunAnswerable('p_multi');
  runs.set(entry.id, entry);
  // Two tabs watching the same run; only one will POST the answer.
  const a = connectAndCollect('p_multi');
  const b = connectAndCollect('p_multi');
  await Promise.all([open(a.ws), open(b.ws)]);

  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: 'p_multi', id: 'clarify-1', payload: { answers: [{ id: 'q1', choice: 'Redis' }] } }),
  });
  assert.equal(res.status, 200, 'answer accepted');

  await waitFor(() =>
    a.msgs.some((m) => m.type === 'question-resolved' && m.id === 'clarify-1') &&
    b.msgs.some((m) => m.type === 'question-resolved' && m.id === 'clarify-1'));
  assert.equal(entry.pendingQuestion, null, 'server cleared the pending question');

  a.ws.close(); b.ws.close();
  runs.delete('p_multi');
});

test('answering twice is idempotent: the second answer broadcasts no second resolution', async () => {
  const entry = fakeRunAnswerable('p_twice');
  runs.set(entry.id, entry);
  const a = connectAndCollect('p_twice');
  await open(a.ws);
  const url = `http://127.0.0.1:${srv.address().port}/api/answer`;
  const body = { runId: 'p_twice', id: 'clarify-1', payload: { answers: [] } };
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await waitFor(() => a.msgs.some((m) => m.type === 'question-resolved'));
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Give any erroneous second broadcast a chance to arrive.
  await new Promise((r) => setTimeout(r, 60));
  const resolutions = a.msgs.filter((m) => m.type === 'question-resolved');
  assert.equal(resolutions.length, 1, 'exactly one resolution for one pending question');
  a.ws.close();
  runs.delete('p_twice');
});
