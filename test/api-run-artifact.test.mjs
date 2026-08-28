// test/api-run-artifact.test.mjs
// P6a — the End-result artifact routes: `rel` never reaches the filesystem, it
// only SELECTS among the run's own indexed artifacts rows (exact rel_path, else
// the longest path SUFFIX `…/<rel_path>`), and the STORED rel_path is what is
// read — run dir first, store root second. Server idiom = test/history-api.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

let homeDir, srv, base, prevHome, proj, key, id, dir, wsId, wsKey;
const WS_KEY = 'wks-team-a-00000001';

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-p6-art-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-p6-art-proj-'));
  ({ id, key, dir } = await seedPipeline(proj, { title: 'A', status: 'done' }));
  // Indexed artifacts: one plain file, a basename COLLISION across two dirs, and
  // a stored path with a `..` segment that must never be served.
  await writeFile(join(dir, 'plan-review.md'), '# review\n', 'utf8');
  await mkdir(join(dir, 'a'), { recursive: true });
  await mkdir(join(dir, 'b'), { recursive: true });
  await writeFile(join(dir, 'plan.md'), '# bare\n', 'utf8');
  await writeFile(join(dir, 'a', 'plan.md'), '# a\n', 'utf8');
  await writeFile(join(dir, 'b', 'plan.md'), '# b\n', 'utf8');
  await writeFile(join(dir, '..', 'outside.md'), 'never\n', 'utf8');
  await writeFile(join(dir, 'state.json'), '{}', 'utf8');            // present on disk, NOT indexed
  recordArtifact(id, 'review', 'plan-review.md');
  // An End node that bound a BARE `plan.md`: listArtifacts orders by (kind,
  // rel_path), so this row is listed BEFORE `plan/a/plan.md` — a first-match
  // `find` over the suffix test would serve it for `/x/a/plan.md`.
  recordArtifact(id, 'end', 'plan.md');
  recordArtifact(id, 'plan', 'a/plan.md');
  recordArtifact(id, 'plan', 'b/plan.md');
  recordArtifact(id, 'evil', '../outside.md');
  // The shared plan/review markdown is STORE-ROOT-relative (store/<key>/plans/…), not run-dir-relative.
  await mkdir(join(dir, '..', '..', 'plans'), { recursive: true });
  await writeFile(join(dir, '..', '..', 'plans', 'shared.md'), '# shared\n', 'utf8');
  recordArtifact(id, 'plan', 'plans/shared.md');
  // A workspace run under the workspace store namespace.
  const ws = await seedWorkspacePipeline(proj, WS_KEY, { title: 'ws run', status: 'done' },
    [{ projectKey: key, projectDir: proj, projectName: 'alpha' }]);
  wsId = ws.id; wsKey = WS_KEY;
  await writeFile(join(ws.dir, 'result.md'), '# ws\n', 'utf8');
  recordArtifact(wsId, 'result', 'result.md');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

const q = (rel) => `?rel=${encodeURIComponent(rel)}`;

test('GET /api/history/:key/:id/artifact serves an indexed artifact by exact rel_path or by path suffix', async () => {
  const abs = await fetch(`${base}/api/history/${key}/${id}/artifact${q('/abs/run/plan-review.md')}`);
  assert.equal(abs.status, 200);
  assert.deepEqual(await abs.json(), { rel: 'plan-review.md', text: '# review\n' });
  const exact = await fetch(`${base}/api/history/${key}/${id}/artifact${q('plan-review.md')}`);
  assert.equal(exact.status, 200);
  assert.deepEqual(await exact.json(), { rel: 'plan-review.md', text: '# review\n' });
  // Store-root-relative rows are read from the store root when the run dir has no such file.
  const shared = await fetch(`${base}/api/history/${key}/${id}/artifact${q('/abs/store/plans/shared.md')}`);
  assert.equal(shared.status, 200);
  assert.deepEqual(await shared.json(), { rel: 'plans/shared.md', text: '# shared\n' });
});

test('a basename collision resolves by the longest SUFFIX, never by basename alone', async () => {
  const b = await fetch(`${base}/api/history/${key}/${id}/artifact${q('/x/b/plan.md')}`);
  assert.deepEqual(await b.json(), { rel: 'b/plan.md', text: '# b\n' });
  // The run also indexes a BARE `plan.md`, so `/x/a/plan.md` ends with the suffix
  // of TWO rows (`/plan.md` and `/a/plan.md`): the longer one is the right file.
  const a = await fetch(`${base}/api/history/${key}/${id}/artifact${q('/x/a/plan.md')}`);
  assert.deepEqual(await a.json(), { rel: 'a/plan.md', text: '# a\n' });
  const exactBare = await fetch(`${base}/api/history/${key}/${id}/artifact${q('plan.md')}`);
  assert.deepEqual(await exactBare.json(), { rel: 'plan.md', text: '# bare\n' }, 'an EXACT rel_path still wins outright');
  // `plans/shared.md` is indexed, `shared.md` is not: a bare basename never
  // matches a nested row (the suffix must start at a '/').
  const bare = await fetch(`${base}/api/history/${key}/${id}/artifact${q('shared.md')}`);
  assert.equal(bare.status, 404, 'a bare basename never matches a nested row');
});

test('un-indexed files, traversal and a stored `..` path all 404; a bad key never reaches the store', async () => {
  const nope = await fetch(`${base}/api/history/${key}/${id}/artifact${q('state.json')}`);
  assert.equal(nope.status, 404, 'an un-indexed file is never served');
  assert.deepEqual(await nope.json(), { error: 'artifact not found' });
  const trav = await fetch(`${base}/api/history/${key}/${id}/artifact${q('../../../etc/passwd')}`);
  assert.equal(trav.status, 404);
  // A stored `..` path is refused even when the request matches it exactly or by suffix.
  for (const rel of ['../outside.md', '/x/../outside.md']) {
    const evil = await fetch(`${base}/api/history/${key}/${id}/artifact${q(rel)}`);
    assert.equal(evil.status, 404, `an indexed row whose stored path climbs out of the run dir is refused (${rel})`);
    assert.deepEqual(await evil.json(), { error: 'artifact not found' });
  }
  // The key regex runs BEFORE any lookup (same posture as /diff). Assert the BODY:
  // a missing guard still 404s via the null lookup, but says 'artifact not found'.
  const badKey = await fetch(`${base}/api/history/${encodeURIComponent('../etc')}/${id}/artifact${q('plan-review.md')}`);
  assert.equal(badKey.status, 404);
  assert.deepEqual(await badKey.json(), { error: 'pipeline not found' });
  const noRun = await fetch(`${base}/api/history/${key}/no-such-id/artifact${q('plan-review.md')}`);
  assert.deepEqual(await noRun.json(), { error: 'artifact not found' });
});

test('GET /api/workspaces/:id/runs/:runId/artifact is the workspace twin', async () => {
  const ok = await fetch(`${base}/api/workspaces/${wsKey}/runs/${wsId}/artifact${q('/abs/ws/result.md')}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { rel: 'result.md', text: '# ws\n' });
  const badWs = await fetch(`${base}/api/workspaces/${encodeURIComponent('../etc')}/runs/${wsId}/artifact${q('result.md')}`);
  assert.equal(badWs.status, 404);
  assert.deepEqual(await badWs.json(), { error: 'pipeline not found' }, 'WORKSPACE_KEY_RE guards the id');
  const nope = await fetch(`${base}/api/workspaces/${wsKey}/runs/${wsId}/artifact${q('state.json')}`);
  assert.deepEqual(await nope.json(), { error: 'artifact not found' });
});

test('GET /api/runs/:id/artifact resolves the row by id alone (the Running page has no store key)', async () => {
  const ok = await fetch(`${base}/api/runs/${id}/artifact${q('/abs/run/plan-review.md')}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { rel: 'plan-review.md', text: '# review\n' });
  const ws = await fetch(`${base}/api/runs/${wsId}/artifact${q('result.md')}`);
  assert.deepEqual(await ws.json(), { rel: 'result.md', text: '# ws\n' }, 'workspace rows resolve by id too');
  const unknown = await fetch(`${base}/api/runs/00000000/artifact${q('plan-review.md')}`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'pipeline not found' });
  const nope = await fetch(`${base}/api/runs/${id}/artifact${q('state.json')}`);
  assert.equal(nope.status, 404);
  assert.deepEqual(await nope.json(), { error: 'artifact not found' });
});
