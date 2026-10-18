// test/publish-api.test.mjs
// Publish branch (#618): POST /api/runs/:id/publish pushes a finished run's feature branch
// (git push -u) and opens no PR; GET reports each member's published state from refs only.
// The remote checks are POST /api/pr's own (unknown remote 400, Azure fork 422). Git runs
// through the git-info runner seam against a tiny fake ref table that a push updates.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, readPrState, findPipelineRowById } from '../src/core/artifacts.mjs';
import { readPrRemotePrefs, setPrRemotePrefs } from '../src/core/config.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { withEnv } from './helpers/with-env.mjs';

const WITH_ADO = { WORCA_ADO_TOKEN: 'pat', WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
const FEATURE = 'worca-cc/my-feature-pp';
const WK = 'wks-pub-a-00000001';
const WS_KEY = `workspaces/${WK}`;

let srv, base, home, prevHome, repo, key, id, runningId, apiDir, webDir, wsId;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-pub-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-pub-repo-'));
  const seeded = await seedPipeline(repo, { title: 'My feature', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: FEATURE, branchKept: true } });
  id = seeded.id; key = seeded.key;
  writeStoreMeta(key, 'project', { key, name: 'Beta', path: repo });
  ({ id: runningId } = await seedPipeline(repo, { title: 'Still going', status: 'running', startedAt: '2026-06-02T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/still-going', branchKept: true } }));
  apiDir = await mkdtemp(join(tmpdir(), 'worca-cc-pub-api-'));
  webDir = await mkdtemp(join(tmpdir(), 'worca-cc-pub-web-'));
  const members = [
    { projectKey: 'api-00000001', projectDir: apiDir, projectName: 'api' },
    { projectKey: 'web-00000002', projectDir: webDir, projectName: 'web' },
  ];
  const branches = {
    'api-00000001': { source: 'main', feature: 'worca-cc/feat-api', branchKept: true },
    'web-00000002': { source: 'dev', feature: 'worca-cc/feat-web', branchKept: true },
  };
  ({ id: wsId } = await seedWorkspacePipeline(apiDir, WK, {
    title: 'Cross repo', status: 'done', workspaceName: 'Team A',
    projects: members, projectKeys: members.map((m) => m.projectKey), branches, branch: { ...branches['api-00000001'] },
  }, members));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset(); gitSync.reset(); _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  gitInfo.reset(); gitSync.reset();
  // Each test starts unpublished: no recorded push, no remembered remotes, no audit lines.
  getDb().prepare('DELETE FROM pipeline_events').run();
  getDb().prepare('DELETE FROM project_config').run();
  for (const rid of [id, wsId]) {
    const row = findPipelineRowById(rid);
    if (row.branch) {
      const br = JSON.parse(row.branch); delete br.published;
      getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(br), rid);
    }
    if (row.workspace_meta) {
      const wm = JSON.parse(row.workspace_meta);
      for (const b of Object.values(wm.branches || {})) delete b.published;
      getDb().prepare('UPDATE pipelines SET workspace_meta = ? WHERE id = ?').run(JSON.stringify(wm), rid);
    }
  }
});

const GH_REMOTES_V = [
  'origin\thttps://github.com/me/repo.git (fetch)', 'origin\thttps://github.com/me/repo.git (push)',
  'upstream\tgit@github.com:up/repo.git (fetch)', 'upstream\tgit@github.com:up/repo.git (push)',
].join('\n') + '\n';

/**
 * A fake repo per cwd: `refs` maps a full ref name to its sha; `git push -u <r> <b>` copies
 * refs/heads/<b> to refs/remotes/<r>/<b>. Every call lands in `seen` with its cwd.
 */
function stubRepo(seen, { remotesV = GH_REMOTES_V, refs = {}, failPush = false, getUrl = null, counts = null } = {}) {
  const table = (cwd) => (refs[cwd] ||= {});
  gitInfo.setRunner((cmd, args, opts = {}) => {
    seen.push({ argv: [cmd, ...args], cwd: opts.cwd });
    const done = (stdout = '') => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh') return Promise.resolve({ ok: false, stdout: '', stderr: 'gh must not run for Publish', code: 1 });
    if (args[0] === 'remote' && args[1] === 'get-url') return done(`${getUrl ? getUrl(args[args.length - 1]) : ''}\n`);
    if (args[0] === 'remote') return done(remotesV);
    if (args[0] === 'for-each-ref') {
      const t = table(opts.cwd);
      const pats = args.slice(2);
      const hit = (ref) => pats.some((p) => (p.includes('*')
        ? new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '[^/]+')}$`).test(ref)
        : ref === p || ref.startsWith(`${p}/`)));
      const out = Object.keys(t).sort().filter(hit)
        .map((ref) => (args[1].includes('objectname') ? `${ref} ${t[ref]}` : ref));
      return done(out.length ? `${out.join('\n')}\n` : '');
    }
    // `counts` maps 'remoteSha...localSha' to rev-list's "<only remote>\t<only local>" answer.
    if (args[0] === 'rev-list' && counts) return done(`${counts[args[args.length - 1]] ?? ''}\n`);
    if (args[0] === 'push') {
      if (failPush) return Promise.resolve({ ok: false, stdout: '', stderr: '! [rejected] (non-fast-forward)', code: 1 });
      const [remote, branch] = args.slice(-2);
      const t = table(opts.cwd);
      t[`refs/remotes/${remote}/${branch}`] = t[`refs/heads/${branch}`];
      return done();
    }
    return done();
  });
}

const publish = (rid, body) => fetch(`${base}/api/runs/${encodeURIComponent(rid)}/publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const status = (rid, q) => fetch(`${base}/api/runs/${encodeURIComponent(rid)}/publish?${new URLSearchParams(q)}`);
const pushes = (seen) => seen.filter((s) => s.argv[0] === 'git' && s.argv[1] === 'push');
const audit = (rid) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY ts').all(rid).map((r) => r.text);

test('POST publish pushes the branch with -u, opens no PR, records the remote and writes an audit line', async () => {
  const seen = [];
  stubRepo(seen, { refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa' } } });
  const r = await publish(id, { projectKey: key, pushRemote: 'origin' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j, { ok: true, remote: 'origin', branch: FEATURE, sha: 'aaa', upToDate: false });
  assert.deepEqual(pushes(seen).map((s) => s.argv), [['git', 'push', '-u', 'origin', FEATURE]]);
  assert.equal(pushes(seen)[0].cwd, repo);
  assert.ok(!seen.some((s) => s.argv[0] === 'gh'), 'no PR tooling ran');
  assert.equal(readPrState(id), null, 'no PR recorded');
  const br = JSON.parse(findPipelineRowById(id).branch);
  assert.equal(br.published.remote, 'origin');
  assert.equal(br.published.sha, 'aaa');
  assert.ok(br.published.at);
  assert.deepEqual(audit(id).filter((t) => /published/.test(t)).length, 1);
  assert.match(audit(id).find((t) => /published/.test(t)), /^Branch `worca-cc\/my-feature-pp` published to `origin`( by [^.]+)?\.$/);
  assert.deepEqual(readPrRemotePrefs(repo), { pushRemote: 'origin', baseRemote: 'upstream' }, 'the dialog choice is remembered');
});

test('GET publish: unpublished -> published -> moved (Push changes) -> published again, from refs only', async () => {
  const seen = [];
  const refs = { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa' } };
  stubRepo(seen, { refs });
  const read = async () => { const r = await status(id, { projectKey: key }); assert.equal(r.status, 200); return (await r.json()).members; };
  let [m] = await read();
  assert.deepEqual(m, { memberKey: null, name: null, branch: FEATURE, remote: null, state: 'unpublished', published: null });
  await publish(id, { projectKey: key });
  [m] = await read();
  assert.equal(m.state, 'published');
  assert.equal(m.remote, 'origin');
  assert.equal(m.published.sha, 'aaa');
  refs[repo][`refs/heads/${FEATURE}`] = 'bbb';          // a local fix during testing
  [m] = await read();
  assert.equal(m.state, 'moved');
  const again = await (await publish(id, { projectKey: key })).json();
  assert.equal(again.sha, 'bbb');
  assert.match(audit(id).at(-1), /^Pushed changes to `origin\/worca-cc\/my-feature-pp`/);
  [m] = await read();
  assert.equal(m.state, 'published');
  assert.ok(!seen.some((s) => s.argv[1] === 'push' && s.argv.includes('--force')), 'never forces');
});

test('GET publish: Push changes only when local is strictly ahead; a remote ahead or diverged offers no push', async () => {
  const refs = { [repo]: { [`refs/heads/${FEATURE}`]: 'loc', [`refs/remotes/origin/${FEATURE}`]: 'rem' } };
  const counts = {};
  stubRepo([], { refs, counts });
  const read = async () => (await (await status(id, { projectKey: key })).json()).members[0];
  counts['rem...loc'] = '0\t2';                          // local commits not on the remote
  assert.equal((await read()).state, 'moved');
  counts['rem...loc'] = '3\t0';                          // the PR's Update branch, a collaborator push: nothing to push
  let m = await read();
  assert.equal(m.state, 'published');
  assert.equal(m.remote, 'origin');
  counts['rem...loc'] = '1\t2';                          // both sides moved: a push would be refused
  m = await read();
  assert.equal(m.state, 'diverged');
  assert.equal(m.remote, 'origin');
});

test('GET publish falls back to branchPushedTo: a branch Ship it already pushed reads as published', async () => {
  stubRepo([], { refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa', [`refs/remotes/fork/${FEATURE}`]: 'aaa' } } });
  const [m] = (await (await status(id, { projectKey: key })).json()).members;
  assert.equal(m.state, 'published');
  assert.equal(m.remote, 'fork');
  assert.equal(m.published, null);
});

test('POST publish when nothing moved is a no-op push: upToDate, no second audit line', async () => {
  const seen = [];
  stubRepo(seen, { refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa', [`refs/remotes/origin/${FEATURE}`]: 'aaa' } } });
  const j = await (await publish(id, { projectKey: key, pushRemote: 'origin' })).json();
  assert.equal(j.upToDate, true);
  assert.equal(pushes(seen).length, 1, 'git push still runs (it is idempotent)');
  assert.equal(audit(id).length, 0);
});

test('POST publish validates remotes exactly like POST /api/pr: unknown remote 400, git failure 500, nothing pushed', async () => {
  const seen = [];
  stubRepo(seen, { refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa' } } });
  let r = await publish(id, { projectKey: key, pushRemote: 'evil; rm -rf /' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /unknown push remote/);
  assert.equal((await publish(id, { projectKey: key, baseRemote: 42 })).status, 400);
  gitInfo.setRunner((cmd, args) => {
    seen.push({ argv: [cmd, ...args] });
    return Promise.resolve(args[0] === 'remote' ? { ok: false, stdout: '', stderr: 'fatal: not a git repository', code: 128 }
      : { ok: true, stdout: '', stderr: '', code: 0 });
  });
  r = await publish(id, { projectKey: key, pushRemote: 'origin' });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /git remote failed/);
  assert.equal(pushes(seen).length, 0, 'nothing was pushed');
});

test('POST publish refuses an Azure fork with 422 before anything is pushed, like POST /api/pr', () => withEnv(WITH_ADO, async () => {
  const seen = [];
  const AZ = 'https://dev.azure.com/acme/Shop/_git/api';
  const FORK = 'https://dev.azure.com/acme/Shop/_git/api-fork';
  stubRepo(seen, { remotesV: `fork\t${FORK} (fetch)\nfork\t${FORK} (push)\norigin\t${AZ} (fetch)\norigin\t${AZ} (push)\n`,
    getUrl: (name) => (name === 'fork' ? FORK : AZ), refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa' } } });
  const r = await publish(id, { projectKey: key, pushRemote: 'fork', baseRemote: 'origin' });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.equal(j.kind, 'unsupported');
  assert.match(j.error, /forks\) are not supported yet — push to origin/);
  assert.equal(pushes(seen).length, 0, 'nothing was pushed');
}));

test('POST publish error paths: 404 unknown run, 409 for a run still in progress, 409 when the branch is gone, 500 on a failed push', async () => {
  const seen = [];
  stubRepo(seen, { refs: { [repo]: {} } });
  assert.equal((await publish('nope', { projectKey: key })).status, 404);
  assert.equal((await publish(id, {})).status, 400, 'projectKey or projectDir is required');
  let r = await publish(runningId, { projectKey: key });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /once the run has finished/);
  r = await publish(id, { projectKey: key });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /no longer in the repository/);
  assert.equal(pushes(seen).length, 0);
  stubRepo(seen, { refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa' } }, failPush: true });
  r = await publish(id, { projectKey: key });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /^git push failed: .*non-fast-forward/);
  assert.equal(JSON.parse(findPipelineRowById(id).branch).published, undefined, 'nothing recorded');
  assert.equal(audit(id).length, 0);
});

test('workspace: POST publish pushes the named member in its own repo; GET lists every member', async () => {
  const seen = [];
  stubRepo(seen, { remotesV: 'origin\thttps://github.com/o/r.git (fetch)\norigin\thttps://github.com/o/r.git (push)\n',
    refs: { [apiDir]: { 'refs/heads/worca-cc/feat-api': 'a1' }, [webDir]: { 'refs/heads/worca-cc/feat-web': 'w1' } } });
  let r = await publish(wsId, { projectKey: WS_KEY });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /memberKey is required/);
  r = await publish(wsId, { projectKey: WS_KEY, memberKey: 'web-00000002' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).memberKey, 'web-00000002');
  assert.equal(pushes(seen).length, 1);
  assert.equal(pushes(seen)[0].cwd, webDir);
  assert.match(audit(wsId).at(-1), /^Branch `worca-cc\/feat-web` published to `origin` in `web`/);
  const wm = JSON.parse(findPipelineRowById(wsId).workspace_meta);
  assert.equal(wm.branches['web-00000002'].published.remote, 'origin');
  assert.equal(wm.branches['api-00000001'].published, undefined);
  const members = (await (await status(wsId, { projectKey: WS_KEY })).json()).members;
  assert.deepEqual(members.map((m) => [m.memberKey, m.name, m.branch, m.state]), [
    ['api-00000001', 'api', 'worca-cc/feat-api', 'unpublished'],
    ['web-00000002', 'web', 'worca-cc/feat-web', 'published'],
  ]);
});

test('POST publish follows the remembered push remote when the body names none', async () => {
  const seen = [];
  stubRepo(seen, { refs: { [repo]: { [`refs/heads/${FEATURE}`]: 'aaa' } } });
  await setPrRemotePrefs(repo, { pushRemote: 'upstream', baseRemote: 'upstream' });
  const j = await (await publish(id, { projectKey: key })).json();
  assert.equal(j.remote, 'upstream');
  assert.deepEqual(pushes(seen)[0].argv, ['git', 'push', '-u', 'upstream', FEATURE]);
});
