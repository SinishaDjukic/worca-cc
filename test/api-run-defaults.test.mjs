// test/api-run-defaults.test.mjs — GET /api/run-defaults (ui/routes/new-run/run-defaults.mjs): the `chatSourceBranch`
// field the chat run card reads its source-branch gate from. The existing keys (engine, steps, tags, projectKey, pr)
// stay pinned by test/api-run-engine-default.test.mjs, test/api-run-tags.test.mjs and test/api-run-pr-auto.test.mjs.
// Every case only sends GETs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, writeProjectSettings;
let dirA, dirB, folderDir, plainDir, keyA, keyB, folderKey, workspaceId;
const prevEnv = {};
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
const gate = async (q = '') => (await get(`/api/run-defaults${q}`)).body.chatSourceBranch;
const byDir = (dir) => `?projectDir=${encodeURIComponent(dir)}`;

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-rundef-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_GIT']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  ({ writeProjectSettings } = await import('../src/core/settings-cascade.mjs'));
  const { addProject, getProjectByPath } = await import('../src/core/projects.mjs');
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  dirA = gitDir('rundef-api'); dirB = gitDir('rundef-web');
  folderDir = mkdtempSync(join(tmpdir(), 'worca-cc-rundef-folder-'));
  plainDir = mkdtempSync(join(tmpdir(), 'worca-cc-rundef-plain-'));
  await addProject({ name: 'api', path: dirA }); await addProject({ name: 'web', path: dirB });
  await addProject({ name: 'notes', path: folderDir });
  [keyA, keyB, folderKey] = [dirA, dirB, folderDir].map((d) => getProjectByPath(d).key);
  assert.equal(getProjectByPath(folderDir).vcs, 'none', 'a plain folder registers as a Folder project');
  workspaceId = (await createWorkspace({ name: 'rundef ws', projectPaths: [dirA, dirB] })).id;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  for (const d of [sandboxHome, dirA, dirB, folderDir, plainDir]) if (d) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function userMode(mode) {
  mkdirSync(join(sandboxHome, '.worca-cc'), { recursive: true });
  writeFileSync(join(sandboxHome, '.worca-cc', 'settings.json'), JSON.stringify(mode ? { chat: { sourceBranch: mode } } : {}));
}
function setModes({ user = null, a = null, b = null } = {}) {
  userMode(user);
  writeProjectSettings({ projectDir: dirA }, { 'chat.sourceBranch': a });
  writeProjectSettings({ projectDir: dirB }, { 'chat.sourceBranch': b });
}

test('run-defaults: a git project under ask lists itself in chatSourceBranch.needs', async () => {
  setModes();
  assert.deepEqual(await gate(byDir(dirA)), { mode: 'ask', source: 'default', needs: [{ key: keyA, name: 'api', mode: 'ask', source: 'default' }] });
});

test('run-defaults: current needs no branch', async () => {
  setModes({ user: 'current' });
  assert.deepEqual(await gate(byDir(dirA)), { mode: 'current', source: 'user', needs: [] });
  setModes();
});

test('run-defaults: the project override wins', async () => {
  setModes({ user: 'ask', a: 'current' });
  assert.deepEqual(await gate(byDir(dirA)), { mode: 'current', source: 'project', needs: [] });
  setModes({ user: 'current', a: 'require' });
  assert.deepEqual(await gate(byDir(dirA)), { mode: 'require', source: 'project', needs: [{ key: keyA, name: 'api', mode: 'require', source: 'project' }] });
  setModes();
});

test('run-defaults: a workspace lists only its uncovered git members', async () => {
  setModes({ user: 'current', a: 'ask', b: 'current' });
  const g = await gate(`?workspaceId=${workspaceId}`);
  assert.deepEqual({ mode: g.mode, source: g.source }, { mode: 'current', source: 'user' }, 'the top level is the user layer\'s');
  assert.deepEqual(g.needs, [{ key: keyA, name: 'api', mode: 'ask', source: 'project' }]);
  assert.ok(!g.needs.some((n) => n.key === keyB));
  setModes();
});

test('run-defaults: Folder, non-repo and git-off targets never need a branch', async () => {
  setModes();
  assert.deepEqual((await gate(byDir(folderDir))).needs, [], folderKey);
  assert.deepEqual((await gate(byDir(plainDir))).needs, [], 'a plain directory that is not a git repo');
  process.env.WORCA_GIT = '0';
  try { assert.deepEqual((await gate(byDir(dirA))).needs, [], 'git off'); }
  finally { if (prevEnv.WORCA_GIT === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = prevEnv.WORCA_GIT; }
});

test('run-defaults: no target returns the user mode and no needs', async () => {
  setModes({ user: 'require' });
  assert.deepEqual(await gate(), { mode: 'require', source: 'user', needs: [] });
  setModes();
});
