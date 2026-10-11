// test/spec-builder-api.test.mjs — the Spec Builder routes (docs/spec-builder.md): all four 404 while the
// specBuilder flag is off; with it on, estimate / areas / prompt / save against a real temp git project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const home = useTempHome(after, 'worca-cc-spec-builder-api-');
const saved = {};
for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS']) saved[k] = process.env[k];
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';

let srv, base, root, projectDir, project;
const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'spec-builder-api-'));
  projectDir = join(root, 'app');
  await mkdir(join(projectDir, 'src'), { recursive: true });
  await writeFile(join(projectDir, 'src', 'dashboard.js'), 'export {};\n');
  await writeFile(join(projectDir, 'README.md'), '# app\n');
  g(projectDir, 'init', '-q');
  g(projectDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g(projectDir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
  const { app } = await import('../ui/server.mjs');
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'app', path: projectDir });
  project = (await listProjects()).find((p) => p.name === 'app');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const FM = { kind: 'feature', size: 'medium', roles: ['product'] };
const SPEC = '---\nworca:\n  kind: feature\n  size: medium\n  roles: [product]\n---\n# Dark mode\n';

test('flag off: all four routes answer 404 { error: "not found" }', async () => {
  delete process.env.WORCA_FLAGS;
  for (const r of [
    await post('/api/spec-builder/estimate', { frontMatter: FM }),
    await fetch(`${base}/api/spec-builder/areas?projectDir=${encodeURIComponent(projectDir)}&q=dashboard`),
    await post('/api/spec-builder/prompt', { projectDir, answers: { goal: 'x' } }),
    await post('/api/spec-builder/save', { projectKey: project.key, markdown: SPEC }),
  ]) {
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'not found' });
  }
  assert.equal(existsSync(join(projectDir, 'plans')), false);
});

test('flag on: estimate, areas, prompt and save', async () => {
  process.env.WORCA_FLAGS = 'specBuilder';
  try {
    await checkRows([
      { name: 'estimate: the recipe for the front-matter; 400 for a bad one', run: async () => {
        const r = await post('/api/spec-builder/estimate', { frontMatter: FM });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).estimate.recipe, 'plan-complete-detailed');
        assert.equal((await post('/api/spec-builder/estimate', { frontMatter: { ...FM, size: 'huge' } })).status, 400);
      } },
      { name: 'areas: tracked paths matching the goal; 404 for an unregistered dir', run: async () => {
        const r = await fetch(`${base}/api/spec-builder/areas?projectDir=${encodeURIComponent(projectDir)}&q=dashboard`);
        assert.equal(r.status, 200);
        assert.deepEqual((await r.json()).areas, ['src/dashboard.js']);
        assert.equal((await fetch(`${base}/api/spec-builder/areas?projectDir=${encodeURIComponent(root)}&q=x`)).status, 404);
      } },
      { name: 'prompt: the marked first message and the project key; 400 for an empty goal', run: async () => {
        const r = await post('/api/spec-builder/prompt', { projectDir, answers: { goal: 'Add a dashboard', roles: ['qa'] } });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.ok(j.text.startsWith('[worca spec-builder]'));
        assert.equal(j.projectKey, project.key);
        assert.equal(j.projectName, 'app');
        assert.equal((await post('/api/spec-builder/prompt', { projectDir, answers: { goal: '  ' } })).status, 400);
      } },
      { name: 'save: writes once; a second save is a 409 with the next free name and the file is unchanged', run: async () => {
        const r = await post('/api/spec-builder/save', { projectKey: project.key, markdown: SPEC });
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { path: 'plans/dark-mode-design.md' });
        assert.equal(await readFile(join(projectDir, 'plans/dark-mode-design.md'), 'utf8'), SPEC);
        const again = await post('/api/spec-builder/save', { projectKey: project.key, markdown: `${SPEC}more\n` });
        assert.equal(again.status, 409);
        const j = await again.json();
        assert.equal(j.code, 'EXISTS');
        assert.equal(j.suggestion, 'plans/dark-mode-design-v2.md');
        assert.equal(await readFile(join(projectDir, 'plans/dark-mode-design.md'), 'utf8'), SPEC);
      } },
      { name: 'save: 400 for a path outside plans/, 404 for an unknown project', run: async () => {
        for (const path of ['../x.md', 'src/x.md']) assert.equal((await post('/api/spec-builder/save', { projectKey: project.key, path, markdown: SPEC })).status, 400, path);
        assert.equal((await post('/api/spec-builder/save', { projectKey: 'nope-00000000', markdown: SPEC })).status, 404);
      } },
      { name: 'save: a plans symlink pointing outside the project is a 400 and nothing is written there', run: async () => {
        const other = join(root, 'other');
        await mkdir(join(other, 'proj'), { recursive: true });
        await mkdir(join(other, 'outside'));
        const { addProject, listProjects } = await import('../src/core/projects.mjs');
        await addProject({ name: 'other', path: join(other, 'proj') });
        const p2 = (await listProjects()).find((p) => p.name === 'other');
        await symlink(join(other, 'outside'), join(other, 'proj', 'plans'), 'dir');
        assert.equal((await post('/api/spec-builder/save', { projectKey: p2.key, markdown: SPEC })).status, 400);
        assert.deepEqual(await readdir(join(other, 'outside')), []);
      } },
    ]);
  } finally { delete process.env.WORCA_FLAGS; }
});
