// test/requirements-git-missing.test.mjs — Requirements with git missing (upstream's P0 contract, as
// test/git-missing-routes.test.mjs checks it for its own routes): the product brief's Create / Refresh and Look closer /
// Look again (REQUIREMENTS_GIT_ROUTES, gated in the router after the flag) answer 409 GIT_MISSING with upstream's body,
// and the flag's 404 while it is off; creating a feature still works and its automatic
// look is skipped as "no git" (no checkout, no call); with git back the routes reach their handlers again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';

const BODY = { error: 'git is not installed on this machine', code: 'GIT_MISSING' };
const GIT_ONLY = ['POST /api/requirements/brief/:scopeType/:scopeKey', 'POST /api/requirements/:seq/look'];
let home, app, srv, base, prev, T, projKey;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-req-nogit-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';            // never a model call; the git check comes before the mock look
  process.env.WORCA_FLAGS = 'requirements';
  (await import('../src/core/db.mjs'))._resetForTests();
  const { addProject } = await import('../src/core/projects.mjs');
  projKey = (await addProject({ name: 'shop', path: gitDir('req-nogit-shop') })).find((p) => p.name === 'shop').key;
  const mod = await import('../ui/server.mjs'); app = mod.app; srv = mod.server; T = mod._testing;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  cap.reset(); srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();   // release the sqlite handle (Windows cannot unlink an open file)
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let json = null; try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, json };
};
const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const feature = async (seq) => (await call('GET', `/api/requirements/${seq}`)).json.feature;

test('requirements while git is missing', async (t) => {
  withNoGit(t);
  let seq;
  await checkRows([
    { name: "the brief and the look are the router's git routes; upstream's GIT_ONLY_ROUTES has no requirements entry", run: async () => {
      const { REQUIREMENTS_GIT_ROUTES } = await import('../src/core/requirements/routes.mjs');
      assert.deepEqual([...REQUIREMENTS_GIT_ROUTES], GIT_ONLY);
      assert.deepEqual(T.GIT_ONLY_ROUTES.filter(([, p]) => p.startsWith('/api/requirements')), []);
    } },
    { name: 'the flag off: both answer its 404, never GIT_MISSING', run: async () => {
      const was = process.env.WORCA_FLAGS;
      process.env.WORCA_FLAGS = '';
      try {
        for (const [method, path] of [['POST', `/api/requirements/brief/project/${projKey}`], ['POST', '/api/requirements/1/look']]) {
          const r = await call(method, path, {});
          assert.equal(r.status, 404, path); assert.notEqual(r.json && r.json.code, 'GIT_MISSING', path);
        }
      } finally { process.env.WORCA_FLAGS = was; }
    } },
    { name: 'creating a feature still works: the look is skipped for git and the interview goes on', run: async () => {
      const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
      assert.equal(c.status, 201);
      seq = c.json.feature.seq;
      await waitFor(async () => (await feature(seq)).status === 'your_turn');
      const f = await feature(seq);
      assert.equal(f.orientation.skipped, 'no-git', 'said as no git, so the page stays right once git is back');
      assert.equal(f.orientation.summary, '', 'no mock look either: nothing was read');
      assert.equal(f.pending.questions.length, 2, 'round 1 asks as usual');
    } },
    { name: 'Look closer / Look again: 409 GIT_MISSING, and the feature is untouched', run: async () => {
      const before = await feature(seq);
      const r = await call('POST', `/api/requirements/${seq}/look`, {});
      assert.equal(r.status, 409); assert.deepEqual(r.json, BODY);
      assert.equal((await feature(seq)).status, before.status);
    } },
    { name: 'the product brief Create / Refresh: 409 GIT_MISSING, nothing written', run: async () => {
      const r = await call('POST', `/api/requirements/brief/project/${projKey}`, {});
      assert.equal(r.status, 409); assert.deepEqual(r.json, BODY);
      const page = (await call('GET', `/api/requirements/brief/project/${projKey}`)).json;
      assert.ok(!page.brief || !page.brief.madeAt, 'no brief was made or started');
    } },
    { name: 'a made brief: the page says its staleness is unknown for git, never that the branch is gone', run: async () => {
      const store = await import('../src/core/requirements/store.mjs');
      const b = store.beginBrief('project', projKey);
      store.saveBriefResult(b.id, { sources: [{ project: projKey, branch: 'main', ref: 'refs/heads/main', sha: 'a'.repeat(40) }] });
      const page = (await call('GET', `/api/requirements/brief/project/${projKey}`)).json;
      assert.ok(page.brief.madeAt);
      assert.deepEqual(page.staleness, { known: false, reason: 'no-git' });
      store.deleteBrief('project', projKey);
    } },
    { name: 'git on: the same requests reach their handlers (never GIT_MISSING)', run: async () => {
      gitArrives();
      const look = await call('POST', `/api/requirements/${seq}/look`, {});
      assert.notEqual(look.json && look.json.code, 'GIT_MISSING');
      assert.equal(look.status, 202);
      await waitFor(async () => (await feature(seq)).status !== 'looking');
      // An unknown project: the handler's own 400, so no brief job outlives the test.
      const brief = await call('POST', '/api/requirements/brief/project/nope-1234abcd', {});
      assert.equal(brief.status, 400);
      assert.notEqual(brief.json && brief.json.code, 'GIT_MISSING');
    } },
  ]);
});
