// test/ui-server-stepper-seed.test.mjs — hello summary carries stepper; a
// (re)connect with ?runId replays a current state snapshot carrying stepper.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STEPPER = { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] }], feedbacks: [] };

let srv, wsBase, runs, _testing, prevHome, homeDir;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-stepper-seed-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs; _testing = mod._testing; srv = mod.server;
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
function fakeRunEntry(id) {
  const orch = new EventEmitter();
  orch.state = { id, stepper: STEPPER, subAgents: [], status: 'running', steps: [] };
  orch.getState = () => JSON.parse(JSON.stringify(orch.state));
  return { id, runId: id, kind: 'run', orch, projectDir: '/tmp/x', title: 't', status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
}

test('summarizeRuns includes the run stepper', () => {
  const entry = fakeRunEntry('p_sum');
  runs.set(entry.id, entry);
  const sum = _testing.summarizeRuns().find((r) => r.runId === 'p_sum');
  assert.ok(sum, 'run summarized');
  assert.deepEqual(sum.stepper, STEPPER, 'hello run-summary carries stepper');
  runs.delete('p_sum');
});

test('connecting with ?runId replays a current state snapshot carrying stepper', async () => {
  const entry = fakeRunEntry('p_ws');
  runs.set(entry.id, entry);
  const ws = new WebSocket(`${wsBase}?runId=p_ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await waitFor(() => msgs.some((m) => m.type === 'state' && m.runId === 'p_ws' && m.stepper));
  const snap = msgs.find((m) => m.type === 'state' && m.runId === 'p_ws');
  assert.deepEqual(snap.stepper, STEPPER, 'snapshot carries the real stepper');
  ws.close();
  runs.delete('p_ws');
});
