// test/api-workspace-folders.test.mjs — the "machine without git" workspace flows end to end (in-process server, mock).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withNoGit } from './helpers/git-off.mjs';

let srv, base, testing, home;
const env0 = { WORCA_HOME: process.env.WORCA_HOME, WORCA_MOCK: process.env.WORCA_MOCK };
const created = [];
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-wsfold-home-'));
  Object.assign(process.env, { WORCA_HOME: home, WORCA_MOCK: '1' });
  _resetForTests();
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(env0)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  _resetForTests();
  for (const d of [...created, home]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});
const get = (p) => fetch(`${base}${p}`);
const post = (p, body = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const folder = (tag) => { const d = mkdtempSync(join(tmpdir(), `worca-wsfold-${tag}-`)); writeFileSync(join(d, 'notes.txt'), 'n\n'); created.push(d); return d; };
async function register(...dirs) {
  for (const [i, d] of dirs.entries()) assert.equal((await post('/api/projects', { name: `Fold ${created.length}-${i}`, path: d })).status, 200);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Start a mock workspace run and drive it to its end: wf_default parks at a clarify gate (humanInLoop:false too), so each
 *  question is answered as auto mode would; entry.settled = the harness's finally (teardown, retain) has run. */
async function runDone(workspaceId) {
  const r = await post('/api/run', { workspaceId, prompt: 'x', mock: true });
  assert.equal(r.status, 200, await r.clone().text());
  const { runId } = await r.json();
  const entry = testing.liveRunEntry(runId);
  const answered = new Set();
  const t0 = Date.now();
  while (!entry.settled) {
    if (Date.now() - t0 > 120000) throw new Error(`run ${runId} never settled: ${entry.status} ${entry.pendingQuestion?.id ?? ''}`);
    const pq = entry.pendingQuestion;
    if (pq && !answered.has(pq.id)) {
      answered.add(pq.id);
      const payload = pq.kind === 'clarify' || pq.kind === 'questions'
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      await post('/api/answer', { runId, id: pq.id, payload });
    }
    await sleep(50);
  }
  await entry.launch;
  const st = entry.orch.getState();
  assert.equal(st.status, 'done', JSON.stringify({ status: st.status, reason: st.pauseReason, detail: st.pauseDetail }));
  return st;
}

test('per-member Changes, Apply and Discard on a workspace run; the run root goes with the last member; History rolls it up', async (t) => {
  await withNoGit(t);                              // every test in this file runs on a machine without git
  const f1 = folder('ap1'); const f2 = folder('ap2');
  await register(f1, f2);
  const { workspace } = await (await post('/api/workspaces', { name: 'Apply WS', projectPaths: [f1, f2] })).json();
  const st = await runDone(workspace.id);
  const id = st.id;
  const k1 = projectKey(f1), k2 = projectKey(f2);
  const runRoot = join(home, '.worca-cc', 'runs', id);
  await checkRows([
    { name: 'no memberKey on a workspace run -> 400', run: async () => {
      const r = await get(`/api/runs/${id}/changes`);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, 'memberKey is required for a workspace run');
    } },
    { name: 'an unknown member -> 400', run: async () => {
      const r = await get(`/api/runs/${id}/changes?memberKey=nope-00000000`);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, 'unknown workspace member: nope-00000000');
    } },
    { name: 'each member has its own pending Changes', run: async () => {
      for (const k of [k1, k2]) {
        const j = await (await get(`/api/runs/${id}/changes?memberKey=${k}`)).json();
        assert.equal(j.state, 'pending');
        assert.deepEqual(j.counts, { added: 2, modified: 0, deleted: 0 });
      }
    } },
    { name: 'the apply plan targets the member\'s own folder', run: async () => {
      const j = await (await get(`/api/runs/${id}/apply-plan?memberKey=${k1}`)).json();
      assert.equal(j.target, f1);
      assert.deepEqual(j.add, ['src/feature.mjs', 'test/feature.test.mjs']);
      assert.deepEqual([j.update, j.delete, j.skipped], [[], [], []]);
    } },
    { name: 'deleting the workspace while a member\'s Changes wait -> 409; the Changes stay', run: async () => {
      const r = await fetch(`${base}/api/workspaces/${workspace.id}`, { method: 'DELETE' });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, `workspace has a run whose Folder changes are not applied yet (pipeline ${id}); apply or discard them first`);
      assert.equal((await (await get(`/api/runs/${id}/changes?memberKey=${k1}`)).json()).state, 'pending');
    } },
    { name: 'Apply one member: its folder gets the files, its copy goes, the run root stays for the other', run: async () => {
      assert.deepEqual(await (await post(`/api/runs/${id}/apply?memberKey=${k1}`)).json(), { applied: 2, skipped: [] });
      assert.ok(existsSync(join(f1, 'src', 'feature.mjs')));
      assert.deepEqual(readdirSync(f2), ['notes.txt']);
      assert.ok(!existsSync(join(runRoot, 'repos', k1)));
      assert.ok(existsSync(join(runRoot, 'repos', k2)));
      assert.equal((await (await get(`/api/runs/${id}/changes?memberKey=${k1}`)).json()).state, 'applied');
    } },
    { name: 'Discard the last member: its folder untouched, the run root removed', run: async () => {
      assert.deepEqual(await (await post(`/api/runs/${id}/discard?memberKey=${k2}`)).json(), { ok: true });
      assert.deepEqual(readdirSync(f2), ['notes.txt']);
      assert.ok(!existsSync(runRoot));
    } },
    { name: 'History: each member carries its workMode and Changes; the row rolls them up', run: async () => {
      const row = (await (await get('/api/history')).json()).pipelines.find((p) => p.id === id);
      assert.deepEqual(row.members.map((m) => [m.memberKey, m.workMode, m.changes.state, m.affected]).sort(),
        [[k1, 'folder', 'applied', true], [k2, 'folder', 'discarded', true]].sort());
      assert.deepEqual(row.changes, { state: 'applied', counts: { added: 4, modified: 0, deleted: 0 } });
    } },
  ]);
});

test('WORCA_GIT=0: create by scan (the wizard), then the workspace lists both members as Folder', async (t) => {
  await withNoGit(t);
  const f1 = folder('sc1'); const f2 = folder('sc2');
  await register(f1, f2);
  const r = await post('/api/workspaces/scan', { name: 'No Git WS', projectPaths: [f1, f2] });
  assert.equal(r.status, 200);
  const entry = testing.liveRunEntry((await r.json()).runId);
  await entry.launch;
  assert.equal(entry.orch.getState().workspaceScan.outcome, 'created');
  const ws = (await (await get('/api/workspaces')).json()).workspaces.find((w) => w.name === 'No Git WS');
  assert.deepEqual(ws.vcs, ['none', 'none']);
});
