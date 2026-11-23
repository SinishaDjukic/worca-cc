// test/api-run-directions.test.mjs
// POST /api/runs/:id/directions appends a direction to the pipeline dir, indexes
// the inbox as an artifact, and validates the body. Bootstrap from
// test/api-run-artifact.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { listArtifacts } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let homeDir, srv, base, prevHome, proj, id, dir;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-dirapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-dirapi-proj-'));
  // `paused`, not `done`: a direction is read by the NEXT step, and a terminal
  // run has none — the route now refuses those with a 409. Paused is the real
  // case for the non-live path (resume replays directions.ndjson).
  ({ id, dir } = await seedPipeline(proj, { title: 'A', status: 'paused' }));
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
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

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

test('POST appends a direction and answers 201 {id}; the file is indexed as an artifact', async () => {
  const r = await post(`/api/runs/${id}/directions`, { text: 'cut the roadmap section' });
  assert.equal(r.status, 201);
  const body = JSON.parse(r.text);
  assert.match(body.id, /^d[a-z0-9]+$/);
  const lines = (await readFile(join(dir, 'directions.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((l) => [l.id, l.source, l.text]), [[body.id, 'ui', 'cut the roadmap section']]);
  assert.ok((await listArtifacts(id)).some((a) => a.kind === 'directions' && a.relPath === 'directions.ndjson'));
});

test('validation: missing / whitespace-only text 400, wrong type 400, unknown run 404, oversize 400', async () => {
  await checkRows([
    { name: 'validation: missing text 400, wrong type 400, unknown run 404, oversize 400', run: async () => {
      assert.deepEqual(JSON.parse((await post(`/api/runs/${id}/directions`, {})).text), { error: 'text is required' });
      assert.deepEqual(JSON.parse((await post(`/api/runs/${id}/directions`, { text: 5 })).text), { error: 'text must be a string' });
      assert.equal((await post(`/api/runs/00000000/directions`, { text: 'x' })).status, 404);
      assert.equal((await post(`/api/runs/${id}/directions`, { text: 'x'.repeat(4001) })).status, 400);
    } },
    { name: 'validation: whitespace-only text is a 400, not a 500', run: async () => {
      // Whitespace-only text reached appendDirection, which throws EMPTY_DIRECTION and
      // landed in the route's generic catch as a 500. It is a bad request.
      const res = await post(`/api/runs/${id}/directions`, { text: '   \n\t ' });
      assert.equal(res.status, 400, res.text);
      assert.match(res.text, /text is required/);
    } },
  ]);
});

// A direction is read by the NEXT step. A finished run has none, so accepting
// one answered 201 for work nobody would ever read — and `state.directions` was
// already computed at done, so it did not even surface as pending.
test('a direction for a finished run is refused, not silently accepted', async () => {
  const { id: done } = await seedPipeline(proj, { title: 'Done', status: 'done' });
  const res = await post(`/api/runs/${done}/directions`, { text: 'cut the roadmap slide' });
  assert.equal(res.status, 409, res.text);
  assert.match(res.text, /never be read/);
});

// A finished run stays parked in the runs Map, so liveRunEntry still returns an
// orchestrator for it — and the live branch ran BEFORE the closed check, making
// that check dead code for every run still in the Map. This drives the route
// with a live entry present for a done row.
test('a finished run is refused even while its orchestrator is still parked', async () => {
  const { id: done } = await seedPipeline(proj, { title: 'Parked', status: 'done' });
  const srvMod = await import('../ui/server.mjs');
  const entry = { id: done, pipelineId: done, status: 'done', orch: { direct: async () => ({ id: 'dSHOULD_NOT' }) } };
  const runs = srvMod.runs || srvMod._runsForTests;
  if (runs && typeof runs.set === 'function') runs.set(done, entry);

  const res = await post(`/api/runs/${done}/directions`, { text: 'cut the roadmap slide' });
  assert.equal(res.status, 409, res.text);
  assert.doesNotMatch(res.text, /dSHOULD_NOT/, 'the parked orchestrator was never asked');
});

// The non-live branch appended the direction and indexed the file, but wrote no
// audit line and emitted nothing — so a direction posted to a paused run with no
// live orchestrator (any server restart) showed up in History as
// `direction:applied` after the resume with no record of it ever having been
// posted. That is exactly the gap RunHarness.direct falls back to appendAudit to
// close on the live side; this route is the other half of the same story.
test('a direction posted with no live orchestrator still leaves a durable record', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  const r = await post(`/api/runs/${id}/directions`, { text: 'trim the closing slide' });
  assert.equal(r.status, 201, r.text);
  const { id: did } = JSON.parse(r.text);

  const events = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?')
    .all(id).map((e) => e.text || '').join('\n');
  assert.match(events, new RegExp(did), `the posting is recorded:\n${events}`);
  assert.match(events, /trim the closing slide/, 'with what was asked for');
});
