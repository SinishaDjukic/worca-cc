// test/stillhet-seed-gate.test.mjs — tools/stillhet-seed-gate.mjs leaves one mock run held at its review gate (`kind: 'gate'`)
// on a running mock server, for the gate walks O1 and O4, and the gate is answered through dev's own POST /api/answer. It
// needs the in-process server (temp HOME, WORCA_MOCK=1) and real mock runs, as test/stillhet-seed-tasks.test.mjs does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let srv, base, mod, seed, projectRoot;
const started = [];
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_MOCK: process.env.WORCA_MOCK, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };

before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-seed-gate-test-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  projectRoot = await mkdtemp(join(tmpdir(), 'worca-seed-gate-proj-'));
  seed = await import('../tools/stillhet-seed-gate.mjs');
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  for (const runId of started) await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) }).catch(() => {});
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settled(runId, ms = 60000) {
  const until = Date.now() + ms;
  for (;;) {
    const e = mod.runs.get(runId);
    if (e && ['done', 'stopped', 'error', 'interrupted'].includes(e.status)) return e;
    if (Date.now() > until) assert.fail(`run ${runId} never settled (status ${e?.status}, question ${e?.pendingQuestion?.kind})`);
    await sleep(100);
  }
}
async function seeded() {
  const out = await seed.seedGate({ base, target: 'gate', projectRoot });
  started.push(out.runId);
  return out;
}

test('PLAN-Gc O1 O4: the seeded run holds at its review gate (kind gate, gate-w9-1, issues listed) and stays waiting', { timeout: 120000 }, async () => {
  const { runId, projectDir, question } = await seeded();
  assert.equal(question.kind, 'gate');
  assert.equal(question.id, seed.SEEDED_GATE.gateId);
  assert.ok(Array.isArray(question.issues) && question.issues.length > 0, 'the open issues ride the question');
  assert.match(projectDir, /stillhet-scratch-gate/);
  await sleep(500);
  const again = await seed.waitForQuestion(base, runId, { kind: 'gate', timeoutMs: 2000 });
  assert.equal(again.id, question.id, 'still waiting on the same gate');
  assert.equal(mod.runs.get(runId).status, 'running');
  // the scratch project is registered once and reused by the next seed
  const projects = (await (await fetch(`${base}/api/projects`)).json()).projects.filter((p) => p.name === 'stillhet-scratch-gate');
  assert.equal(projects.length, 1);
});

test('PLAN-Gc O1: answering Run another cycle through POST /api/answer moves the run on to done', { timeout: 120000 }, async () => {
  const { runId, projectDir, question } = await seeded();
  assert.match(projectDir, /stillhet-scratch-gate/);
  assert.deepEqual(await seed.answerGate({ base, runId, id: question.id, decision: 'another' }), { ok: true });
  const e = await settled(runId);
  assert.equal(e.status, 'done');
  assert.equal((await fetch(`${base}/api/projects`).then((r) => r.json())).projects.filter((p) => p.name === 'stillhet-scratch-gate').length, 1);
});

test('PLAN-Gc O1: answering Accept as is through POST /api/answer moves the run on to done', { timeout: 120000 }, async () => {
  const { runId, question } = await seeded();
  assert.deepEqual(await seed.answerGate({ base, runId, id: question.id, decision: 'continue' }), { ok: true });
  assert.equal((await settled(runId)).status, 'done');
});

test('PLAN-Gc: the seed refuses port 4317 and a server with serverMock false, starting nothing', async () => {
  const calls = [];
  const stubFetch = async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url}`); return new Response('{}'); };
  class Hello {
    constructor() { setTimeout(() => this.onmsg?.({ data: JSON.stringify({ type: 'hello', serverMock: false, runs: [] }) }), 5); }
    addEventListener(t, fn) { if (t === 'message') this.onmsg = fn; }
    close() {}
  }
  await assert.rejects(seed.seedGate({ base: 'http://127.0.0.1:4317', fetch: stubFetch, WebSocketImpl: Hello }), (e) => e.code === 'owner-port');
  await assert.rejects(seed.seedGate({ base: 'http://10.0.0.5:4504', fetch: stubFetch, WebSocketImpl: Hello }), (e) => e.code === 'not-local');
  await assert.rejects(seed.seedGate({ base: 'http://127.0.0.1:4504', fetch: stubFetch, WebSocketImpl: Hello }), (e) => e.code === 'not-mock');
  assert.deepEqual(calls, [], 'no request reached the server');
  const errs = [];
  const orig = console.error;
  console.error = (l) => errs.push(String(l));
  try { assert.equal(await seed.main(['http://127.0.0.1:4317']), 2); } finally { console.error = orig; }
  assert.match(errs.join('\n'), /^owner-port: /);
});
