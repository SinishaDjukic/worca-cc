// test/api-memory.test.mjs — the /api/memory/* surface (agent-memory-design.md §11), the
// defragment wrappers (§7.3) and the `memory-changed` frame (B29), asserted over the REAL
// WS-capable server (boot idiom: test/ask-api-worktrees.test.mjs:30-35 + openWs/waitFor).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import {
  memoryRoot, GLOBAL_SCOPE, projectScope, scopeDir, readMemory, readScopeState, writeMemory,
  listSnapshots, MEMORY_NAME_HELP,
} from '../src/core/memory-store.mjs';

useTempHome(after);   // outer isolation: the mock runs below finish ASYNC in-process

let homeDir, prevHome, srv, base, wsBase, runs, _testing, project;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b) });
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });
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
/** The runs-Map status mirrors the orchestrator's `state` frame, which fires in run()'s done arm
 *  BEFORE _buildResults()/_stampDefrag(). Poll the scope's own .state for the stamp instead —
 *  otherwise the assertions race the run (and this file's `after` hook restores WORCA_HOME under
 *  the still-running stamp, which writes into the OUTER home). */
async function untilStamped(scope, pipelineId, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const st = await readScopeState(memoryRoot(), scope);
    if (st.lastDefragRunId === pipelineId) return st;
    if (Date.now() - t0 > ms) throw new Error(`scope never stamped by ${pipelineId}: ${JSON.stringify(st)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 20000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
/** Every `memory-changed` frame for one scope key, in arrival order. */
const memFrames = (msgs, scope) => msgs.filter((m) => m.type === 'memory-changed' && m.scope === scope);

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apimem-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  srv = mod.server;                                   // the WS-capable server: the frames are asserted for real
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  const { addProject } = await import('../src/core/projects.mjs');
  const dir = gitDir('apimem');
  // addProject returns the whole project ARRAY — pick the row.
  project = (await addProject({ name: 'apimem', path: dir })).find((p) => p.name === 'apimem');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  delete process.env.WORCA_MOCK;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rmWithRetry(homeDir);
});

test('GET /api/memory/global on a fresh store: empty list, fresh health, no live defrag', async () => {
  const r = await get('/api/memory/global');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual({ scope: j.scope, project: j.project, files: j.files, defragRunId: j.defragRunId }, { scope: 'global', project: null, files: [], defragRunId: null });
  assert.equal(j.health.level, 'fresh');
  assert.deepEqual(j.state, { writesSinceDefrag: 0, lastWriteAt: null, lastDefragAt: null, lastDefragRunId: null });
});

test('PUT / GET / DELETE a global file: repaired frontmatter, user source, one memory-changed frame per write, then gone', async () => {
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    let r = await put('/api/memory/global/files/testing', { text: 'How the suite runs.\nnpm ci first.\n' });
    assert.equal(r.status, 200);
    const created = await r.json();
    assert.equal(created.ok, true); assert.equal(created.name, 'testing'); assert.equal(created.created, true);
    assert.ok(Number.isInteger(created.bytes) && created.bytes > 0);
    await waitFor(() => memFrames(msgs, 'global').length === 1);
    assert.deepEqual(memFrames(msgs, 'global')[0], { type: 'memory-changed', scope: 'global' }, 'no threadId, no seq (B5)');
    r = await get('/api/memory/global/files/testing');
    assert.equal(r.status, 200);
    const f = await r.json();
    assert.equal(f.name, 'testing');
    assert.equal(f.meta.source, 'user');
    assert.equal(f.meta.description, 'How the suite runs.');
    assert.ok(f.text.startsWith('---\nname: testing\n'));
    assert.equal(f.body, 'How the suite runs.\nnpm ci first.\n');
    assert.equal(memFrames(msgs, 'global').length, 1, 'a READ never broadcasts');
    r = await put('/api/memory/global/files/testing', { text: '---\nname: testing\ndescription: Tests\n---\nChanged.\n' });
    assert.equal((await r.json()).created, false);
    r = await get('/api/memory/global');
    const list = (await r.json()).files;
    assert.deepEqual(list.map((e) => [e.name, e.description, e.source, e.hasFrontmatter]), [['testing', 'Tests', 'user', true]]);
    r = await del('/api/memory/global/files/testing');
    assert.deepEqual(await r.json(), { ok: true });
    await waitFor(() => memFrames(msgs, 'global').length === 3);   // PUT, PUT, DELETE
    assert.equal((await get('/api/memory/global/files/testing')).status, 404);
    assert.equal((await del('/api/memory/global/files/testing')).status, 404);
    await new Promise((r2) => setTimeout(r2, 60));
    assert.equal(memFrames(msgs, 'global').length, 3, 'a 404 DELETE never broadcasts');
  } finally { ws.close(); }
});

test('write refusals map to statuses: bad name 400 (the shared help string), missing text 400, case twin 409, over the hard cap 413 — and a refused name never creates the scope dir', async () => {
  const bad = await put('/api/memory/global/files/bad%20name', { text: 'x' });
  assert.equal(bad.status, 400);
  // The ROUTE refuses before any fs call, with the string the editor shows (memory-view.mjs
  // exports the same MEMORY_NAME_HELP); the store's own ENAME message reads "invalid name …".
  assert.equal((await bad.json()).error, `invalid memory name — ${MEMORY_NAME_HELP}`);
  assert.equal((await put('/api/memory/global/files/nul', { text: 'x' })).status, 400);
  assert.equal((await put('/api/memory/global/files/ok', {})).status, 400);
  assert.equal((await put('/api/memory/global/files/ok', { text: 42 })).status, 400);
  assert.equal((await put('/api/memory/global/files/Twin', { text: 'A\n' })).status, 200);
  const twin = await put('/api/memory/global/files/twin', { text: 'B\n' });
  assert.equal(twin.status, 409);
  assert.match((await twin.json()).error, /differ only by case/);
  const huge = await put('/api/memory/global/files/huge', { text: 'x'.repeat(40000) });
  assert.equal(huge.status, 413);
  assert.match((await huge.json()).error, /over the 32768-byte cap/);
  const badRead = await get('/api/memory/global/files/nul');
  assert.equal(badRead.status, 400, 'names are validated on reads too');
  assert.equal((await badRead.json()).error, `invalid memory name — ${MEMORY_NAME_HELP}`);
  const badDel = await del('/api/memory/global/files/bad%20name');
  assert.equal(badDel.status, 400);
  assert.equal((await badDel.json()).error, `invalid memory name — ${MEMORY_NAME_HELP}`);
  // SX-F19: the store mkdirs the scope dir before its cap checks, so pre-fs validation is what
  // keeps a refused write from leaving an empty projects/<key>/ behind on an untouched scope.
  const fresh = scopeDir(memoryRoot(), projectScope(project.key));
  assert.equal(existsSync(fresh), false, 'the project scope is still untouched');
  assert.equal((await put(`/api/memory/projects/${project.key}/files/.hidden`, { text: 'x' })).status, 400);
  assert.equal(existsSync(fresh), false, 'a refused name never reached the filesystem');
});

test('history: every write snapshots; restore replaces the scope and broadcasts; bad ids 400/404', async () => {
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    await put('/api/memory/global/files/h', { text: 'v1\n' });
    await put('/api/memory/global/files/h', { text: 'v2\n' });
    const r = await get('/api/memory/global/history');
    const { snapshots } = await r.json();
    assert.ok(snapshots.length >= 1, JSON.stringify(snapshots));
    for (const s of snapshots) assert.deepEqual(Object.keys(s).sort(), ['files', 'id'], 'the snapshot dir stays server-side');
    const withH = snapshots.filter((s) => s.files.includes('h.md')).at(-1);
    assert.ok(withH, 'the snapshot taken before v2 holds v1');
    assert.deepEqual(await (await post(`/api/memory/global/history/${withH.id}/restore`)).json(), { ok: true });
    assert.equal((await (await get('/api/memory/global/files/h')).json()).body, 'v1\n');
    await waitFor(() => memFrames(msgs, 'global').length === 3);   // PUT, PUT, restore
    assert.equal((await post('/api/memory/global/history/20990101-000000-user/restore')).status, 404);
    assert.equal((await post('/api/memory/global/history/..%2Fx/restore')).status, 400);
    await new Promise((r2) => setTimeout(r2, 60));
    assert.equal(memFrames(msgs, 'global').length, 3, 'a refused restore never broadcasts');
  } finally { ws.close(); }
});

test('the projects family: unknown or malformed keys are 404; a registered project reads and writes under its own scope', async () => {
  assert.equal((await get('/api/memory/projects/nope-00000009')).status, 404);
  assert.equal((await get('/api/memory/projects/Bad_Key')).status, 404, 'uppercase + underscore is not a registry key shape');
  assert.equal((await get('/api/memory/projects/nope')).status, 404, 'no 8-hex suffix');
  assert.equal((await put('/api/memory/projects/Nope/files/x', { text: 'x' })).status, 404);
  // I2-#12: the key SHAPE is checked against the ONE regex store.mjs exports, before any registry
  // read. Both 404s above answer the same with or without it — a key projectKey() produced can
  // never fail the regex — so the pre-filter itself is pinned in the source, like ask/tools.mjs'
  // import-free scan: the point is that no private fourth copy of the shape appears here.
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ projectKey, PROJECT_KEY_RE \} from '\.\.\/src\/core\/store\.mjs';/);
  assert.match(src, /if \(!PROJECT_KEY_RE\.test\(key\)\) return null;/, 'resolveMemoryScope pre-filters the key');
  assert.match(src, /if \(!PROJECT_KEY_RE\.test\(String\(key \|\| ''\)\)\) return res\.status\(404\)/, 'so does the defragment wrapper');
  const r = await get(`/api/memory/projects/${project.key}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.scope, `projects/${project.key}`);
  assert.deepEqual(j.project, { key: project.key, name: 'apimem', path: project.path });
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    const w = await (await put(`/api/memory/projects/${project.key}/files/conventions`, { text: 'Naming rules.\n' })).json();
    assert.deepEqual({ ok: w.ok, name: w.name, created: w.created }, { ok: true, name: 'conventions', created: true });
    await waitFor(() => memFrames(msgs, `projects/${project.key}`).length === 1);
    assert.equal(memFrames(msgs, 'global').length, 0, 'the frame names the scope that changed');
  } finally { ws.close(); }
  assert.ok(await readMemory(memoryRoot(), projectScope(project.key), 'conventions'), 'landed under projects/<key>');
  assert.equal(await readMemory(memoryRoot(), GLOBAL_SCOPE, 'conventions'), null, 'not in global');
});

test('GET /api/memory/health: global + every registered project, with the live-defrag id', async () => {
  let j = await (await get('/api/memory/health')).json();
  assert.equal(j.global.health.level, 'ok', JSON.stringify(j.global.health.reasons));
  assert.equal(j.global.health.files, 2, 'Twin.md + h.md');
  assert.equal(j.global.defragRunId, null);
  assert.deepEqual(j.projects.map((p) => [p.key, p.name]), [[project.key, 'apimem']]);
  assert.equal(j.projects[0].health.files, 1, 'conventions.md from the previous test');
  assert.equal(j.projects[0].defragRunId, null);
  // The per-project id is read per scope, not copied from global.
  runs.set('fake-proj', { id: 'fake-proj', orch: { memoryScope: 'project', pause: () => ({}) }, projectDir: project.path, kind: 'run', status: 'running', events: [], pendingQuestion: null });
  try {
    j = await (await get('/api/memory/health')).json();
    assert.equal(j.projects[0].defragRunId, 'fake-proj');
    assert.equal(j.global.defragRunId, null, 'a project defragment never locks global');
  } finally { runs.delete('fake-proj'); }
});

test('REST writes answer 409 while a defragment run is live on that scope (B23); reads and the other scope are unaffected', async () => {
  const key = `projects/${project.key}`;
  runs.set('fake-proj', { id: 'fake-proj', orch: { memoryScope: 'project', pause: () => ({}) }, projectDir: project.path, kind: 'run', status: 'running', events: [], pendingQuestion: null });
  try {
    const w = await put(`/api/memory/${key}/files/conventions`, { text: 'Rewritten.\n' });
    assert.equal(w.status, 409);
    const body = await w.json();
    assert.equal(body.runId, 'fake-proj');
    assert.match(body.error, /a defragment run is live on this memory scope/);
    assert.equal((await del(`/api/memory/${key}/files/conventions`)).status, 409);
    assert.equal((await post(`/api/memory/${key}/history/20990101-000000-user/restore`)).status, 409,
      'the lock is checked BEFORE the snapshot lookup, which would answer 404');
    assert.equal((await get(`/api/memory/${key}/files/conventions`)).status, 200, 'reads never 409');
    assert.equal((await (await get(`/api/memory/${key}`)).json()).defragRunId, 'fake-proj');
    assert.equal((await put('/api/memory/global/files/free', { text: 'Still writable.\n' })).status, 200, 'the other scope is free');
    assert.equal((await del('/api/memory/global/files/free')).status, 200);
    assert.equal((await (await get(`/api/memory/${key}/files/conventions`)).json()).body, 'Naming rules.\n', 'the refused write changed nothing');
  } finally { runs.delete('fake-proj'); }
});

test('defragment wrappers: 400 / 404 / 409, then a real mock run that stamps the scope and broadcasts', async () => {
  let r = await post('/api/memory/global/defragment', {});
  assert.equal(r.status, 400); assert.match((await r.json()).error, /projectKey is required/);
  assert.equal((await post('/api/memory/global/defragment', { projectKey: 'nope-00000009' })).status, 404);
  assert.equal((await post('/api/memory/projects/nope-00000009/defragment')).status, 404);
  runs.set('fake-proj', { id: 'fake-proj', orch: { memoryScope: 'project', pause: () => ({}) }, projectDir: project.path, kind: 'run', status: 'running', events: [], pendingQuestion: null });
  r = await post(`/api/memory/projects/${project.key}/defragment`);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).runId, 'fake-proj');
  runs.delete('fake-proj');
  assert.equal((await (await get(`/api/memory/projects/${project.key}`)).json()).defragRunId, null);
  // A real (mock) defragment of the project scope: two files → one, counters reset.
  await writeMemory(memoryRoot(), projectScope(project.key), 'second', 'Second rule.\n', { source: 'user' });
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    r = await post(`/api/memory/projects/${project.key}/defragment`);
    let raw = await r.text();
    assert.equal(r.status, 200, raw);
    const { runId } = JSON.parse(raw);
    const entry = runs.get(runId);
    assert.equal(entry.orch.memoryScope, 'project');
    assert.equal(entry.title, 'Memory defragment: apimem', 'the wrapper names the run (a provisional LLM title may replace it later)');
    assert.equal(entry.orch.guardrailsId, 'normal');
    assert.equal((await (await get(`/api/memory/projects/${project.key}`)).json()).defragRunId, runId, 'live while it runs');
    const done = await untilSettled(runId);
    assert.equal(done.status, 'done', JSON.stringify({ status: done.status, detail: done.pauseDetail }));
    const st = await untilStamped(projectScope(project.key), entry.pipelineId);
    assert.equal(st.writesSinceDefrag, 0);
    assert.equal(st.lastDefragRunId, entry.pipelineId);
    assert.ok((await listSnapshots(memoryRoot(), projectScope(project.key))).some((s) => s.id.includes('-defrag-')));
    await waitFor(() => memFrames(msgs, `projects/${project.key}`).length >= 1);
    const after = await (await get(`/api/memory/projects/${project.key}`)).json();
    assert.equal(after.state.writesSinceDefrag, 0, 'the frame means "refetch": the stamp is already visible');
    const { readPipelineByKey } = await import('../src/core/artifacts.mjs');
    const row = await readPipelineByKey(project.key, entry.pipelineId);
    assert.equal(row.state.prompt, 'Defragment the memory of project apimem.');
    assert.equal(row.state.guardrailsId, 'normal');
    // The global wrapper needs a host project and builds the same request.
    r = await post('/api/memory/global/defragment', { projectKey: project.key });
    raw = await r.text();
    assert.equal(r.status, 200, raw);
    const g = runs.get(JSON.parse(raw).runId);
    assert.equal(g.orch.memoryScope, 'global');
    assert.equal(g.projectDir, project.path);
    assert.equal(g.title, 'Memory defragment (global)');
    await untilSettled(g.id);
    await untilStamped(GLOBAL_SCOPE, g.pipelineId);   // never leave the run stamping after `after` restores WORCA_HOME
    await waitFor(() => memFrames(msgs, 'global').length >= 1);
  } finally { ws.close(); }
});

test('the wrappers refuse a project whose path is gone (400) before any run is started', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const dir = gitDir('apimem-gone');
  const gone = (await addProject({ name: 'apimem-gone', path: dir })).find((p) => p.name === 'apimem-gone');
  await rmWithRetry(dir);
  const before = runs.size;
  const r = await post(`/api/memory/projects/${gone.key}/defragment`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /project path is missing/);
  assert.equal((await post('/api/memory/global/defragment', { projectKey: gone.key })).status, 400, 'the host project must exist too');
  assert.equal(runs.size, before, 'no run was registered');
  assert.equal(existsSync(dir), false);
});

test('an ORDINARY run that mounted memory broadcasts one memory-changed per mounted scope at its end, whatever the terminal status (B29)', async () => {
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = gitDir('apimem-plain');
  const scope = `projects/${projectKey(dir)}`;
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    const r = await post('/api/run', { projectDir: dir, prompt: 'Say hello.', workflowId: 'wf_default', mock: true });
    const raw = await r.text();
    assert.equal(r.status, 200, raw);
    const { runId } = JSON.parse(raw);
    assert.equal(runs.get(runId).orch.memoryScope, null, 'an ordinary run carries no memoryScope');
    // The mock pipeline parks on the clarifier's question; STOP it. A stopped run still syncs its
    // mount back (P1 _buildResults({ stage: true }) runs on done, stopped, error and paused alike),
    // so the frames must fire on that path too — the hook gates on neither memoryScope nor status.
    await waitFor(() => runs.get(runId)?.pendingQuestion);
    assert.deepEqual(runs.get(runId).orch.memory.dirs.map((d) => d.rel), ['global', 'project'], 'an ordinary run mounts BOTH scopes');
    assert.equal((await post('/api/stop', { runId })).status, 200);
    const stopped = await untilSettled(runId);
    assert.equal(stopped.status, 'stopped');
    await waitFor(() => memFrames(msgs, 'global').length >= 1 && memFrames(msgs, scope).length >= 1);
    const doneAt = msgs.findIndex((m) => m.type === 'done' && m.runId === runId);
    const globalAt = msgs.findIndex((m) => m.type === 'memory-changed' && m.scope === 'global');
    const projectAt = msgs.findIndex((m) => m.type === 'memory-changed' && m.scope === scope);
    assert.ok(doneAt >= 0, 'the run reported done on the socket');
    assert.ok(globalAt >= 0 && globalAt < doneAt, 'the global frame precedes the done frame the views react to');
    assert.ok(projectAt >= 0 && projectAt < doneAt, 'so does the project frame');
  } finally { ws.close(); }
});

test('MEMORY_NAME_HELP is ONE string: the route and the Memory view share it', async () => {
  let view = null;
  try { view = await import('../ui/public/memory-view.mjs'); }
  catch (err) {
    assert.equal(err?.code, 'ERR_MODULE_NOT_FOUND', String(err));
    return;   // Task 11's module is not in the tree yet (a strictly linear execution)
  }
  assert.equal(view.MEMORY_NAME_HELP, MEMORY_NAME_HELP);
});

test('the REST writers take the store lock every other in-process writer takes', async () => {
  // A PUT / DELETE / restore that lands during a live run's node sync (or an Ask `remember`)
  // interleaves readScopeState/bumpScopeState and the snapshot order — one counter increment
  // lost. Every other in-process writer runs under withStoreLock(memoryRoot()); so do these
  // three. Pinned in the source (assert.ok, not assert.match: a failing match on a 300 KB
  // source dumps the whole file): the race needs two real concurrent writers to reproduce.
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.ok(/import \{ validateMemoryScope, withStoreLock \} from '\.\.\/src\/core\/memory-sync\.mjs';/.test(src), 'withStoreLock is imported next to validateMemoryScope');
  assert.ok(/await withStoreLock\(memoryRoot\(\), \(\) => writeMemory\(memoryRoot\(\), scope, name, text, \{ source: 'user', caps: memoryCaps\(\) \}\)\)/.test(src), 'the PUT writes under the lock');
  assert.ok(/await withStoreLock\(memoryRoot\(\), \(\) => removeMemory\(memoryRoot\(\), scope, name, \{ source: 'user' \}\)\)/.test(src), 'the DELETE removes under the lock');
  assert.ok(/await withStoreLock\(memoryRoot\(\), \(\) => restoreSnapshot\(memoryRoot\(\), scope, String\(req\.params\.id \|\| ''\), \{ source: 'user' \}\)\)/.test(src), 'the restore runs under the lock');
});
