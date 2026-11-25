// Base conflicts (#620): the History list carries a short summary of each run's stored base check (no file
// list; the detail view has it). A workspace row reports its worst member at the top and each member's own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, baseCheckSummary, baseCheckSummaryFor, persistPrState, persistMemberPrState } from '../src/core/artifacts.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

let home, prevHome, srv, base, plainId, conflictId, wsId, dirs = [];
const CONFLICTS = { status: 'conflicts', base: 'dev', behind: 3, fileCount: 2, files: ['a', 'b'], at: 'T' };

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-hbc-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-hbc-proj-'));
  dirs.push(proj);
  const a = await seedPipeline(proj, { title: 'Conflicting', status: 'done', branch: { source: 'dev', feature: 'worca/x', baseCheck: CONFLICTS } });
  conflictId = a.id;
  writeStoreMeta(a.key, 'project', { key: a.key, name: 'p', path: proj });
  ({ id: plainId } = await seedPipeline(proj, { title: 'Unchecked', status: 'done', branch: { source: 'dev', feature: 'worca/y' } }));
  const apiDir = await mkdtemp(join(tmpdir(), 'worca-cc-hbc-api-'));
  const webDir = await mkdtemp(join(tmpdir(), 'worca-cc-hbc-web-'));
  dirs.push(apiDir, webDir);
  const projects = [
    { projectKey: 'api-00000001', projectDir: apiDir, projectName: 'api' },
    { projectKey: 'web-00000002', projectDir: webDir, projectName: 'web' },
  ];
  const branches = {
    'api-00000001': { source: 'dev', feature: 'worca/w', baseCheck: { status: 'clean', base: 'dev', behind: 1, fileCount: 0, at: 'T1' } },
    'web-00000002': { source: 'dev', feature: 'worca/w', baseCheck: { ...CONFLICTS, at: 'T2' } },
  };
  ({ id: wsId } = await seedWorkspacePipeline(apiDir, 'wks-hbc-00000001', { title: 'WS', status: 'done', projects,
    projectKeys: projects.map((p) => p.projectKey), branches, branch: { ...branches['api-00000001'] } }, projects));
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const d of [home, ...dirs]) await rm(d, { recursive: true, force: true });
});

test('baseCheckSummary drops the file list; baseCheckSummaryFor picks the worst member', () => {
  assert.deepEqual(baseCheckSummary(CONFLICTS), { status: 'conflicts', base: 'dev', behind: 3, fileCount: 2, kind: null, stale: false, at: 'T' });
  assert.equal(baseCheckSummary(null), null);
  assert.equal(baseCheckSummaryFor({ branch: JSON.stringify({ feature: 'x' }) }), null);
});

test('GET /api/history answers each row\'s base-check summary (null when never checked)', async () => {
  const r = await fetch(`${base}/api/history`);
  assert.equal(r.status, 200);
  const { pipelines } = await r.json();
  const byId = new Map(pipelines.map((p) => [p.id, p]));
  assert.deepEqual(byId.get(conflictId).baseCheck, { status: 'conflicts', base: 'dev', behind: 3, fileCount: 2, kind: null, stale: false, at: 'T' });
  assert.equal(byId.get(plainId).baseCheck, null);
  const ws = byId.get(wsId);
  assert.equal(ws.baseCheck.status, 'conflicts', 'the worst member');
  assert.equal(ws.baseCheck.at, 'T2');
  const mem = Object.fromEntries((ws.members || []).map((m) => [m.memberKey, m.baseCheck]));
  assert.equal(mem['api-00000001'].status, 'clean');
  assert.equal(mem['web-00000002'].status, 'conflicts');
  assert.equal(mem['web-00000002'].files, undefined);
});

test('a merged or closed PR is final: its branch has no row summary; a workspace row drops only that member', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-hbc-final-'));
  dirs.push(proj);
  const ids = {};
  for (const state of ['MERGED', 'CLOSED', 'OPEN']) {
    const s = await seedPipeline(proj, { title: state, status: 'done', branch: { source: 'dev', feature: `worca/${state}`, baseCheck: CONFLICTS } });
    writeStoreMeta(s.key, 'project', { key: s.key, name: 'p', path: proj });
    persistPrState(s.id, { url: `https://github.com/o/r/pull/${s.id.slice(-6)}`, number: 1, state });
    ids[state] = s.id;
  }
  persistMemberPrState(wsId, 'web-00000002', { url: 'https://github.com/o/web/pull/1', number: 1, state: 'MERGED' });
  try {
    const { pipelines } = await (await fetch(`${base}/api/history`)).json();
    const byId = new Map(pipelines.map((p) => [p.id, p]));
    assert.equal(byId.get(ids.MERGED).baseCheck, null);
    assert.equal(byId.get(ids.CLOSED).baseCheck, null);
    assert.equal(byId.get(ids.OPEN).baseCheck.status, 'conflicts', 'an open PR keeps its summary');
    assert.equal(byId.get(wsId).baseCheck.status, 'clean', 'the merged member is left out; the open one is the worst');
  } finally {
    getDb().prepare('DELETE FROM pipeline_member_prs WHERE pipeline_id = ?').run(wsId);
  }
});
