// test/member-prs.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { persistMemberPrState, readMemberPrStates, readPrState } from '../src/core/artifacts.mjs';
import { getStats } from '../src/core/stats.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { refreshFinalPrs } from '../src/core/pipeline-delete.mjs';

let home, prevHome, runId;
const MEMBERS = [
  { projectKey: 'api-00000001', projectDir: '/r/api', projectName: 'api' },
  { projectKey: 'web-00000002', projectDir: '/r/web', projectName: 'web' },
];

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-mpr-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  const primary = await mkdtemp(join(tmpdir(), 'worca-cc-mpr-prim-'));
  ({ id: runId } = await seedWorkspacePipeline(primary, 'wks-team-00000001', {
    title: 'WS', status: 'done', startedAt: new Date().toISOString(),
    projects: MEMBERS, projectKeys: MEMBERS.map((m) => m.projectKey),
    branches: { 'api-00000001': { source: 'main', feature: 'f-api' }, 'web-00000002': { source: 'main', feature: 'f-web' } },
  }, MEMBERS));
});
after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

test('member PRs persist per member and roll up onto the pipelines row', () => {
  persistMemberPrState(runId, 'web-00000002', { url: 'https://github.com/o/web/pull/2', number: 2, state: 'OPEN' });
  assert.deepEqual(readMemberPrStates(runId), { 'web-00000002': { url: 'https://github.com/o/web/pull/2', number: 2, state: 'OPEN' } });
  assert.deepEqual(readPrState(runId), { url: 'https://github.com/o/web/pull/2', number: 2, state: 'OPEN' });

  persistMemberPrState(runId, 'api-00000001', { url: 'https://github.com/o/api/pull/5', number: 5, state: 'MERGED' });
  assert.deepEqual(readPrState(runId), { url: 'https://github.com/o/api/pull/5', number: 5, state: 'MERGED' },
    'MERGED as soon as any member PR is');
  assert.equal(Object.keys(readMemberPrStates(runId)).length, 2);
});

test('stats count the workspace run once (opened + merged)', () => {
  const t = getStats({ range: 'all' }).totals;
  assert.equal(t.prsOpened, 1);
  assert.equal(t.prsMerged, 1);
});

test('bad input is a no-op; deleting the run cascades', () => {
  persistMemberPrState(runId, '', { url: 'x' });
  persistMemberPrState(runId, 'api-00000001', { url: '' });
  assert.equal(Object.keys(readMemberPrStates(runId)).length, 2);
  getDb().exec('PRAGMA foreign_keys = ON');
  getDb().prepare('DELETE FROM pipelines WHERE id = ?').run(runId);
  assert.deepEqual(readMemberPrStates(runId), {});
});

test('archive refresh: a workspace run is observed per member, the rollup follows', async () => {
  const primary = await mkdtemp(join(tmpdir(), 'worca-cc-mpr-arch-'));
  const { id } = await seedWorkspacePipeline(primary, 'wks-arch-00000002', {
    title: 'Arch', status: 'done', projects: MEMBERS, projectKeys: MEMBERS.map((m) => m.projectKey),
    branches: { 'api-00000001': { source: 'main', feature: 'f-api' }, 'web-00000002': { source: 'main', feature: 'f-web' } },
    branch: { source: 'main', feature: 'f-api' },
  }, MEMBERS);
  gitInfo.setRunner((cmd, args, opts = {}) => {
    const ok = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return ok('gh 2');
    if (cmd === 'gh' && args[1] === 'list') {
      return ok(opts.cwd === '/r/web' ? '[{"number":6,"state":"OPEN","url":"https://github.com/o/web/pull/6"}]' : '[]');
    }
    return ok('');
  });
  const state = {
    id, target: 'workspace', projectDir: '/r/api', branch: { source: 'main', feature: 'f-api' },
    projects: MEMBERS, branches: { 'api-00000001': { source: 'main', feature: 'f-api' }, 'web-00000002': { source: 'main', feature: 'f-web' } },
  };
  await refreshFinalPrs({ id, pr_url: null }, state);
  gitInfo.reset();
  assert.deepEqual(Object.keys(readMemberPrStates(id)), ['web-00000002'], 'recorded against web, not the primary');
  assert.equal(readPrState(id).url, 'https://github.com/o/web/pull/6');
});
