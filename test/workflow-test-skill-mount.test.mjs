// test/workflow-test-skill-mount.test.mjs — workflow tests 3b, final review E2: a Pretend try mounts its skills as copies
// (`copyMount`), never as links, so stripping their frontmatter hooks never edits the person's or a plugin's real files.
// Without it the mount is as before.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleRunContext } from '../src/core/run-context.mjs';
import { readRunManifest, rescueModifiedMounts } from '../src/core/run-manifest.mjs';
import { stripMountedSkillHooks } from '../src/core/workflow-tests/project-claude-settings.mjs';

const WIN_SYMLINK = { skip: process.platform === 'win32' ? 'creating symlinks needs a privilege (Developer Mode / admin) on Windows' : false };
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
const tmp = async (p = 'worca-cc-skm-') => { const d = await mkdtemp(join(tmpdir(), p)); created.push(d); return realpath(d); };
const SKILL = '---\nname: deploy\nhooks:\n  Stop: []\n---\nbody\n';

/** Run `fn` with HOME/USERPROFILE sandboxed and Worca's settings.json seeded from `settings` (as run-context.test.mjs). */
async function withSettings(settings, fn) {
  const home = await tmp('worca-cc-skm-home-');
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify(settings), 'utf8');
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
async function setup() {
  const root = await tmp('worca-cc-skm-root-');
  await mkdir(join(root, '.claude', 'skills', 'deploy'), { recursive: true });
  await writeFile(join(root, '.claude', 'skills', 'deploy', 'SKILL.md'), SKILL);
  const wt = await tmp('worca-cc-skm-wt-');
  const rr = join(await tmp('worca-cc-skm-rr-'), 'pid12345');
  await mkdir(rr, { recursive: true });
  return { root, wt, rr };
}
const assemble = ({ root, wt, rr }, over = {}) => assembleRunContext({
  runRoot: rr, members: [{ projectKey: 'k1', projectName: 'P', projectDir: wt, worktreeDir: wt }], projectsRoot: root,
  isWorkspace: false, requiredSkillResolutions: new Map(), graphInstructions: new Map(), homeDir: over.homeDir || wt, ...over });

test('E2: copyMount mounts a copy even when skillMount is symlink; the copy is the try\'s own', async () => {
  const s = await setup();
  const rc = await withSettings({ skillMount: 'symlink' }, () => assemble(s, { copyMount: true }));
  const dest = join(s.wt, '.claude', 'skills', 'deploy');
  assert.equal((await lstat(dest)).isSymbolicLink(), false);
  assert.equal(rc.injectedPaths.k1.find((e) => e.path.endsWith('deploy')).mount, undefined, 'recorded as a copy');
  assert.ok(!rc.warnings.some((w) => /write-through/i.test(w)), JSON.stringify(rc.warnings));
  await writeFile(join(dest, 'SKILL.md'), 'stripped\n');
  assert.equal(await readFile(join(s.root, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'), SKILL, 'the person\'s file is untouched');
});

test('E2: without copyMount the symlink setting still links (a normal run is unchanged)', WIN_SYMLINK, async () => {
  const s = await setup();
  await withSettings({ skillMount: 'symlink' }, () => assemble(s));
  assert.equal((await lstat(join(s.wt, '.claude', 'skills', 'deploy'))).isSymbolicLink(), true);
});

test('E2: the teardown rescue does not take Worca\'s own strip for an agent\'s edit, and still rescues an agent\'s edit after it', async () => {
  const s = await setup();
  const rc = await withSettings({}, () => assemble(s, { copyMount: true }));
  const r = await stripMountedSkillHooks(rc, { warn: async () => {}, runRoot: s.rr });
  assert.deepEqual(r.changed, ['deploy/SKILL.md']);
  const rescue = (entries) => rescueModifiedMounts({ baseDir: s.wt, entries, pipelineDir: s.rr, scope: 'k1', pipelineId: 'pid12345' });
  assert.deepEqual(await rescue(rc.injectedPaths.k1), [], 'Worca\'s strip is not an edit');
  assert.deepEqual(await rescue((await readRunManifest(s.rr)).injectedPaths.k1), [], 'run.json records it too (pipeline delete, resume)');
  await writeFile(join(s.wt, '.claude', 'skills', 'deploy', 'SKILL.md'), 'an agent edit\n');
  const w = await rescue(rc.injectedPaths.k1);
  assert.equal(w.length, 1);
  assert.match(w[0], /agent modified mounted skill `deploy`/);
});

test('E2: copyMount also copies the user skills another engine would link (codex off Windows)', async () => {
  const s = await setup();
  const home = await tmp('worca-cc-skm-user-');
  await mkdir(join(home, '.claude', 'skills', 'mine'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\nx\n');
  await withSettings({}, () => assemble(s, { copyMount: true, engine: 'codex', platform: 'linux', homeDir: home }));
  assert.equal((await lstat(join(s.wt, '.agents', 'skills', 'mine'))).isSymbolicLink(), false);
});
