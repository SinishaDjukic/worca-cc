// test/pr-api.test.mjs
// Phase 3.7 — the server's POST /api/pr + /api/runs routes read the DB: the
// pipeline's branch + projectDir come back through rowToState (branch JSON column;
// projectDir from the project's store_meta path). Fixtures seed pipelines rows via
// the production writers (seedPipeline -> createPipeline + writeState) + store_meta
// (writeStoreMeta) instead of state.json/meta.json. The projectKey/id the POST body
// carries are content-derived/minted (A15(3)) — use the RETURNED key/id (module vars).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { projectKey } from '../src/core/store.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let srv, base, home, prevHome, betaKey, betaId, betaRepo;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-pr-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests(); // open the DB under this temp home
  // Seed via the production writer; createPipeline's ensureMeta writes the store_meta
  // (path = the repo dir) the PR route reads for projectDir. Pin name to 'Beta'.
  betaRepo = await mkdtemp(join(tmpdir(), 'worca-cc-pr-repo-'));
  const seeded = await seedPipeline(betaRepo, { title: 'My feature', status: 'stopped',
    startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/my-feature-pp', branchKept: true, commit: 'abc' } });
  betaId = seeded.id; betaKey = seeded.key;
  writeStoreMeta(betaKey, 'project', { key: betaKey, name: 'Beta', path: betaRepo });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => gitInfo.reset());

const post = (body) => fetch(`${base}/api/pr`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /api/pr -> 400 when id is missing', async () => {
  assert.equal((await post({ projectKey: betaKey })).status, 400);
});

test('POST /api/pr -> 409 when gh is unavailable', async () => {
  gitInfo.setRunner((cmd) => Promise.resolve(
    cmd === 'gh' ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
                 : { ok: true, stdout: '', stderr: '', code: 0 }));
  assert.equal((await post({ projectKey: betaKey, id: betaId })).status, 409);
});

test('POST /api/pr pushes, creates the PR, returns url + mergeable', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'push') return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create')
      return Promise.resolve({ ok: true, stdout: 'https://github.com/x/y/pull/7\n', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
      return Promise.resolve({ ok: true, stdout: 'MERGEABLE\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const r = await post({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.url, 'https://github.com/x/y/pull/7');
  assert.equal(j.mergeable, 'MERGEABLE');
  assert.ok(seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'branch was pushed');
  assert.ok(seen.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create'), 'PR was created');
});

test('GET /api/history exposes ghAvailable', async () => {
  gitInfo.setRunner((cmd, args) =>
    Promise.resolve(cmd === 'gh' && args[0] === '--version'
      ? { ok: true, stdout: 'gh 2.x', stderr: '', code: 0 }
      : { ok: true, stdout: '', stderr: '', code: 0 }));
  const j = await (await fetch(`${base}/api/history`)).json();
  assert.equal(j.ghAvailable, true);
});

test('GET /api/history is PR-light: no inline pr even when an OPEN PR exists', async () => {
  // The live PR state now rides the WS (POST /api/history/pr -> history-pr events),
  // so the machine-wide skeleton must NOT attach pr inline or spend `gh pr list`.
  let prListCalled = false;
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      prListCalled = true;
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number: 4, state: 'OPEN', url: 'https://gh/b/pull/4' }]), stderr: '', code: 0 });
    }
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const j = await (await fetch(`${base}/api/history`)).json();
  const row = j.pipelines.find((p) => p.id === betaId);
  assert.equal('pr' in row, false, 'history skeleton omits inline pr');
  assert.equal(prListCalled, false, 'GET /api/history does not run `gh pr list`');
});

test('GET /api/runs?projectDir still returns inline pr (per-project withPr unchanged)', async () => {
  // Only /api/history went two-phase; the per-project /api/runs arm KEEPS withPr:true
  // and must still attach pr inline. Seed under the real projectKey so the lookup hits.
  const repoDir = await mkdtemp(join(tmpdir(), 'worca-cc-runs-repo-'));
  const key = projectKey(repoDir);
  const { id: rpId } = await seedPipeline(repoDir, { title: 'Runs feat', status: 'stopped',
    startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/runs-rp', branchKept: true } });
  writeStoreMeta(key, 'project', { key, name: 'RunsRepo', path: repoDir });
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list')
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number: 9, state: 'OPEN', url: 'https://gh/r/pull/9' }]), stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const j = await (await fetch(`${base}/api/runs?projectDir=${encodeURIComponent(repoDir)}`)).json();
  const row = j.pipelines.find((p) => p.id === rpId);
  assert.deepEqual(row.pr, { state: 'OPEN', url: 'https://gh/r/pull/9', number: 9 });
});

test('POST /api/pr/mergeable re-reads mergeability via gh pr view (no push/create)', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
      return Promise.resolve({ ok: true, stdout: 'CONFLICTING\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const r = await fetch(`${base}/api/pr/mergeable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey: betaKey, id: betaId }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mergeable, 'CONFLICTING');
  assert.ok(seen.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'view'), 'mergeability was re-read');
  assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'no push on a re-check');
  assert.ok(!seen.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create'), 'no PR create on a re-check');
});

test('POST /api/pr/mergeable -> UNKNOWN (best-effort) when gh is unavailable', async () => {
  gitInfo.setRunner((cmd) => Promise.resolve(
    cmd === 'gh' ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
                 : { ok: true, stdout: '', stderr: '', code: 0 }));
  const r = await fetch(`${base}/api/pr/mergeable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey: betaKey, id: betaId }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mergeable, 'UNKNOWN');
});

test('POST /api/pr/mergeable requires id -> 400 (the one hard error)', async () => {
  const r = await fetch(`${base}/api/pr/mergeable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey: betaKey }),   // no id
  });
  assert.equal(r.status, 400);
});
