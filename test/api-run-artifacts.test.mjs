// test/api-run-artifacts.test.mjs
// The plural run-artifacts list route: GET /api/runs/:id/artifacts returns the
// run's indexed artifacts with step attribution + byte size. Server idiom mirrors
// test/api-run-artifact.test.mjs (WORCA_HOME set BEFORE importing ui/server.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let homeDir, srv, base, prevHome, proj, id, dir;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-run-artifacts-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-run-artifacts-proj-'));
  ({ id, dir } = await seedPipeline(proj, { title: 'A', status: 'done' }));
  await writeFile(join(dir, 'plan.md'), 'hi', 'utf8');
  recordArtifact(id, 'plan', 'plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
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

test('GET /api/runs/:id/artifacts lists attributed artifacts and an uncapped list reports truncated: false', async () => {
  const res = await fetch(`${base}/api/runs/${id}/artifacts`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.runId, id);
  assert.ok(Array.isArray(body.artifacts));
  const plan = body.artifacts.find((a) => a.relPath === 'plan.md');
  assert.ok(plan, 'plan.md artifact present');
  assert.equal(plan.stepKey, 'exec-1');
  assert.equal(plan.nodeId, 'planner');
  assert.equal(plan.cycle, 0);
  assert.equal(plan.bytes, 2);
  assert.equal(body.truncated, false, 'an uncapped list reports truncated: false');
});

test('GET /api/runs/:id/artifacts 404s an unknown run', async () => {
  const res = await fetch(`${base}/api/runs/00000000/artifacts`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'pipeline not found' });
});

// A three-deck or high-cycle presentation run indexes ~40 screenshots per audit
// cycle plus kit files and fonts, so it exceeds the 200-row cap. The cap itself
// is deliberate (each row costs a synchronous statSync), but the response said
// nothing about being short, and the History Artifacts tab rendered the partial
// list as if it were the run. `list_run_artifacts` already probes with limit + 1
// and reports `truncated`; this route must agree with it.
test('GET /api/runs/:id/artifacts flags a truncated list instead of silently cutting it', async () => {
  const { id: big } = await seedPipeline(proj, { title: 'Big', status: 'done' });
  for (let i = 0; i < 205; i++) {
    recordArtifact(big, 'deck-shot', `shots/s${String(i).padStart(3, '0')}.png`, { stepKey: 'x:n_audit:1', nodeId: 'n_audit', cycle: 1 });
  }
  const res = await fetch(`${base}/api/runs/${big}/artifacts`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.artifacts.length, 200, 'still capped at the shared ceiling');
  assert.equal(body.truncated, true, 'and it says so');
});

// The 200-row cap was applied BEFORE the client's display filter, and rows come
// back oldest-first — so on a deck run the budget was spent on the deck-asset
// rows and screenshots the viewer discards, and the rows actually cut were the
// NEWEST: deck.pdf, the closing review, the deliverables a human wants.
test('the row budget is spent on artifacts the viewer will actually show', async () => {
  const { id: big } = await seedPipeline(proj, { title: 'Deck', status: 'done' });
  // 250 hidden subresources first (oldest), then the deliverables.
  for (let i = 0; i < 250; i++) {
    recordArtifact(big, 'deck-asset', `deck/font-${String(i).padStart(3, '0')}.woff2`, { cycle: 1 });
  }
  for (const rel of ['deck/deck.pdf', 'deck/deck.standalone.html', 'deck-review-cycle2.md']) {
    recordArtifact(big, rel.endsWith('.md') ? 'deck-review' : 'deck', rel, { cycle: 2 });
  }

  const body = await (await fetch(`${base}/api/runs/${big}/artifacts`)).json();
  const rels = body.artifacts.map((a) => a.relPath);
  for (const rel of ['deck/deck.pdf', 'deck/deck.standalone.html', 'deck-review-cycle2.md']) {
    assert.ok(rels.includes(rel), `${rel} was cut by rows nobody sees (${body.artifacts.length} returned)`);
  }
});

// `truncated: true` told the caller the list was short without giving it any way
// to see the rest — and rows come back oldest-first, so what is missing is the
// NEWEST: on a presentation run, deck.pdf and the closing review. The History
// Artifacts tab rendered "Showing the first 200 — this run indexed more." with no
// control behind it, so the deliverables were unreachable from the UI while the
// Ask tool could already page to them. listRunArtifacts has supported offset since
// that tool got it; the route just never passed one through.
test('GET /api/runs/:id/artifacts pages past the cap with ?offset', async () => {
  const { id: big2 } = await seedPipeline(proj, { title: 'Big2', status: 'done' });
  for (let i = 0; i < 205; i++) {
    recordArtifact(big2, 'deck-shot', `p/s${String(i).padStart(3, '0')}.png`, { stepKey: 'x:n_audit:1', nodeId: 'n_audit', cycle: 1 });
  }
  const first = await (await fetch(`${base}/api/runs/${big2}/artifacts`)).json();
  assert.equal(first.truncated, true);
  assert.equal(first.nextOffset, 200, 'a truncated page says where the next one starts');

  // 205 screenshots + the prompt.md row seedPipeline indexes = 206 browsable rows.
  const next = await (await fetch(`${base}/api/runs/${big2}/artifacts?offset=${first.nextOffset}`)).json();
  assert.equal(first.artifacts.length, 200, 'the first page is a full page');
  assert.equal(next.artifacts.length, 6, 'the remaining rows');
  assert.equal(next.truncated, false, 'the last page is not truncated');
  assert.equal(next.nextOffset, undefined, 'and carries no cursor');

  const seen = new Set([...first.artifacts, ...next.artifacts].map((a) => a.relPath));
  assert.equal(seen.size, 206, 'the two pages cover every row, with no overlap');
});

test('GET /api/runs/:id/artifacts clamps a junk or absurd offset instead of 500ing', async () => {
  await checkRows([
    { name: 'GET /api/runs/:id/artifacts rejects a junk offset rather than 500ing', run: async () => {
      const res = await fetch(`${base}/api/runs/${id}/artifacts?offset=-5`);
      assert.equal(res.status, 200, 'a bad offset is clamped, not fatal');
      const body = await res.json();
      assert.ok(body.artifacts.find((a) => a.relPath === 'plan.md'), 'and still lists from the start');
    } },
    { name: 'GET /api/runs/:id/artifacts survives an absurd offset instead of 500ing', run: async () => {
      // Number.isInteger(1e20) is TRUE, but node:sqlite refuses to bind a non-safe
      // integer — so the offset sailed past the route's `Number.isFinite && > 0` guard
      // and through listRunArtifacts' `Number.isInteger` check into the statement,
      // where it threw `datatype mismatch` and the route's catch turned it into a 500.
      // The ask-tool twin is safe because clampInt caps at MAX_SAFE_INTEGER; this route
      // had no cap.
      for (const bad of ['1e20', '9007199254740992', '99999999999999999999']) {
        const res = await fetch(`${base}/api/runs/${id}/artifacts?offset=${bad}`);
        assert.equal(res.status, 200, `offset=${bad} must not be a server error`);
        const body = await res.json();
        assert.deepEqual(body.artifacts, [], 'an offset past the end is simply an empty page');
      }
    } },
  ]);
});
