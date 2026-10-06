// test/history-workspace-members.test.mjs
// A workspace History row carries per-member { affected, survived, pr } so the UI can
// decide eligibility across ALL members (the primary-only survived/branch trap).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { listAllPipelines, enrichPipelinesPr, persistMemberPrState, readMemberPrStates } from '../src/core/artifacts.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';

let home, prevHome, runId, runDir;
const WK = 'wks-team-00000001';
const M = [
  { projectKey: 'api-00000001', projectDir: '/r/api', projectName: 'api' },   // primary: NO changes (frozen)
  { projectKey: 'web-00000002', projectDir: '/r/web', projectName: 'web' },   // frozen: changed
  { projectKey: 'doc-00000003', projectDir: '/r/doc', projectName: 'doc' },   // not in results.json -> live rev-list
];
const BR = { 'api-00000001': { source: 'main', feature: 'f-api' }, 'web-00000002': { source: 'main', feature: 'f-web' },
  'doc-00000003': { source: 'main', feature: 'f-doc' } };

function stub({ ahead = '2' } = {}) {
  gitInfo.setRunner((cmd, args, opts = {}) => {
    const ok = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return ok('gh 2');
    if (cmd === 'git' && args[0] === 'rev-parse') return ok('abc\n');                 // every branch exists
    if (cmd === 'git' && args[0] === 'rev-list') return ok(opts.cwd === '/r/doc' ? `${ahead}\n` : '0\n');
    if (cmd === 'git' && args[0] === 'diff') return ok(' 1 file changed, 4 insertions(+), 1 deletion(-)\n');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list')
      return ok(opts.cwd === '/r/web' ? '[{"number":8,"state":"OPEN","url":"https://github.com/o/web/pull/8"}]' : '[]');
    return ok('');
  });
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  const primary = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-prim-'));
  const seeded = await seedWorkspacePipeline(primary, WK, {
    title: 'WS', status: 'done', workspaceName: 'Team', projects: M, projectKeys: M.map((m) => m.projectKey), branches: BR,
    branch: { ...BR['api-00000001'] },
  }, M);
  runId = seeded.id; runDir = seeded.dir;
  const sum = (n) => ({ summary: { filesNew: 0, filesChanged: n, filesDeleted: 0, linesAdded: n * 3, linesRemoved: n } });
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ summary: { filesNew: 0, filesChanged: 2, linesAdded: 6, linesRemoved: 2 },
    perProject: { 'api-00000001': sum(0), 'web-00000002': sum(2) } }));
});
after(async () => {
  gitInfo.reset(); _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(() => gitInfo.reset());

test('members: frozen results win, live rev-list fills the gaps; primary-only facts are not the verdict', async () => {
  stub();
  const row = (await listAllPipelines()).find((p) => p.id === runId);
  const by = Object.fromEntries(row.members.map((m) => [m.memberKey, m]));
  assert.deepEqual(Object.keys(by), ['api-00000001', 'web-00000002', 'doc-00000003']);
  assert.equal(by['api-00000001'].affected, false);
  assert.equal(by['web-00000002'].affected, true);
  assert.equal(by['web-00000002'].diffFrozen, true);
  assert.equal(by['web-00000002'].added, 6);
  assert.equal(by['doc-00000003'].affected, true, 'live: 2 commits ahead');
  assert.equal(by['doc-00000003'].diffFrozen, false);
  assert.equal(by['doc-00000003'].added, 4);
  assert.equal(by['web-00000002'].branch, 'f-web');
  assert.equal(by['web-00000002'].name, 'web');
  assert.equal('pr' in by['web-00000002'], false, 'no withPr -> pr stays undefined (pending)');
});

test('lite rows carry no members (no git)', async () => {
  stub();
  const row = (await listAllPipelines({ lite: true })).find((p) => p.id === runId);
  assert.equal(row.members, undefined);
});

test('enrichPipelinesPr resolves + persists per member and sends a rollup', async () => {
  stub();
  const batches = [];
  await enrichPipelinesPr(async (items, done) => { batches.push({ items, done }); });
  const it = batches.flatMap((b) => b.items).find((x) => x.id === runId);
  assert.deepEqual(it.pr, { state: 'OPEN', url: 'https://github.com/o/web/pull/8', number: 8 });
  assert.deepEqual(it.members.find((m) => m.memberKey === 'web-00000002').pr, { state: 'OPEN', url: 'https://github.com/o/web/pull/8', number: 8 });
  assert.equal(it.members.find((m) => m.memberKey === 'api-00000001').pr, null);
  assert.deepEqual(readMemberPrStates(runId)['web-00000002'].url, 'https://github.com/o/web/pull/8');
  assert.equal(batches.at(-1).done, true);
});

test('a persisted member pr_url is used (repo-agnostic view) for that member', async () => {
  persistMemberPrState(runId, 'doc-00000003', { url: 'https://github.com/o/doc/pull/3', number: 3, state: 'OPEN' });
  // `gh pr view <url>` answers BY URL (args[2]) — web's persisted pull/8 must not come
  // back as doc's PR (v2 review m8).
  const VIEW = {
    'https://github.com/o/doc/pull/3': '{"number":3,"state":"MERGED","url":"https://github.com/o/doc/pull/3"}',
    'https://github.com/o/web/pull/8': '{"number":8,"state":"OPEN","url":"https://github.com/o/web/pull/8"}',
  };
  const seen = [];
  gitInfo.setRunner((cmd, args, opts = {}) => {
    seen.push([cmd, ...args, opts.cwd]);
    const ok = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return ok('gh');
    if (cmd === 'git' && args[0] === 'rev-parse') return ok('abc\n');
    if (cmd === 'gh' && args[1] === 'view') {
      return VIEW[args[2]] ? ok(VIEW[args[2]]) : Promise.resolve({ ok: false, stdout: '', stderr: 'not found', code: 1 });
    }
    return ok('[]');
  });
  await enrichPipelinesPr(async () => {});
  assert.ok(seen.some((c) => c[1] === 'pr' && c[2] === 'view' && c[3] === 'https://github.com/o/doc/pull/3' && c.at(-1) === '/r/doc'));
  const prs = readMemberPrStates(runId);
  assert.equal(prs['doc-00000003'].state, 'MERGED');
  assert.equal(prs['web-00000002'].url, 'https://github.com/o/web/pull/8', 'web keeps its own PR');
  assert.equal(prs['web-00000002'].state, 'OPEN');
});

test('a legacy workspace row (no workspace_meta.projects) keeps its primary-only pr and gets members: []', async () => {
  const primary = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-legacy-'));
  // The 4th argument feeds the workspace STORE META (projectPaths[0] = primary = the row's
  // repoDir). `state` carries no `projects`, so workspace_meta.projects stays [] — the
  // pre-member-facts shape (see the grounding table's seedWorkspacePipeline note).
  const legacy = await seedWorkspacePipeline(primary, 'wks-old-00000009', {
    title: 'Old WS', status: 'done', branch: { source: 'main', feature: 'f-old' },
  }, [{ projectKey: 'old-00000009', projectDir: primary, projectName: 'old' }]);
  gitInfo.setRunner((cmd, args) => {
    const ok = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return ok('gh 2');
    if (cmd === 'git' && args[0] === 'rev-parse') return ok('abc\n');
    if (cmd === 'gh' && args[1] === 'list' && args.includes('f-old')) {
      return ok('[{"number":4,"state":"MERGED","url":"https://github.com/o/old/pull/4"}]');
    }
    return ok(args[1] === 'list' ? '[]' : '');
  });
  const row = (await listAllPipelines({ withPr: true })).find((p) => p.id === legacy.id);
  assert.deepEqual(row.members, []);
  assert.deepEqual(row.pr, { number: 4, state: 'MERGED', url: 'https://github.com/o/old/pull/4' },
    'no members -> the primary-only lookup stands (never overwritten with a null rollup)');
});
