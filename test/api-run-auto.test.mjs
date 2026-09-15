// Boot preamble = test/run-workflow-gate.test.mjs (WORCA_MOCK=1 keeps /api/run offline;
// the mock classifier answers from recipes.mjs). Every test uses a FRESH project dir and
// awaits its run's terminal state before the next POST, so "the newest pipelines row"
// is always this test's run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { setHumanInLoop } from '../src/core/config.mjs';

useTempHome(after);
let homeDir, srv, base, prevHome;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-runauto-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});
const projects = [];
const runDir = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-runauto-proj-')); projects.push(d); return d; };
after(() => Promise.all(projects.map((d) => rm(d, { recursive: true, force: true }))));
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const newestRow = () => getDb().prepare('SELECT id, status, stepper FROM pipelines ORDER BY started_at DESC, rowid DESC LIMIT 1').get();
/**
 * The newest pipelines row once `pred` holds, polling ≤ 60 s. `notId` is the row
 * that was newest BEFORE this test's POST: /api/run answers 200 before the new
 * row is inserted, so without it a `status === 'done'` wait could return the
 * previous test's already-settled row, leave THIS test's run alive, and let the
 * next test (or the after-hook's rm of the home) trip over it.
 */
async function waitForRow(pred, notId = null) {
  for (let i = 0; i < 600; i += 1) {
    const row = newestRow();
    if (row && row.id !== notId && pred(row)) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for the pipelines row');
}
/** The id of the newest row right now (null on an empty table), for waitForRow's `notId`. */
const newestId = () => newestRow()?.id ?? null;

test('wf_auto with humanInLoop:false decides and runs to done; the manifest records the decision', async () => {
  const prev = newestId();
  const r = await api('POST', '/api/run', { projectDir: await runDir(), prompt: 'demo task', workflowId: 'wf_auto', humanInLoop: false, mock: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await waitForRow((x) => x.status === 'done', prev);
  const stepper = JSON.parse(row.stepper);
  assert.equal(stepper.auto.status, 'decided');
  assert.equal(stepper.auto.humanInLoop, false);
  assert.ok(stepper.graph.nodes.some((n) => n.kind === 'agent'));
});

test('humanInLoop falls back to the project switch, and a question can be answered through /api/answer', async () => {
  const off = await runDir();
  await setHumanInLoop(off, false);
  const prevOff = newestId();
  const r1 = await api('POST', '/api/run', { projectDir: off, prompt: 'demo task', workflowId: 'wf_auto', mock: true });
  assert.equal(r1.status, 200);
  await waitForRow((x) => x.status === 'done', prevOff);

  const on = await runDir();
  const prevOn = newestId();
  const r2 = await api('POST', '/api/run', { projectDir: on, prompt: 'demo task', workflowId: 'wf_auto', mock: true });
  assert.equal(r2.status, 200);
  // The proposal question parks the run and its id is deterministic (auto-1).
  // POST /api/answer answers 200 even before the question is open (orch.answer()
  // only logs a warning then — up to a few hundred "answer() ignored" lines land in
  // the run log while we poll; harmless), so keep cancelling until the row reads stopped.
  // 1800 iterations (~3 min), not 600: under the FULL suite this file competes with
  // ~14 sibling processes for git/worktree work, and a 60 s budget for the SECOND
  // pipeline of this test measured flaky (1 failure in 3 full-suite runs).
  let row = null;
  let seen = null;
  for (let i = 0; i < 1800 && !row; i += 1) {
    const a = await api('POST', '/api/answer', { runId: r2.body.runId, id: 'auto-1', payload: { decision: 'cancel' } });
    assert.equal(a.status, 200);
    const latest = newestRow();
    seen = latest;
    if (latest && latest.id !== prevOn && latest.status === 'stopped') row = latest; else await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(row, `the workflow question was answered with cancel and the run stopped (newest row: ${seen ? `${seen.id} ${seen.status}` : 'none'})`);
  assert.equal(JSON.parse(row.stepper).auto.status, 'deciding', 'cancelled before any graph was adopted');
});

test('wf_auto is refused for a workspace target; a saved workflow accepts and ignores humanInLoop', async () => {
  const ws = await api('POST', '/api/run', { workspaceId: 'wks-nope-00000000', prompt: 'x', workflowId: 'wf_auto', mock: true });
  assert.equal(ws.status, 400);
  assert.equal(ws.body.error, 'Auto workflow is not available for workspace targets yet');
  const prev = newestId();
  const r = await api('POST', '/api/run', { projectDir: await runDir(), prompt: 'demo task', workflowId: 'wf_default', humanInLoop: false, mock: true });
  assert.equal(r.status, 200, 'a saved workflow accepts the field and ignores it');
  // Wait for THIS run's row (not the previous test's), then for it to be running.
  const row = await waitForRow((x) => x.status === 'running', prev);
  assert.equal(JSON.parse(row.stepper).auto, undefined, 'a saved workflow carries no auto block');
  // HITL is ignored on a saved workflow, so this run parks on its clarify question:
  // stop it explicitly, so nothing is alive when the after-hooks reap the home.
  assert.equal((await api('POST', '/api/stop', { runId: r.body.runId })).status, 200);
  await waitForRow((x) => x.status === 'stopped', prev);
});
