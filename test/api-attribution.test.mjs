// test/api-attribution.test.mjs — who started this (src/core/identity.mjs) through the real
// server: /api/whoami, startedBy recorded on a mock run and persisted, an HTTP body cannot
// claim someone else, and the PR body names the person (git/gh faked, no network).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, runs, gitInfo, readPipeline;
const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
async function untilSettled(runId, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && settled.has(String(e.status || ''))) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  const e = runs.get(runId);
  throw new Error(`run ${runId} never settled: status=${e?.status} phase=${e?.orch?.state?.phase} question=${!!e?.pendingQuestion} last=${JSON.stringify((e?.events || []).slice(-2)).slice(0, 400)}`);
}
/** Until the run has its pipeline row and branch (the default workflow then waits at Clarify). */
async function untilRecorded(runId, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = runs.get(runId)?.orch?.state;
    if (st?.id && st?.branch?.feature) return runs.get(runId);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never got a pipeline row`);
}
const stopRun = async (entry) => { try { entry.orch.stop(); } catch { /* already over */ } await untilSettled(entry.id).catch(() => {}); };
const post = (p, b, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(b) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-attrib-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = 'X-Forwarded-Email';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  ({ readPipeline } = await import('../src/core/artifacts.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  gitInfo?.reset();
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_IDENTITY_HEADER;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('/api/whoami: nobody locally; the named header when a proxy sets it', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/whoami`)).json(), { name: null, source: 'local' });
  const j = await (await fetch(`${base}/api/whoami`, { headers: { 'X-Forwarded-Email': 'ada@example.com' } })).json();
  assert.deepEqual(j, { name: 'ada@example.com', source: 'header' });
});

test('a run records who started it, persisted on the pipeline row; the HTTP body cannot claim anyone', async () => {
  const dir = gitDir('attrib');
  let r = await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, humanInLoop: false }, { 'X-Forwarded-Email': 'ada@example.com' });
  assert.equal(r.status, 200, await r.clone().text());
  const { runId } = await r.json();
  assert.equal(runs.get(runId).startedBy, 'ada@example.com', 'live entry');
  const live = await untilRecorded(runId);
  assert.equal((await readPipeline(dir, live.orch.state.id)).state.startedBy, 'ada@example.com', 'persisted (rowToState)');
  await stopRun(live);

  r = await post('/api/run', { projectDir: dir, prompt: 'y', mock: true, humanInLoop: false, startedBy: 'mallory@example.com', internal: { startedBy: 'mallory@example.com' } });
  const second = (await r.json()).runId;
  assert.equal(runs.get(second).startedBy, 'local', 'only the request identity counts');
  await stopRun(await untilRecorded(second));
});

test('the PR body ends with who started the run', async () => {
  const dir = gitDir('attrib-pr');
  const r = await post('/api/run', { projectDir: dir, prompt: 'z', mock: true, humanInLoop: false }, { 'X-Forwarded-Email': 'grace@example.com' });
  const { runId } = await r.json();
  const done = await untilRecorded(runId);
  await stopRun(done);
  const seen = [];
  gitInfo.setRunner(async (cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return { ok: true, stdout: 'https://github.com/acme/api/pull/9\n', stderr: '', code: 0 };
    if (cmd === 'git' && args[0] === 'remote' && args[1] === '-v') return { ok: true, stdout: 'origin\thttps://github.com/acme/api.git (fetch)\norigin\thttps://github.com/acme/api.git (push)\n', stderr: '', code: 0 };
    return { ok: true, stdout: '', stderr: '', code: 0 };
  });
  try {
    const pr = await post('/api/pr', { id: done.orch.state.id, projectDir: dir });
    assert.equal(pr.status, 200, await pr.clone().text());
  } finally { gitInfo.reset(); }
  const create = seen.find((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create');
  assert.ok(create, JSON.stringify(seen));
  const body = create[create.indexOf('--body') + 1];
  assert.match(body, /\n\n---\nStarted by grace@example\.com via worca$/);
});
