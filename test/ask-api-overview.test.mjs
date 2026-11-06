// test/ask-api-overview.test.mjs — GET /api/ask/threads/:id/overview on the in-process server (issue 1064): the shape,
// the id and thread guards, the started runs (a card link, a schedule-fired run; never a tracked run or another chat's),
// and the files (a show_files copy and an output-folder file; never an upload). The guards, the visibility middleware and
// the DB join exist only in the real server, hence the in-process app. Every response body is read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, srv, base, mod, store, A, B, ARCH;
const P1 = 'aaaa0001', P2 = 'aaaa0002', P3 = 'aaaa0003', P4 = 'aaaa0004', PB = 'bbbb0001';

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askoverview-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_MOCK: '1' });
  const db = await import('../src/core/db.mjs');
  db._resetForTests();
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  store = await import('../src/core/ask/store.mjs');
  A = store.createThread({ title: 'A' }).id;
  B = store.createThread({ title: 'B' }).id;
  ARCH = store.createThread({ title: 'archived' }).id;
  store.setArchived(ARCH, true);
  const seed = (id, over = {}) => seedPipelineRow({ id, projectKey: 'app-0000aaaa', title: `Run ${id}`, status: 'done', phase: 'done',
    startedAt: `2026-10-0${id.at(-1)}T00:00:00.000Z`, totalCostUsd: 0.5, branch: { source: 'dev', feature: `feat/${id}` }, ...over });
  for (const id of [P1, P2, P3, P4, PB]) seed(id);
  store.linkRun(A, { runId: 'r-1', pipelineId: P1, cardId: 'card_00000001', status: 'done' });
  store.linkRun(A, { runId: 'r-2', pipelineId: P2, cardId: null, status: 'done' });            // track_run: followed only
  store.linkRun(B, { runId: 'r-b', pipelineId: PB, cardId: 'card_0000000b', status: 'done' });
  const now = new Date().toISOString();
  db.getDb().prepare(`INSERT INTO schedules (id, title, request, rule, ask_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('sch_0000000a', 'nightly', '{}', '{}', A, now, now);
  db.getDb().prepare('UPDATE pipelines SET schedule_id = ? WHERE id = ?').run('sch_0000000a', P3);
  db.getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_number = 4, pr_state = ? WHERE id = ?').run('https://github.com/o/r/pull/4', 'OPEN', P1);
  store.addAttachment(A, null, { name: 'plan.md', text: '# plan', sourcePath: '/tmp/plan.md' });
  const mid = store.appendMessage(A, { role: 'user', text: 'hi', status: 'done' });
  store.addAttachment(A, typeof mid === 'string' ? mid : mid.id, { name: 'upload.txt', text: 'u' });
  const out = store.askOutDir(A);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'report.md'), '# r');
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => setTimeout(r, 500))]);
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(homeDir, { recursive: true, force: true });
});
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };

test('200 shape: started runs only (a card link and a schedule-fired run), their PR, newest first', async () => {
  const r = await get(`/api/ask/threads/${A}/overview`);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['artifacts', 'artifactsTotal', 'environment', 'prs', 'runs']);
  assert.deepEqual(r.body.runs.map((x) => x.pipelineId), [P3, P1], 'the tracked run is absent; the schedule join adds P3');
  assert.deepEqual(r.body.runs[1], { runId: 'r-1', pipelineId: P1, title: `Run ${P1}`, status: 'done', phase: 'done', costUsd: 0.5, runEngine: 'claude',
    startedAt: '2026-10-01T00:00:00.000Z', href: `#history/app-0000aaaa/${P1}`, branch: `feat/${P1}` });
  assert.deepEqual(r.body.prs, [{ url: 'https://github.com/o/r/pull/4', label: 'o/r#4', refKey: 'gh:o/r#4', title: `Run ${P1}`, state: 'open', runId: 'r-1', source: 'run' }]);
  const f = r.body.environment.followedRun;   // followedRunOf: the newest link (a tie in time goes by run id)
  assert.ok([P1, P2].includes(f.pipelineId), JSON.stringify(f));
  assert.deepEqual(f, { pipelineId: f.pipelineId, title: `Run ${f.pipelineId}`, branch: `feat/${f.pipelineId}` });
});

test('another chat\'s links absent', async () => {
  const a = await get(`/api/ask/threads/${A}/overview`);
  assert.equal(a.body.runs.some((x) => x.pipelineId === PB), false);
  const b = await get(`/api/ask/threads/${B}/overview`);
  assert.deepEqual(b.body.runs.map((x) => x.pipelineId), [PB]);
  assert.deepEqual(b.body.artifacts, []);
});

test('a show_files copy and an output file listed, an upload not', async () => {
  const r = await get(`/api/ask/threads/${A}/overview`);
  assert.deepEqual(r.body.artifacts.map((x) => [x.source, x.name]).sort(), [['out', 'report.md'], ['shown', 'plan.md']]);
  assert.equal(r.body.artifactsTotal, 2);
  assert.equal(r.body.artifacts.find((x) => x.source === 'out').path, 'report.md');
});

test('400 bad id; 404 unknown / archived thread', async () => {
  const bad = await get('/api/ask/threads/nope/overview');
  assert.equal(bad.status, 400);
  const unknown = await get('/api/ask/threads/ask_0000ffff/overview');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'thread not found');
  const arch = await get(`/api/ask/threads/${ARCH}/overview`);
  assert.equal(arch.status, 404);
});
