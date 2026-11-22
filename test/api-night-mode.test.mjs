// test/api-night-mode.test.mjs
// Night mode over HTTP: the per-run opt-in on POST /api/run, the run-view switch
// POST /api/run/night, the night-decision → question-resolved mapping, the decisions
// read route, and the settings / project config round trips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, userHome, srv, base, mod;
const prev = {};
const projects = [];
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-nightapi-'));
  userHome = await mkdtemp(join(tmpdir(), 'worca-cc-nightapi-home-'));
  prev.WORCA_HOME = process.env.WORCA_HOME;
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = userHome; }
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = appServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  delete process.env.WORCA_MOCK;
  await Promise.all([homeDir, userHome, ...projects].map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));
});
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const projectDir = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-nightapi-proj-')); projects.push(d); return d; };
async function until(pred, what) {
  for (let i = 0; i < 600; i += 1) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timed out waiting for ${what}`);
}

test('POST /api/run passes the nightMode opt-in; POST /api/run/night decides; the card is resolved by night-mode', async () => {
  const r = await api('POST', '/api/run', { projectDir: await projectDir(), prompt: 'demo task', workflowId: 'wf_default', mock: true, nightMode: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const entry = mod.runs.get(r.body.runId);
  assert.equal(entry.orch._night.optIn, true);
  const pq = await until(() => entry.pendingQuestion, 'the clarify question');
  assert.equal(pq.kind, 'clarify');
  const on = await api('POST', '/api/run/night', { runId: r.body.runId, mode: 'on' });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  await until(() => entry.events.some((e) => e.type === 'question-resolved' && e.id === pq.id && e.reason === 'night-mode'), 'question-resolved');
  const nd = await api('GET', `/api/night-decisions?runId=${r.body.runId}`);
  assert.equal(nd.status, 200);
  assert.ok(nd.body.decisions.some((d) => d.questionId === pq.id && d.kind === 'clarify'));
  await until(() => ['done', 'error', 'stopped', 'paused'].includes(entry.status), 'the run to settle');
  assert.equal(mod._testing.summarizeRuns().find((x) => x.runId === r.body.runId)?.night?.override, 'on');
});

test('POST /api/run validates nightMode; POST /api/run/night validates the mode', async () => {
  const bad = await api('POST', '/api/run', { projectDir: await projectDir(), prompt: 'x', mock: true, nightMode: 'yes' });
  assert.equal(bad.status, 400);
  const orch = new EventEmitter();
  orch.setNightOverride = (mode) => { if (!['auto', 'on', 'off'].includes(mode)) throw Object.assign(new Error('mode must be auto | on | off'), { code: 'BAD_NIGHT_MODE' }); };
  mod.runs.set('night-fake', { id: 'night-fake', kind: 'run', orch, events: [], status: 'running' });
  try {
    assert.equal((await api('POST', '/api/run/night', { runId: 'night-fake', mode: 'maybe' })).status, 400);
    assert.equal((await api('POST', '/api/run/night', { runId: 'nope', mode: 'on' })).status, 400);
  } finally { mod.runs.delete('night-fake'); }
});

test('a guardrail night-decision keeps the card; a decided one resolves it', async () => {
  const orch = new EventEmitter();
  orch.state = { steps: [], subAgents: [] };
  const entry = { id: 'night-wire', kind: 'run', orch, events: [], status: 'running', pendingQuestion: null };
  mod.runs.set('night-wire', entry);
  try {
    mod._testing.wireRun(entry);
    orch.emit('question', { id: 'q1', kind: 'clarify' });
    orch.emit('night-decision', { id: 'q1', kind: 'clarify', record: { choice: null, guardrail: 'maxDecisions', flagged: true } });
    assert.equal(entry.pendingQuestion?.id, 'q1', 'a guardrail row answered nothing');
    orch.emit('night-decision', { id: 'q1', kind: 'clarify', record: { choice: 'x', flagged: false } });
    assert.equal(entry.pendingQuestion, null);
    assert.equal(entry.nightDecisions.length, 2);
    assert.ok(entry.events.some((e) => e.type === 'night-decision'), 'the frame is recorded for live clients');
  } finally { mod.runs.delete('night-wire'); }
});

test('settings: GET/POST nightMode + nightModeToggle', async () => {
  const g = await api('GET', '/api/settings');
  assert.deepEqual(g.body.nightMode, {});
  assert.equal(g.body.nightModeToggle, 'auto');
  assert.equal(g.body.nightModeEffective.strategy, 'mixed');
  const p = await api('POST', '/api/settings', { nightMode: { enabled: true, window: '22:00-07:00' }, nightModeToggle: 'on' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.nightMode, { enabled: true, window: '22:00-07:00' });
  assert.equal(p.body.nightModeToggle, 'on');
  assert.equal((await api('POST', '/api/settings', { nightMode: { strategy: 'dice' } })).status, 400);
  assert.equal((await api('POST', '/api/settings', { nightModeToggle: 'maybe' })).status, 400);
  const u = await api('POST', '/api/settings', { nightMode: { __unset: ['window'] }, nightModeToggle: 'auto' });
  assert.deepEqual(u.body.nightMode, { enabled: true });
  assert.deepEqual((await api('POST', '/api/settings', { nightMode: null })).body.nightMode, {});
});

test('PATCH /api/config nightMode patch; GET /api/config returns nightMode {project, config, sources} beside config', async () => {
  const dir = await projectDir();
  const p = await api('PATCH', '/api/config', { projectDir: dir, nightMode: { strategy: 'weights' } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.nightMode.project, { strategy: 'weights' });
  const g = await api('GET', `/api/config?projectDir=${encodeURIComponent(dir)}`);
  assert.equal(g.body.nightMode.config.strategy, 'weights');
  assert.equal(g.body.nightMode.sources.strategy, 'project');
  assert.equal('nightMode' in g.body.config, false, 'the config shape clients store is unchanged');
  assert.equal((await api('PATCH', '/api/config', { projectDir: dir, nightMode: { spendCapUsd: 5 } })).status, 400);
  const reset = await api('PATCH', '/api/config', { projectDir: dir, nightMode: null });
  assert.equal(reset.body.nightMode.project, null);
});
