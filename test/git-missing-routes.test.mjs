// test/git-missing-routes.test.mjs — with git missing: every GIT_ONLY_ROUTES entry, the run start, resume, the
// branch terminal and the workspace refusal answer 409 GIT_MISSING; every table entry shadows a real route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';
import { seedBuiltinMarketplace, refreshAllMarketplaces } from '../src/core/marketplaces.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { readPluginsLock, writePluginsLock } from '../src/core/plugins-lock.mjs';

ghTesting.setFetch(async () => { throw new TypeError('fetch failed'); });

const BODY = { error: 'git is not installed on this machine', code: 'GIT_MISSING' };
let home, app, srv, base, prev, T, addProject, runs;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-p0-routes-'));
  prev = {}; for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  (await import('../src/core/db.mjs'))._resetForTests();
  ({ addProject } = await import('../src/core/projects.mjs'));
  const mod = await import('../ui/server.mjs'); app = mod.app; srv = mod.server; T = mod._testing; runs = mod.runs;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  cap.reset(); ghTesting.reset(); srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const send = (method, path, body = {}) => fetch(`${base}${path}`, { method: method.toUpperCase(),
  headers: { 'content-type': 'application/json' }, ...(method === 'get' ? {} : { body: JSON.stringify(body) }) });
const fill = (route) => route.replace(':key', 'p0proj-00000001').replace(':id', 'deadbeef').replace(':actionId', 'dev').replace(':name', 'p0plugin');
// The table entries that belong to the U2a features: checked in their own row below (S5).
const U2A_TABLE = new Set(['post /api/plugins/install', 'post /api/plugins/:name/update', 'post /api/projects/:key/team-metrics/enable',
  'post /api/team-metrics/flush', 'post /api/team-metrics/discover', 'put /api/policy', 'post /api/policy/discover',
  'post /api/projects/:key/policy/enable', 'post /api/workspaces/metrics-scan', 'post /api/workspaces/:id/metrics-route',
  'post /api/workspaces/:id/policy-route']);

test('routes while git is missing', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'every table entry shadows a real handler (no typo can hide a route)', run: () => {
      const layers = app._router.stack.filter((l) => l.route);
      for (const [m, p] of T.GIT_ONLY_ROUTES) assert.ok(layers.filter((l) => l.route.path === p && l.route.methods[m]).length >= 2, `${m} ${p}`);
    } },
    { name: 'every non-U2a table entry: 409 GIT_MISSING', run: async () => {
      for (const [m, p] of T.GIT_ONLY_ROUTES.filter(([m, p]) => !U2A_TABLE.has(`${m} ${p}`))) {
        const r = await send(m, fill(p));
        assert.equal(r.status, 409, `${m} ${p}`); assert.deepEqual(await r.json(), BODY, `${m} ${p}`);
      }
    } },
    { name: 'U2a routes: sources off GitHub still 409 without git', run: async () => {
      const off = 'https://gitlab.com/acme/plugins';
      writePluginsLock({ ...readPluginsLock(), p0plugin: { repo: off, subdir: '', pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled: true } });
      const team = await mkdtemp(join(home, 'worca-p0-team-'));   // under the file's root: removed in after()
      await mkdir(join(team, '.git'));
      await writeFile(join(team, '.git', 'config'), '[remote "origin"]\n\turl = https://gitlab.com/acme/team.git\n');
      const key = (await addProject({ name: 'p0gl', path: team })).find((x) => x.name === 'p0gl').key;
      for (const [m, p, body] of [
        ['post', '/api/marketplaces', { url: off }],
        ['post', '/api/plugins/install', { repoUrl: off, name: 'p0other', sha: 'a'.repeat(40) }], ['post', '/api/plugins/p0plugin/update', { confirm: true, sha: 'b'.repeat(40) }],
        ['post', '/api/skills/import/preview', { source: { kind: 'git', url: 'https://gitlab.com/acme/skills' } }],
        ['post', `/api/projects/${key}/team-metrics/enable`, {}], ['post', `/api/projects/${key}/policy/enable`, {}],
      ]) {
        const r = await send(m, p, body);
        assert.equal(r.status, 409, `${m} ${p}`); assert.deepEqual(await r.json(), BODY, `${m} ${p}`);
      }
    } },
    { name: 'U2a routes that are no longer git-only answer their own code, never GIT_MISSING', run: async () => {
      seedBuiltinMarketplace();
      const [market] = await refreshAllMarketplaces();
      for (const [m, p, body, status, error] of [   // error: the start of the answer's error, null = none
        ['post', `/api/marketplaces/${market.id}/refresh`, {}, 200, null],
        ['post', '/api/team-metrics/flush', {}, 200, null], ['post', '/api/team-metrics/discover', {}, 200, null],
        ['put', '/api/policy', {}, 400, 'scope must be project:'], ['post', '/api/policy/discover', {}, 200, null],
        ['post', '/api/workspaces/metrics-scan', { projectPaths: ['/x'] }, 400, 'member path is missing: /x'],
        ['post', '/api/workspaces/ws-p0/metrics-route', {}, 404, 'workspace not found'], ['post', '/api/workspaces/ws-p0/policy-route', {}, 404, 'workspace not found'],
      ]) {
        const r = await send(m, p, body);
        const j = await r.json();
        assert.deepEqual([r.status, error == null ? j.error ?? null : String(j.error).slice(0, error.length)], [status, error], `${m} ${p}`);
      }
    } },
    { name: 'POST /api/run (a project runs on a copy), a workspace start, resume, the branch terminal, a workspace with an unregistered member', run: async () => {
      const dir = gitDir('p0-run');
      const r = await send('post', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
      assert.equal(r.status, 200);                                            // P1: unregistered + git missing → a Folder run
      const { runId } = await r.json();
      assert.equal(runs.get(runId).orch.workMode, 'folder');
      assert.equal((await send('post', '/api/stop', { runId })).status, 200); await runs.get(runId).launch;
      const ws = await send('post', '/api/run', { workspaceId: 'wks-none-0000000b', prompt: 'x', mock: true });
      assert.equal(ws.status, 404); assert.deepEqual(await ws.json(), { error: 'workspace not found' });   // P5: a workspace start needs no git
      const { id: paused } = await seedPipeline(dir, { status: 'paused' });   // a git run: refused before (P0) and after (P1 S3) the row read
      await assert.rejects(T.resumeRun(paused, { mock: true }), (e) => e.status === 409 && e.body.code === 'GIT_MISSING');
      const rows = await addProject({ name: 'p0term', path: dir });
      const key = rows.find((p) => p.name === 'p0term').key;
      const term = await send('post', `/api/projects/${key}/terminal`, { branch: 'main' });
      assert.equal(term.status, 409); assert.deepEqual(await term.json(), BODY);
      const loose = gitDir('p0-run2');                                        // P5: dir (registered p0term) is accepted
      const w = await send('post', '/api/workspaces', { name: 'W', projectPaths: [dir, loose] });
      assert.equal(w.status, 400); assert.deepEqual(await w.json(), { error: `member path is not a registered project: ${loose}` });
    } },
    { name: 'dev #717 / workspace import: a marketplace export answers 409 and no marketplace is a publish target; a plugin export still runs', run: async () => {
      const r = await send('post', '/api/workflows/wf_default/export', { destination: 'marketplace', marketplaceId: 'acme-plugins-00000001', dryRun: true });
      assert.equal(r.status, 409); assert.deepEqual(await r.json(), BODY);
      seedBuiltinMarketplace();
      const t = await (await send('get', '/api/marketplaces/publish-targets')).json();
      assert.deepEqual(t.targets, []);
      assert.ok(t.skipped.length > 0, 'the built-in marketplace is listed');
      for (const s of t.skipped) assert.equal(s.reason, 'needs git', s.id);
      const plugin = await send('post', '/api/workflows/wf_default/export', { destination: 'plugin' });
      assert.deepEqual([plugin.status, (await plugin.json()).error], [400, 'pluginDir is required for a plugin export']);
      const imp = await send('post', '/api/workspaces/import-candidates', { paths: [home] });
      assert.equal(imp.status, 409); assert.deepEqual(await imp.json(), BODY);
    } },
    { name: 'an Ask clone card: startCloneJob refuses git-missing before any job exists', run: async () => {
      await assert.rejects(T.startCloneJob({ url: 'https://github.com/acme/api', branch: null, name: null }),
        { code: 'git-missing', message: 'git is not installed on this machine' });
      assert.equal(T.CLONE_JOBS.size, 0);
    } },
    { name: 'Add members to a workspace made while git was there: an unregistered repo is refused as not registered (400)', run: async () => {
      gitArrives();
      const made = await send('post', '/api/workspaces', { name: 'WM', projectPaths: [gitDir('p0-mem1'), gitDir('p0-mem2')] });
      assert.equal(made.status, 201);
      const { workspace } = await made.json();
      withNoGit();
      const loose = gitDir('p0-mem3');
      const r = await send('post', `/api/workspaces/${workspace.id}/members`, { add: [loose] });
      assert.equal(r.status, 400); assert.deepEqual(await r.json(), { error: `member path is not a registered project: ${loose}` });
    } },
    { name: 'git on: the table lets requests through (a sync POST answers its own 4xx, not GIT_MISSING)', run: async () => {
      gitArrives();
      const r = await send('post', '/api/sync', {});
      assert.notEqual((await r.json()).code, 'GIT_MISSING');
    } },
  ]);
});

// The table-driven rows iterate GIT_ONLY_ROUTES itself, so a dropped entry passes them. Pinned here: the entries no later
// plan removes (P5 drops the two scan entries, P6 the nine team and two plugin entries — this row survives both).
test('the git-only table keeps every route whose whole purpose is git', async () => {
  await checkRows([
    { name: 'GIT_ONLY_ROUTES holds the 23 non-U2a, non-scan entries', run: () => {
      const have = new Set(T.GIT_ONLY_ROUTES.map(([m, p]) => `${m} ${p}`));
      for (const r of ['post /api/projects/clone', 'delete /api/projects/:key/terminal/worktrees',
        'post /api/runs/:id/checkout', 'delete /api/runs/:id/checkout', 'get /api/runs/:id/checkout/diff',
        'post /api/projects/:key/actions/:actionId/try',
        'get /api/pr/remotes', 'post /api/pr', 'post /api/pr/resolve', 'post /api/runs/:id/publish',
        'post /api/push', 'post /api/shape/features/:id/ship',
        'post /api/sync', 'post /api/projects/:key/sync', 'post /api/sync/all', 'post /api/workspaces/:id/sync',
        'post /api/runs/:id/base-check', 'post /api/runs/:id/update-branch',
        'post /api/runs/:id/resolve-pipeline', 'post /api/runs/:id/resolve-terminal',
        'post /api/runs/:id/apply-retained', 'post /api/runs/:id/discard-worktree',
        'post /api/workspaces/import-candidates']) assert.ok(have.has(r), r);
    } },
  ]);
});

test('a chained schedule ticket while git is missing', async (t) => {
  withNoGit(t);
  const made = [];
  t.after(() => Promise.all(made.map((d) => rm(d, { recursive: true, force: true }))));
  await checkRows([
    { name: 'sourceFromPrevious: refused GIT_MISSING, never a stored "branch … no longer exists" (a failed git answer is no fact)', run: async () => {
      const dir = gitDir('p0-chain'); made.push(dir);
      const { id } = await seedPipeline(dir, { status: 'done', branch: { source: 'main', feature: 'worca/p0-chain' } });
      const out = await T.fireTicket({ after: { kind: 'pipeline', id }, sourceFromPrevious: true, projectDir: dir,
        request: { projectDir: dir, prompt: 'x', mock: true } });
      assert.deepEqual(out, { ok: false, error: 'git is not installed on this machine', transient: false });
    } },
  ]);
});

// test/git-missing-routes.test.mjs — new test (v3). Uses the file's T, withNoGit, seedPipeline, mkdtemp, rm, tmpdir, join.
test('P1 (S3): with git missing a paused Folder run is not refused for git; its deleted copy answers 400', async (t) => {
  withNoGit(t);
  const dir = await mkdtemp(join(tmpdir(), 'worca-p1-folder-resume-'));
  try {
    const gone = join(dir, 'gone');
    const { id } = await seedPipeline(dir, { status: 'paused', branch: { workMode: 'folder', runRootMode: 'detached', copyDir: gone }, resumePoint: { version: 2 } });
    await assert.rejects(T.resumeRun(id, { mock: true }), (e) => e.status === 400 && e.body.error === `copy missing: ${gone}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
