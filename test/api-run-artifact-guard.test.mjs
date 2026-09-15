// Run-folder-artifacts D11 on the wire: the three artifact routes answer 415 for a
// binary kind and 413 above the 2 MB cap (with rel + bytes), and the plural route
// reports truncation instead of silently capping at 200 rows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact, ARTIFACT_READ_MAX_BYTES } from '../src/core/artifacts.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

let homeDir, srv, base, prevHome, proj, key, id, many, wsId;
const WS_KEY = 'wks-team-a-00000001';           // the same shape test/api-run-artifact.test.mjs uses
const ATTR = { stepKey: 'x:n_x:1', nodeId: 'n_x', cycle: 1 };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-art-guard-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-art-guard-proj-'));
  const s = await seedPipeline(proj, { title: 'A', status: 'done' });
  ({ id, key } = s);
  const step = join(s.dir, 'steps', 'n_x-c1');
  await mkdir(step, { recursive: true });
  await writeFile(join(step, 'shot.png'), Buffer.from([0x89, 0x50]));
  await writeFile(join(step, 'big.txt'), '');
  await truncate(join(step, 'big.txt'), ARTIFACT_READ_MAX_BYTES + 1);
  await writeFile(join(step, 'ok.md'), '# ok\n');
  recordArtifact(id, 'image', 'steps/n_x-c1/shot.png', ATTR);
  recordArtifact(id, 'text', 'steps/n_x-c1/big.txt', ATTR);
  recordArtifact(id, 'markdown', 'steps/n_x-c1/ok.md', ATTR);
  // A run with more rows than the list cap (files need not exist: bytes report 0).
  many = (await seedPipeline(proj, { title: 'M', status: 'done' })).id;
  for (let i = 0; i < ASK_LIMITS.artifactsListMaxLimit + 1; i++) recordArtifact(many, 'text', `steps/n_x-c1/f${String(i).padStart(3, '0')}.txt`, ATTR);
  const ws = await seedWorkspacePipeline(proj, WS_KEY, { title: 'ws', status: 'done' }, [{ projectKey: key, projectDir: proj, projectName: 'alpha' }]);
  wsId = ws.id;
  await mkdir(join(ws.dir, 'steps', 'n_w-c1'), { recursive: true });
  await writeFile(join(ws.dir, 'steps', 'n_w-c1', 'w.png'), Buffer.from([1, 2, 3]));
  recordArtifact(wsId, 'image', 'steps/n_w-c1/w.png', { stepKey: 'x:n_w:1', nodeId: 'n_w', cycle: 1 });
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

test('GET /api/runs/:id/artifact: 415 for a binary kind, 413 above the cap, 200 otherwise', async () => {
  const png = await fetch(`${base}/api/runs/${id}/artifact${q('steps/n_x-c1/shot.png')}`);
  assert.equal(png.status, 415);
  assert.deepEqual(await png.json(), { error: 'binary artifact', rel: 'steps/n_x-c1/shot.png', bytes: 2 });
  const big = await fetch(`${base}/api/runs/${id}/artifact${q('steps/n_x-c1/big.txt')}`);
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { error: 'artifact too large to view', rel: 'steps/n_x-c1/big.txt', bytes: ARTIFACT_READ_MAX_BYTES + 1 });
  const ok = await fetch(`${base}/api/runs/${id}/artifact${q('steps/n_x-c1/ok.md')}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { rel: 'steps/n_x-c1/ok.md', text: '# ok\n' });
});

test('the History route and the workspace twin answer the same bodies', async () => {
  const hist = await fetch(`${base}/api/history/${key}/${id}/artifact${q('steps/n_x-c1/shot.png')}`);
  assert.equal(hist.status, 415);
  assert.deepEqual(await hist.json(), { error: 'binary artifact', rel: 'steps/n_x-c1/shot.png', bytes: 2 });
  const big = await fetch(`${base}/api/history/${key}/${id}/artifact${q('steps/n_x-c1/big.txt')}`);
  assert.equal(big.status, 413);
  const ws = await fetch(`${base}/api/workspaces/${WS_KEY}/runs/${wsId}/artifact${q('steps/n_w-c1/w.png')}`);
  assert.equal(ws.status, 415);
  assert.deepEqual(await ws.json(), { error: 'binary artifact', rel: 'steps/n_w-c1/w.png', bytes: 3 });
});

test('GET /api/runs/:id/artifacts reports truncation at the 200-row cap', async () => {
  const few = await (await fetch(`${base}/api/runs/${id}/artifacts`)).json();
  assert.equal(few.truncated, false);
  assert.ok(few.artifacts.some((a) => a.kind === 'image' && a.relPath === 'steps/n_x-c1/shot.png' && a.bytes === 2));
  const lots = await (await fetch(`${base}/api/runs/${many}/artifacts`)).json();
  assert.equal(lots.truncated, true);
  assert.equal(lots.artifacts.length, ASK_LIMITS.artifactsListMaxLimit);
});
