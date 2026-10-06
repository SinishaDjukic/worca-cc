// test/pr-api-workspace.test.mjs
// The PR routes' workspace arm: a `workspaces/<wks-…>` store key plus a `memberKey`
// selects ONE member repo; the member's PR is recorded per member (the row keeps the
// rollup); POST /api/pr/crosslink lists each sibling in every open member PR's body.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { readMemberPrStates, readPrState, persistMemberPrState } from '../src/core/artifacts.mjs';
import { readPrRemotePrefs } from '../src/core/config.mjs';
import { seedWorkspacePipeline, seedPipeline } from './helpers/db-seed.mjs';
import { projectKey } from '../src/core/store.mjs';

const WK = 'wks-team-a-00000001';
const KEY = `workspaces/${WK}`;
let srv, base, home, prevHome, runId, apiDir, webDir;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-wspr-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  apiDir = await mkdtemp(join(tmpdir(), 'worca-cc-wspr-api-'));
  webDir = await mkdtemp(join(tmpdir(), 'worca-cc-wspr-web-'));
  const members = [
    { projectKey: 'api-00000001', projectDir: apiDir, projectName: 'api' },
    { projectKey: 'web-00000002', projectDir: webDir, projectName: 'web' },
  ];
  const branches = {
    'api-00000001': { source: 'main', feature: 'worca-cc/feat-api', branchKept: true },
    'web-00000002': { source: 'dev', feature: 'worca-cc/feat-web', branchKept: true },
  };
  ({ id: runId } = await seedWorkspacePipeline(apiDir, WK, {
    title: 'Cross repo', status: 'done', workspaceName: 'Team A',
    projects: members, projectKeys: members.map((m) => m.projectKey), branches, branch: { ...branches['api-00000001'] },
  }, members));
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
beforeEach(() => gitInfo.reset());

const json = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const REMOTES_V = 'origin\thttps://github.com/o/REPO.git (fetch)\norigin\thttps://github.com/o/REPO.git (push)\n';

// Every call lands in `seen` WITH its cwd, so tests prove which repo each step ran in.
function stubWs(seen, { failPushIn = null, bodies = {} } = {}) {
  gitInfo.setRunner((cmd, args, opts = {}) => {
    seen.push({ argv: [cmd, ...args], cwd: opts.cwd });
    const ok = (stdout = '') => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    const repo = opts.cwd === webDir ? 'web' : 'api';
    if (cmd === 'gh' && args[0] === '--version') return ok('gh 2');
    if (cmd === 'git' && args[0] === 'remote') return ok(REMOTES_V.replaceAll('REPO', repo));
    if (cmd === 'git' && args[0] === 'for-each-ref') return ok(`refs/remotes/origin/main\nrefs/remotes/origin/dev\n`);
    if (cmd === 'git' && args[0] === 'push') {
      return opts.cwd === failPushIn ? Promise.resolve({ ok: false, stdout: '', stderr: 'denied', code: 1 }) : ok();
    }
    if (cmd === 'gh' && args[1] === 'create') return ok(`https://github.com/o/${repo}/pull/${repo === 'web' ? 2 : 1}\n`);
    if (cmd === 'gh' && args[1] === 'view' && args.includes('body')) return ok(`${bodies[args[2]] ?? 'Cross repo'}\n`);
    if (cmd === 'gh' && args[1] === 'view') return ok('MERGEABLE\n');
    if (cmd === 'gh' && args[1] === 'edit') return ok();
    return ok();
  });
}

test('POST /api/pr on a workspace run without memberKey -> 400 (never the primary by accident)', async () => {
  const seen = []; stubWs(seen);
  const r = await json('/api/pr', { projectKey: KEY, id: runId });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /memberKey is required/);
  assert.equal(seen.filter((c) => c.argv[1] === 'push').length, 0);
});

test('the primary member project key cannot reach a workspace run without memberKey either', async () => {
  const seen = []; stubWs(seen);
  // seedWorkspacePipeline stamps project_key = projectKey(apiDir) (db-seed.mjs:69,81), so
  // lookupPipelineRow('<that key>', runId) DOES resolve the workspace row (the trap) —
  // and the arm must refuse it for want of a memberKey, not 404 before reaching it.
  const r = await json('/api/pr', { projectKey: projectKey(apiDir), id: runId });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /memberKey is required/);
  assert.equal(seen.filter((c) => c.argv[1] === 'push').length, 0);
});

test('unknown memberKey -> 400', async () => {
  const seen = []; stubWs(seen);
  assert.equal((await json('/api/pr', { projectKey: KEY, id: runId, memberKey: 'zzz-00000009' })).status, 400);
});

test('POST /api/pr with memberKey pushes + opens in THAT member repo, records it per member, audits it', async () => {
  const seen = []; stubWs(seen);
  const r = await json('/api/pr', { projectKey: KEY, id: runId, memberKey: 'web-00000002' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { ok: true, url: 'https://github.com/o/web/pull/2', mergeable: 'MERGEABLE', existed: false, memberKey: 'web-00000002' });
  const push = seen.find((c) => c.argv[1] === 'push');
  assert.deepEqual(push.argv, ['git', 'push', '-u', 'origin', 'worca-cc/feat-web']);
  assert.equal(push.cwd, webDir);
  const create = seen.find((c) => c.argv[2] === 'create');
  assert.equal(create.cwd, webDir);
  assert.deepEqual(create.argv.slice(create.argv.indexOf('--base'), create.argv.indexOf('--base') + 4),
    ['--base', 'dev', '--head', 'worca-cc/feat-web']);
  assert.equal(readMemberPrStates(runId)['web-00000002'].url, 'https://github.com/o/web/pull/2');
  assert.equal(readPrState(runId).url, 'https://github.com/o/web/pull/2', 'the row carries the rollup');
  assert.deepEqual(readPrRemotePrefs(webDir), { pushRemote: 'origin', baseRemote: 'origin' }, 'prefs per member repo');
  const lines = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(runId).map((x) => x.text);
  // `( by <name>)?`: byActor(actorOf(req)) is '' for 'local', but a developer env with
  // WORCA_IDENTITY_NAME set (identity.mjs:33) yields " by <name>".
  assert.ok(lines.some((t) => /^Pull request opened in `web`( by [^:]+)?: https:\/\/github\.com\/o\/web\/pull\/2$/.test(t)));
});

test('partial failure: one member fails, the other succeeds, the failed one is retryable alone', async () => {
  const seen = []; stubWs(seen, { failPushIn: apiDir });
  const bad = await json('/api/pr', { projectKey: KEY, id: runId, memberKey: 'api-00000001' });
  assert.equal(bad.status, 500);
  assert.match((await bad.json()).error, /git push failed: denied/);
  assert.equal(readMemberPrStates(runId)['api-00000001'], undefined, 'nothing recorded for the failed member');
  assert.ok(readMemberPrStates(runId)['web-00000002'], 'the earlier PR is untouched (no rollback)');
  const seen2 = []; stubWs(seen2);
  const retry = await json('/api/pr', { projectKey: KEY, id: runId, memberKey: 'api-00000001' });
  assert.equal(retry.status, 200);
  assert.equal(seen2.filter((c) => c.argv[1] === 'push').length, 1, 'only the retried member is pushed');
});

test('GET /api/pr/remotes with memberKey lists THAT member repo, chain = its source', async () => {
  const seen = []; stubWs(seen);
  const q = new URLSearchParams({ projectKey: KEY, id: runId, memberKey: 'web-00000002' });
  const g = await (await fetch(`${base}/api/pr/remotes?${q}`)).json();
  assert.equal(g.remotes[0].slug, 'o/web');
  assert.deepEqual(g.chain, ['dev']);
  assert.equal(g.defaultBase, 'dev');
  assert.ok(seen.every((c) => c.cwd === webDir || c.argv[0] === 'gh'));
  const noMember = await fetch(`${base}/api/pr/remotes?${new URLSearchParams({ projectKey: KEY, id: runId })}`);
  assert.equal(noMember.status, 400);
});

test('POST /api/pr/mergeable per member uses that member PR url; no memberKey -> UNKNOWN', async () => {
  persistMemberPrState(runId, 'web-00000002', { url: 'https://github.com/o/web/pull/2', number: 2, state: 'OPEN' });
  const seen = []; stubWs(seen);
  const r = await (await json('/api/pr/mergeable', { projectKey: KEY, id: runId, memberKey: 'web-00000002' })).json();
  assert.equal(r.mergeable, 'MERGEABLE');
  assert.ok(seen.some((c) => c.argv[2] === 'view' && c.argv[3] === 'https://github.com/o/web/pull/2'));
  const u = await (await json('/api/pr/mergeable', { projectKey: KEY, id: runId })).json();
  assert.equal(u.mergeable, 'UNKNOWN');
});

test('POST /api/pr/crosslink edits every OPEN member PR to list its siblings, idempotently', async () => {
  persistMemberPrState(runId, 'api-00000001', { url: 'https://github.com/o/api/pull/1', number: 1, state: 'OPEN' });
  persistMemberPrState(runId, 'web-00000002', { url: 'https://github.com/o/web/pull/2', number: 2, state: 'OPEN' });
  const seen = []; stubWs(seen);
  const r = await (await json('/api/pr/crosslink', { projectKey: KEY, id: runId })).json();
  assert.deepEqual(r, { ok: true, edited: ['api-00000001', 'web-00000002'], failed: [] });
  const edits = seen.filter((c) => c.argv[2] === 'edit');
  const apiBody = edits.find((c) => c.argv[3] === 'https://github.com/o/api/pull/1').argv.at(-1);
  assert.match(apiBody, /^Cross repo\n\n<!-- worca:related-prs -->/);
  assert.match(apiBody, /- web: https:\/\/github\.com\/o\/web\/pull\/2/);
  assert.doesNotMatch(apiBody, /o\/api\/pull\/1/, 'never lists itself');
  // Rerun with the bodies GitHub now holds -> no edit (idempotent).
  const bodies = Object.fromEntries(edits.map((c) => [c.argv[3], c.argv.at(-1)]));
  const seen2 = []; stubWs(seen2, { bodies });
  const again = await (await json('/api/pr/crosslink', { projectKey: KEY, id: runId })).json();
  assert.deepEqual(again.edited, []);
  assert.equal(seen2.filter((c) => c.argv[2] === 'edit').length, 0);
});

test('crosslink refuses a single-project run; single-project /api/pr shape is unchanged', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'worca-cc-wspr-single-'));
  const s = await seedPipeline(repo, { title: 'One', status: 'done', branch: { source: 'main', feature: 'f-one' } });
  const seen = []; stubWs(seen);
  assert.equal((await json('/api/pr/crosslink', { projectKey: s.key, id: s.id })).status, 400);
  const j = await (await json('/api/pr', { projectKey: s.key, id: s.id, memberKey: 'ignored' })).json();
  assert.deepEqual(Object.keys(j).sort(), ['existed', 'mergeable', 'ok', 'url']);
});
