// test/ask-api-overview.test.mjs — GET /api/ask/threads/:id/overview on the in-process server (issue 1064): the shape,
// the id and thread guards, the started runs (a card link, a schedule-fired run; never a tracked run or another chat's),
// and the files (a show_files copy and an output-folder file; never an upload). The guards, the visibility middleware and
// the DB join exist only in the real server, hence the in-process app. Every response body is read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, srv, base, mod, store, A, B, C, ARCH, OUT_REAL, DZ, DZ_ID;
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
  C = store.createThread({ title: 'C' }).id;
  const seed = (id, over = {}) => seedPipelineRow({ id, projectKey: 'app-0000aaaa', title: `Run ${id}`, status: 'done', phase: 'done',
    startedAt: `2026-10-0${id.at(-1)}T00:00:00.000Z`, totalCostUsd: 0.5, branch: { source: 'dev', feature: `feat/${id}` }, ...over });
  for (const id of [P1, P2, P3, P4, PB]) seed(id);
  // Thread C (Overview › Runs): a started parent with a watch fix round (never linked), a legacy fix card naming an origin
  // that was not started here, a tracked run with a PR, and a run a reply named.
  const round = (origin, n) => ({ source: 'dev', feature: `feat/${origin}`, roundOf: { pipelineId: origin, round: n, by: 'watch', kinds: ['ci'] } });
  seed('cccc0001', { totalCostUsd: 2 });
  seed('cccc0002', { branch: round('cccc0001', 2), totalCostUsd: 0.25 });
  seed('cccc0003', { totalCostUsd: 0.5 });
  seed('cccc0004', { title: 'Origin elsewhere' });
  seed('cccc0005');
  seed('cccc0006');
  store.linkRun(C, { runId: 'r-c1', pipelineId: 'cccc0001', cardId: 'card_000000c1', status: 'done' });
  store.appendMessage(C, { role: 'system', text: 'PR watch started a fix run', blocks: [{ kind: 'card', id: 'card_000000f1', state: 'applied',
    card: { type: 'progress', runId: 'r-fx', pipelineId: 'cccc0003', title: 'PR fix run', fix: { prUrl: 'https://github.com/o/r/pull/44', memberKey: null, originPipelineId: 'cccc0004' } } }] });
  store.linkRun(C, { runId: 'r-fx', pipelineId: 'cccc0003', cardId: 'card_000000f1', status: 'done' });
  store.linkRun(C, { runId: 'r-c5', pipelineId: 'cccc0005', cardId: null, status: 'done' });
  store.appendMessage(C, { role: 'assistant', text: 'Also see cccc0006.', status: 'done' });
  store.linkRun(A, { runId: 'r-1', pipelineId: P1, cardId: 'card_00000001', status: 'done' });
  store.linkRun(A, { runId: 'r-2', pipelineId: P2, cardId: null, status: 'done' });            // track_run: followed only
  store.linkRun(B, { runId: 'r-b', pipelineId: PB, cardId: 'card_0000000b', status: 'done' });
  const now = new Date().toISOString();
  db.getDb().prepare(`INSERT INTO schedules (id, title, request, rule, ask_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('sch_0000000a', 'nightly', '{}', '{}', A, now, now);
  db.getDb().prepare('UPDATE pipelines SET schedule_id = ? WHERE id = ?').run('sch_0000000a', P3);
  db.getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_number = 4, pr_state = ? WHERE id = ?').run('https://github.com/o/r/pull/4', 'OPEN', P1);
  db.getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_number = 55, pr_state = ? WHERE id = ?').run('https://github.com/o/r/pull/55', 'OPEN', 'cccc0005');
  store.addAttachment(A, null, { name: 'plan.md', text: '# plan', sourcePath: '/tmp/plan.md' });
  const mid = store.appendMessage(A, { role: 'user', text: 'hi', status: 'done' });
  store.addAttachment(A, typeof mid === 'string' ? mid : mid.id, { name: 'upload.txt', text: 'u' });
  const out = store.askOutDir(A);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'report.md'), '# r');
  // A PDF saved in the out folder AND shown (show_files stores the copy with the file's realpath as its source).
  const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
  await writeFile(join(out, 'report.pdf'), pdf);
  OUT_REAL = await realpath(out);
  store.addAttachment(A, null, { name: 'report.pdf', kind: 'binary', mime: 'application/pdf', data: pdf, sourcePath: join(OUT_REAL, 'report.pdf') });
  // A design chat (its design's own folder is its tools' folder when it has no project).
  const { createDesignThread } = await import('../src/core/design/chat-thread.mjs');
  const designs = await import('../src/core/design/store.mjs');
  DZ = createDesignThread({ design: { title: 'Launch deck' } }).id;
  DZ_ID = designs.createDesign({ kind: 'presentation', title: 'Launch deck', threadId: DZ }).id;
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
  assert.deepEqual(Object.keys(r.body).sort(), ['artifacts', 'artifactsTotal', 'environment', 'mentioned', 'prs', 'runs']);
  assert.deepEqual(r.body.runs.map((x) => x.pipelineId), [P3, P1], 'the tracked run is absent; the schedule join adds P3');
  assert.deepEqual(r.body.runs[1], { runId: 'r-1', pipelineId: P1, title: `Run ${P1}`, status: 'done', phase: 'done', costUsd: 0.5, runEngine: 'claude',
    startedAt: '2026-10-01T00:00:00.000Z', href: `#history/app-0000aaaa/${P1}`, branch: `feat/${P1}`, fixes: [] });
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
  assert.deepEqual(r.body.artifacts.map((x) => [x.source, x.name]).sort(), [['out', 'report.md'], ['shown', 'plan.md'], ['shown', 'report.pdf']]);
  assert.equal(r.body.artifactsTotal, 3);
  assert.equal(r.body.artifacts.find((x) => x.source === 'out').path, 'report.md');
});

test('a PDF saved in out and shown: one row, source shown, kind pdf; the response holds no source path', async () => {
  const r = await get(`/api/ask/threads/${A}/overview`);
  assert.equal(r.status, 200);
  const pdfs = r.body.artifacts.filter((x) => x.name === 'report.pdf');
  assert.equal(pdfs.length, 1, JSON.stringify(r.body.artifacts));
  assert.equal(pdfs[0].source, 'shown');
  assert.equal(pdfs[0].kind, 'pdf');
  assert.equal(r.body.artifacts.find((x) => x.name === 'plan.md').kind, 'markdown');
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes(OUT_REAL), 'the out folder\'s real path never leaves the server');
  assert.ok(!text.includes('source_path') && !text.includes('/tmp/plan.md'), 'no source path');
  assert.equal(r.body.artifactsTotal, 3, 'counted once');
});

test('Overview › Runs: a watch fix round nests under its started parent (own cost); a fix card brings its origin to Mentioned; tracked and reply-named runs are Mentioned, their PRs listed as mentioned', async () => {
  const r = await get(`/api/ask/threads/${C}/overview`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.runs.map((x) => [x.pipelineId, x.costUsd, x.fixes.map((f) => [f.pipelineId, f.n, f.costUsd])]), [['cccc0001', 2, [['cccc0002', 1, 0.25]]]],
    'roundsOf: the round the watch marked; the fix card\'s run is not a started row');
  assert.deepEqual(r.body.mentioned.map((m) => [m.pipelineId, m.source, m.fixes.map((f) => [f.pipelineId, f.runId])]).sort(),
    [['cccc0004', 'fix', [['cccc0003', 'r-fx']]], ['cccc0005', 'link', []], ['cccc0006', 'reply', []]], 'prFixOf: the card\'s originPipelineId');
  assert.deepEqual(r.body.prs.map((p) => [p.label, p.source]), [['o/r#55', 'mentioned']], 'a mentioned run\'s PR comes last, marked mentioned');
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

test('a design chat lists its design under Artifacts; a plain chat has none', async () => {
  const dz = await get(`/api/ask/threads/${DZ}/overview`);
  assert.equal(dz.status, 200);
  assert.deepEqual(dz.body.artifacts.filter((x) => x.source === 'design').map((x) => [x.designId, x.name, x.kind]), [[DZ_ID, 'Launch deck', 'presentation']], 'its design is an artifact too');
  const a = await get(`/api/ask/threads/${A}/overview`);
  assert.equal(a.body.artifacts.some((x) => x.source === 'design'), false);
});

test('a plain chat lists the designs it asked for (designs.origin_thread_id), though no message names them; another chat does not', async () => {
  const { createDesignThread } = await import('../src/core/design/chat-thread.mjs');
  const designs = await import('../src/core/design/store.mjs');
  const asked = designs.createDesign({ kind: 'web', title: 'Asked by C', originThreadId: C, threadId: createDesignThread({ design: { title: 'Asked by C' } }).id });
  try {
    const c = await get(`/api/ask/threads/${C}/overview`);
    assert.equal(c.status, 200);
    assert.ok(c.body.artifacts.some((x) => x.source === 'design' && x.designId === asked.id && x.name === 'Asked by C'));
    const b = await get(`/api/ask/threads/${B}/overview`);
    assert.equal(b.body.artifacts.some((x) => x.designId === asked.id), false);
  } finally { designs.deleteDesign(asked.id); }
});

test('a design chat with no project: its tools work in the design\'s folder; a plain chat with no project is refused', async () => {
  const { designWorkDir } = await import('../src/core/design/paths.mjs');
  await mkdir(designWorkDir(DZ_ID), { recursive: true });
  await writeFile(join(designWorkDir(DZ_ID), 'shell.html'), '<!doctype html>');
  const dz = await get(`/api/tools/files?scope=chat&threadId=${DZ}`);
  assert.equal(dz.status, 200, JSON.stringify(dz.body));
  assert.equal(dz.body.root.label, 'Design · Launch deck');
  assert.ok(dz.body.entries.some((e) => e.name === 'shell.html'));
  const plain = await get(`/api/tools/files?scope=chat&threadId=${A}`);
  assert.equal(plain.status, 409);
  assert.equal(plain.body.code, 'NO_PROJECT');
});
