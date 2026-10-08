// Base conflicts (#620): the History list carries a short summary of each run's stored base check (no file
// list; the detail view has it). A workspace row reports its worst member at the top and each member's own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { writeStoreMeta, baseCheckSummary, baseCheckSummaryFor } from '../src/core/artifacts.mjs';
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
  srv = http.createServer(app);
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
