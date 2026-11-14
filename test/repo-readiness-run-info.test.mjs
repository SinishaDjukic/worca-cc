// test/repo-readiness-run-info.test.mjs — projectHasCode and readinessRunInfo (check + setup runs, workspace-aware live guard).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectHasCode } from '../src/core/repo-readiness/has-code.mjs';
import { readinessRunInfo, READINESS_CHECK_WORKFLOW_ID, READINESS_SETUP_WORKFLOW_ID } from '../src/core/repo-readiness/projects.mjs';
import { MANIFESTS, HEAVY_DIRS } from '../src/core/repo-readiness/facts.mjs';
import { writeProjectProfileRaw } from '../src/core/config.mjs';

useTempHome(after);
delete process.env.WORCA_READINESS;
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'rri-')); dirs.push(d);
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), c); }
  return d;
};
const FLOWS = async () => [{ id: READINESS_CHECK_WORKFLOW_ID }, { id: READINESS_SETUP_WORKFLOW_ID }];
const base = { mock: false, hasCode: () => true, listWorkflows: FLOWS };
const proj = { key: 'pk-aaaaaaaa', path: '/x/a' };

const insert = (id, { key = 'pk-aaaaaaaa', ws = null, keys = [], status = 'running', wf = READINESS_SETUP_WORKFLOW_ID, at = '2026-11-13T10:00:00Z' } = {}) =>
  getDb().prepare(`INSERT INTO pipelines (id, project_key, workspace_key, target, status, started_at, workspace_meta, run_setup)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, key, ws, ws ? 'workspace' : 'project', status, at,
    ws ? JSON.stringify({ workspaceId: ws, projectKeys: keys }) : null, JSON.stringify({ workflowId: wf }));

test('projectHasCode is false for a README-only repo and true with a package.json or one src/*.js', () => {
  assert.equal(projectHasCode(tmp({ 'README.md': '# hi', 'docs/a.md': 'x' })), false);
  assert.equal(projectHasCode(tmp({ 'package.json': '{}' })), true);
  assert.equal(projectHasCode(tmp({ 'README.md': 'x', 'src/index.js': '1' })), true);
  assert.equal(projectHasCode('/no/such/dir'), false);
});

test('projectHasCode counts a static site, a Terraform repo, a notebook and other source kinds', () => {
  assert.equal(projectHasCode(tmp({ 'index.html': '<p>hi</p>', 'style.css': 'p{}' })), true, 'static site');
  assert.equal(projectHasCode(tmp({ 'main.tf': 'resource "x" "y" {}' })), true, 'Terraform');
  for (const f of ['a.scss', 'a.ipynb', 'a.ps1', 'a.pl', 'a.jl', 'a.groovy', 'a.fs', 'a.vue', 'a.svelte']) {
    assert.equal(projectHasCode(tmp({ 'README.md': 'x', [`src/${f}`]: '1' })), true, f);
  }
});

test('readinessRunInfo offers both kinds only when each workflow is installed and the project has code', async () => {
  assert.deepEqual((await readinessRunInfo(proj, { ...base, latestRuns: () => [] })).available, { check: true, setup: true });
  assert.deepEqual((await readinessRunInfo(proj, { ...base, listWorkflows: async () => [{ id: READINESS_CHECK_WORKFLOW_ID }], latestRuns: () => [] })).available, { check: true, setup: false });
  const none = await readinessRunInfo(proj, { ...base, hasCode: () => false, latestRuns: () => [] });
  assert.deepEqual(none.available, { check: false, setup: false });
  assert.equal(none.hasCode, false);
});

test('a live check run is the project\'s live run (setup is busy too)', async () => {
  getDb().prepare('DELETE FROM pipelines').run();
  insert('chk1', { wf: READINESS_CHECK_WORKFLOW_ID });
  const info = await readinessRunInfo(proj, base);
  assert.equal(info.live?.pipelineId, 'chk1');
  assert.equal(info.lastCheck?.pipelineId, 'chk1');
  assert.equal(info.lastSetup, null);
});

test('a live workspace setup run that includes a NON-primary member is that member\'s live run', async () => {
  getDb().prepare('DELETE FROM pipelines').run();
  insert('ws1', { key: 'primary-11111111', ws: 'ws-abc', keys: ['primary-11111111', 'pk-aaaaaaaa'] });
  const member = await readinessRunInfo(proj, base);
  assert.equal(member.live?.pipelineId, 'ws1');
  assert.equal(member.live.workspaceId, 'ws-abc');
  const stranger = await readinessRunInfo({ key: 'other-22222222', path: '/x/o' }, base);
  assert.equal(stranger.live, null);
  getDb().prepare("UPDATE pipelines SET status = 'done'").run();
  assert.equal((await readinessRunInfo(proj, base)).live, null);
});

test('lastCheck carries the profile score only when the profile was written by that run', async () => {
  getDb().prepare('DELETE FROM pipelines').run();
  insert('chk2', { wf: READINESS_CHECK_WORKFLOW_ID, status: 'done' });
  writeProjectProfileRaw('pk-aaaaaaaa', { version: 1, runId: 'chk2', score: { overall: 72 } });
  assert.equal((await readinessRunInfo(proj, base)).lastCheck.score, 72);
  writeProjectProfileRaw('pk-aaaaaaaa', { version: 1, runId: 'someone-else', score: { overall: 72 } });
  assert.equal((await readinessRunInfo(proj, base)).lastCheck.score, null);
});

test('projectHasCode: a symlinked source, a heavy dir, and a file three levels deep do not count; two levels deep does', () => {
  const link = tmp({ 'real.txt': 'x', 'README.md': 'x' });
  symlinkSync(join(link, 'real.txt'), join(link, 'a.js'));
  assert.equal(projectHasCode(link), false, 'symlink');
  assert.equal(projectHasCode(tmp({ [`${HEAVY_DIRS[0]}/x.js`]: '1' })), false, 'heavy dir');
  assert.equal(projectHasCode(tmp({ '.hidden/x.js': '1' })), false, 'dot folder');
  assert.equal(projectHasCode(tmp({ 'a/b/c/x.js': '1' })), false, 'three deep');
  assert.equal(projectHasCode(tmp({ 'a/b/x.js': '1' })), true, 'two deep');
});

test('projectHasCode: every facts.mjs manifest at the root counts, even in a large root', () => {
  for (const m of MANIFESTS) assert.equal(projectHasCode(tmp({ [m]: 'x' })), true, m);
  const big = tmp({ [MANIFESTS[0]]: 'x' });
  for (let i = 0; i < 2100; i++) writeFileSync(join(big, `f${String(i).padStart(4, '0')}.txt`), '');
  assert.equal(projectHasCode(big), true, 'manifest behind a big root');
});

test('latestRuns: a row with invalid workspace_meta neither throws nor matches', async () => {
  getDb().prepare('DELETE FROM pipelines').run();
  getDb().prepare(`INSERT INTO pipelines (id, project_key, workspace_key, target, status, started_at, workspace_meta, run_setup)
    VALUES ('bad1', 'primary-11111111', 'ws-bad', 'workspace', 'running', '2026-11-13T10:00:00Z', '{not json', ?)`).run(JSON.stringify({ workflowId: READINESS_SETUP_WORKFLOW_ID }));
  const info = await readinessRunInfo(proj, base);
  assert.equal(info.live, null);
  assert.equal(info.lastSetup, null);
});
