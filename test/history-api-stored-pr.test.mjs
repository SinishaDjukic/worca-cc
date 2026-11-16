// test/history-api-stored-pr.test.mjs
// PLAN-Ga: GET /api/history's PR-light skeleton carries the STORED PR facts under a new
// key, `storedPr: { url, number, state }` (rows and workspace members), so first paint
// knows a recorded PR before the `history-pr` batch lands. `pr` stays absent (classic
// reads `pr === undefined` as "lookup pending"), no gh runs, and core callers that do
// not opt in (CLI `runs --json`, chat history) see rows without the key.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { listAllPipelines, persistMemberPrState, persistPrState, writeStoreMeta } from '../src/core/artifacts.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

let home, prevHome, srv, base, key, prId, plainId, archivedId, wsId;
const PR = { url: 'https://github.com/o/a/pull/7', number: 7, state: 'MERGED' };
const ARCH_PR = { url: 'https://github.com/o/a/pull/5', number: 5, state: 'OPEN' };
const WEB_PR = { url: 'https://github.com/o/web/pull/8', number: 8, state: 'OPEN' };
const WK = 'wks-stored-00000001';
const M = [
  { projectKey: 'api-00000001', projectDir: '/r/api', projectName: 'api' },
  { projectKey: 'web-00000002', projectDir: '/r/web', projectName: 'web' },
];
let cmds = [];

// Records every git/gh command; answers git with harmless output and gh with "absent".
function stub() {
  cmds = [];
  gitInfo.setRunner((cmd, args) => {
    cmds.push([cmd, ...args]);
    if (cmd === 'gh') return Promise.resolve({ ok: false, stdout: '', stderr: 'not found', code: 127 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

beforeEach(() => { gitInfo.reset(); stub(); });

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-storedpr-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-storedpr-proj-'));
  const at = (d) => ({ status: 'done', startedAt: d, updatedAt: d });
  const a = await seedPipeline(proj, { title: 'With PR', ...at('2026-06-03T00:00:00Z') });
  const b = await seedPipeline(proj, { title: 'No PR', ...at('2026-06-02T00:00:00Z') });
  const c = await seedPipeline(proj, { title: 'Archived PR', ...at('2026-06-01T00:00:00Z') });
  key = a.key; prId = a.id; plainId = b.id; archivedId = c.id;
  writeStoreMeta(key, 'project', { key, name: 'Alpha', path: proj });
  persistPrState(prId, PR);
  persistPrState(archivedId, ARCH_PR);
  getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run('2026-06-04T00:00:00Z', archivedId);
  const primary = await mkdtemp(join(tmpdir(), 'worca-cc-storedpr-ws-'));
  const ws = await seedWorkspacePipeline(primary, WK, {
    title: 'WS', status: 'done', workspaceName: 'Team', projects: M, projectKeys: M.map((m) => m.projectKey),
    branches: { 'api-00000001': { source: 'main', feature: 'f-api' }, 'web-00000002': { source: 'main', feature: 'f-web' } },
    branch: { source: 'main', feature: 'f-api' },
  }, M);
  wsId = ws.id;
  persistMemberPrState(wsId, 'web-00000002', WEB_PR);
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset(); _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

const list = async (q = '') => (await (await fetch(`${base}/api/history${q}`)).json()).pipelines;

test('PLAN-Ga: GET /api/history carries the stored PR under storedPr and leaves pr absent', async () => {
  const row = (await list()).find((p) => p.id === prId);
  assert.ok(row, 'the list holds the run');
  assert.deepEqual(row.storedPr, PR);
  assert.equal('pr' in row, false, 'the skeleton keeps pr absent (pending)');
});

test('PLAN-Ga: ?row=1 and ?archived=1 carry storedPr too', async () => {
  const el = (await list()).find((p) => p.id === prId);
  const r = await fetch(`${base}/api/history/${key}/${prId}?row=1`);
  assert.equal(r.status, 200);
  const { pipeline } = await r.json();
  assert.deepEqual(pipeline, el);
  assert.deepEqual(pipeline.storedPr, PR);
  const arch = (await list('?archived=1')).find((p) => p.id === archivedId);
  assert.ok(arch, 'the archived feed holds the run');
  assert.deepEqual(arch.storedPr, ARCH_PR);
  assert.equal('pr' in arch, false);
});

test('PLAN-Ga: workspace members carry their stored PR from pipeline_member_prs', async () => {
  const row = (await list()).find((p) => p.id === wsId);
  assert.ok(row, 'the list holds the workspace run');
  const by = Object.fromEntries(row.members.map((m) => [m.memberKey, m]));
  assert.deepEqual(by['web-00000002'].storedPr, WEB_PR);
  assert.equal('storedPr' in by['api-00000001'], false, 'a member without a stored PR has no key');
  for (const m of row.members) assert.equal('pr' in m, false, 'members keep pr absent');
  assert.deepEqual(row.storedPr, WEB_PR, 'the row-level key is the stored rollup');
});

test('PLAN-Ga: a row with no stored PR has no key, gh never runs', async () => {
  const row = (await list()).find((p) => p.id === plainId);
  assert.ok(row, 'the list holds the run');
  assert.equal('storedPr' in row, false);
  assert.equal('pr' in row, false);
  await list('?archived=1');
  await fetch(`${base}/api/history/${key}/${plainId}?row=1`);
  assert.deepEqual(cmds.filter((c) => c[0] === 'gh' && c[1] !== '--version'), [], 'no gh PR call');
});

test('PLAN-Ga: listAllPipelines() without the option carries no storedPr (CLI and chat unchanged)', async () => {
  for (const opts of [{}, { lite: true }]) {
    const rows = await listAllPipelines(opts);
    assert.ok(rows.some((p) => p.id === prId));
    for (const p of rows) {
      assert.equal('storedPr' in p, false, `no storedPr with ${JSON.stringify(opts)}`);
      for (const m of p.members || []) assert.equal('storedPr' in m, false);
    }
  }
});
