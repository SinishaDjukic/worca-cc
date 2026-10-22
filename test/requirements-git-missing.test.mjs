// test/requirements-git-missing.test.mjs — Requirements with git missing (upstream's P0 contract, as
// test/git-missing-routes.test.mjs checks it for its own routes): the product brief's Create / Refresh and Look closer /
// Look again are GIT_ONLY_ROUTES entries and answer 409 GIT_MISSING; creating a feature still works and its automatic
// look is skipped as "no repository" (no checkout, no call); with git back the routes reach their handlers again.
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
const GIT_ONLY = [['post', '/api/requirements/brief/:scopeType/:scopeKey'], ['post', '/api/requirements/:seq/look']];
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
    { name: 'the brief and the look are GIT_ONLY_ROUTES entries, each shadowing a real handler', run: () => {
      const have = new Set(T.GIT_ONLY_ROUTES.map(([m, p]) => `${m} ${p}`));
      const layers = app._router.stack.filter((l) => l.route);
      for (const [m, p] of GIT_ONLY) {
        assert.ok(have.has(`${m} ${p}`), `${m} ${p} in the table`);
        assert.ok(layers.filter((l) => l.route.path === p && l.route.methods[m]).length >= 2, `${m} ${p} shadows a handler`);
      }
    } },
    { name: 'creating a feature still works: the look is skipped as no repository and the interview goes on', run: async () => {
      const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
      assert.equal(c.status, 201);
      seq = c.json.feature.seq;
      await waitFor(async () => (await feature(seq)).status === 'your_turn');
      const f = await feature(seq);
      assert.equal(f.orientation.skipped, 'no-repo');
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
