// test/api-run-memory-scope.test.mjs — POST /api/run's memoryScope gate (agent-memory-design.md §7.3): 400s, the 409, a mock start.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);   // outer isolation: /api/run finishes ASYNC in-process (api-sources pattern)

let homeDir, prevHome, srv, base, runs, _testing;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
async function rmWithRetry(dir, { attempts = 12, stepMs = 25 } = {}) {
  for (let i = 0; ; i++) {
    try { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); return; }
    catch (err) {
      const code = err?.code || '';
      if ((code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'ENOENT') && i < attempts) { await new Promise((r) => setTimeout(r, stepMs)); continue; }
      throw err;
    }
  }
}
const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
async function untilSettled(runId, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && settled.has(String(e.status || ''))) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-memscope-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind
  ({ runs, _testing } = mod);
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rmWithRetry(homeDir);
});

test('POST /api/run: the memoryScope matrix answers 400 before any target lookup', async () => {
  // The workspace case goes FIRST: it creates nothing at all. The projectDir cases name a dir
  // that must never exist — without the gate the route would reach the target checks and
  // (for a legal-looking body) `mkdir` it, so their order in this test is load-bearing.
  let r = await post('/api/run', { workspaceId: 'wks-ghost-0000abcd', prompt: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'global' });
  assert.equal(r.status, 400, 'a workspace target is refused BEFORE the workspace lookup (never a 404)');
  assert.match((await r.json()).error, /targets one project, not a workspace/);
  const projectDir = join(tmpdir(), `worca-cc-never-created-${process.pid}-${Date.now()}`);   // unique: a leftover from an earlier run must not mask the assertion below
  r = await post('/api/run', { projectDir, prompt: 'x', workflowId: 'wf_memory_defrag' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /needs memoryScope/);
  r = await post('/api/run', { projectDir, prompt: 'x', workflowId: 'wf_default', memoryScope: 'global' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /only valid with the Memory defragment workflow/);
  r = await post('/api/run', { projectDir, prompt: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'both' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /must be "global" or "project"/);
  r = await post('/api/run', { projectDir, prompt: 'x', workflowId: 'wf_memory_defrag', memoryScope: 7 });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /must be "global" or "project"/);
  assert.equal(existsSync(projectDir), false, 'no refusal ever created the target dir');
});

test('POST /api/run: 409 while a defragment run on the same scope is live; a different scope is fine', async () => {
  const dir = gitDir('memscope');
  const fake = (id, memoryScope, status = 'running') => runs.set(id, { id, orch: { memoryScope, pause: () => ({}) }, projectDir: dir, kind: 'run', status, events: [], pendingQuestion: null });
  fake('fake-global', 'global');
  const r = await post('/api/run', { projectDir: dir, prompt: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'global' });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.error, 'a defragment run for this memory scope is already live');
  assert.equal(j.runId, 'fake-global');
  assert.equal(_testing.liveDefragRun('global')?.id, 'fake-global');
  assert.equal(_testing.liveDefragRun(_testing.memoryScopeKey('project', dir)), null);
  fake('fake-global', 'global', 'done');
  assert.equal(_testing.liveDefragRun('global'), null, 'a settled entry is not live');
  runs.delete('fake-global');
});

test('POST /api/run: a legal defragment request starts a mock pipeline that finishes done and carries the option', async () => {
  const dir = gitDir('memscope');
  const r = await post('/api/run', { projectDir: dir, prompt: 'Defragment global memory.', workflowId: 'wf_memory_defrag', memoryScope: 'global', mock: true });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  assert.match(runId, /^[0-9a-f-]{36}$/, 'the runs-Map UUID, not the 8-hex pipeline id');
  const entry = runs.get(runId);
  assert.equal(entry.orch.memoryScope, 'global');
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
  assert.equal(typeof _testing.startRunHandler, 'function', 'the defragment wrappers delegate to it');
});

// DA-F7: a data-loss guard with zero coverage is a guard that will be deleted by the next
// refactor. Resuming a stale paused defrag would sync its old mount over a live one's work.
test('resumeRun: a paused defragment run refuses to resume while another one on its scope is live', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { graphResumePoint } = await import('./helpers/graph-templates.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = gitDir('memresume');
  await addProject({ name: 'memresume', path: dir });
  const { id } = await seedPipeline(dir, {
    title: 'paused defragment', status: 'paused',
    resumePoint: graphResumePoint({ workflowId: 'wf_memory_defrag', memoryScope: 'global' }),
  });
  runs.set('live-g', { id: 'live-g', orch: { memoryScope: 'global' }, projectDir: dir, kind: 'run', status: 'running', events: [], pendingQuestion: null });
  try {
    await assert.rejects(() => _testing.resumeRun(id, { mock: true }),
      (e) => e.status === 409 && e.body?.runId === 'live-g' && /already live/.test(e.body?.error || ''));
  } finally { runs.delete('live-g'); }
  assert.equal(projectKey(dir).length > 0, true);
  // With nothing live on the scope the same resume passes the guard and starts.
  const out = await _testing.resumeRun(id, { mock: true });
  assert.equal(out.ok, true);
  await untilSettled(out.runId);
});
