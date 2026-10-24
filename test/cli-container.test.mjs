// test/cli-container.test.mjs
// `worca container` (src/cli/container.mjs): the wrapper around `docker compose`.
// Every runtime call goes through an injected exec, so nothing here needs Docker.
// The project-scoped box (src/cli/container-mounts.mjs) is planned against real temp repos; only the
// `docker compose config` test needs Docker, and it is skipped without it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import {
  cmdContainer, detectRuntime, commonParent, seedEnv, composeFileArgs, initDir, OVERLAYS, COMPOSE_SRC_DIR,
} from '../src/cli/container.mjs';
import {
  resolveProjectDir, planProjectMasks, renderMaskOverlay, maskSettingsFor, boxName, MOUNT_FILE, EMPTY_FILE, MAX_MASKS,
} from '../src/cli/container-mounts.mjs';
import { secretPathsFor } from '../src/core/secret-paths.mjs';
import { settingEntry, writeProjectSettings } from '../src/core/settings-cascade.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
useTempHome(after);
// maskSettingsFor reads the user layer from $HOME/.worca-cc/settings.json: keep the developer's own settings out.
const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-container-home-'));
process.env.HOME = scratchHome;
process.env.USERPROFILE = scratchHome;
after(() => {
  for (const [k, v] of Object.entries(savedHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(scratchHome, { recursive: true, force: true });
});

/** A fake runtime: records every call; `compose version` succeeds for `available` binaries. */
function fakeExec(available = ['docker']) {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
    if (args[0] === 'compose' && args[1] === 'version') return { status: available.includes(cmd) ? 0 : 127, stdout: '', stderr: '' };
    if (cmd === 'git') return { status: 0, stdout: args[2] === 'user.name' ? 'Test User\n' : 'test@example.com\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}
const io = () => {
  const lines = [];
  const fails = [];
  return { out: (s) => lines.push(s), c: (_n, s) => s, fail: (m) => fails.push(m), lines, fails };
};
const tmp = () => mkdtempSync(join(tmpdir(), 'worca-container-'));

test('container helpers: detectRuntime, commonParent and composeFileArgs', async () => {
  await checkRows([
    { name: 'detectRuntime: flag, env, autodetect, none', run: async () => {
      assert.deepEqual(detectRuntime(fakeExec(['docker']).exec), { bin: 'docker' });
      assert.deepEqual(detectRuntime(fakeExec(['podman']).exec), { bin: 'podman' });
      assert.deepEqual(detectRuntime(fakeExec(['docker', 'podman']).exec, 'podman'), { bin: 'podman' });
      assert.match(detectRuntime(fakeExec([]).exec).error, /no container runtime found/);
      assert.match(detectRuntime(fakeExec(['docker']).exec, 'podman').error, /podman compose is not available/);
      assert.match(detectRuntime(fakeExec(['docker']).exec, 'lima').error, /docker or podman/);
    } },
    { name: 'commonParent: the parent shared by every project, never a root', run: async () => {
      assert.equal(commonParent(['/Users/me/dev/a', '/Users/me/dev/b']), '/Users/me/dev');
      assert.equal(commonParent(['/Users/me/dev/a']), '/Users/me/dev');
      assert.equal(commonParent(['/Users/me/dev/a', '/Users/me/work/b']), '/Users/me');
      assert.equal(commonParent(['/a/x', '/b/y']), null, 'only "/" in common is too wide');
      assert.equal(commonParent([]), null);
    } },
    { name: 'composeFileArgs: base first, then one -f per overlay', run: async () => {
      assert.deepEqual(composeFileArgs([]), ['-f', 'compose.yml']);
      assert.deepEqual(composeFileArgs(['egress', 'ssh']), ['-f', 'compose.yml', '-f', 'compose.egress.yml', '-f', 'compose.ssh.yml']);
      assert.deepEqual(OVERLAYS, ['egress', 'ssh', 'teams', 'clonein']);
      assert.deepEqual(composeFileArgs(['ssh'], { project: true }), ['-f', 'compose.yml', '-f', 'compose.ssh.yml', '-f', 'project-mount.yml'],
        'the generated project mount goes last, so its masks sit on top of every bind');
    } },
  ]);
});

test('seedEnv fills the known keys in the example and leaves the rest commented', () => {
  const example = readFileSync(join(COMPOSE_SRC_DIR, '.env.example'), 'utf8');
  const body = seedEnv(example, { projects: '/Users/me/dev', tz: 'Europe/Berlin', gitName: 'Me', gitEmail: 'me@x.io' });
  assert.match(body, /^WORCA_PROJECTS=\/Users\/me\/dev$/m);
  assert.match(body, /^TZ=Europe\/Berlin$/m);
  assert.match(body, /^GIT_AUTHOR_NAME=Me$/m);
  assert.match(body, /^GIT_AUTHOR_EMAIL=me@x\.io$/m);
  assert.match(body, /^#CLAUDE_CODE_OAUTH_TOKEN=/m, 'tokens stay commented');
  assert.match(body, /^#WORCA_TAG=/m);
  const untouched = seedEnv(example, { projects: '', tz: '', gitName: '', gitEmail: '' });
  assert.match(untouched, /^WORCA_PROJECTS=\/Users\/me\/dev$/m, 'the example value stays when nothing is known');
});

test('initDir copies every compose file, seeds .env once (0600) and never overwrites it', async () => {
  const dir = tmp();
  try {
    const { exec } = fakeExec();
    const r1 = await initDir(dir, { projects: '/Users/me/dev', exec });
    assert.equal(r1.envCreated, true);
    for (const f of ['compose.yml', 'compose.egress.yml', 'compose.ssh.yml', 'compose.teams.yml', 'compose.clonein.yml', 'compose.dev.yml']) {
      assert.ok(existsSync(join(dir, f)), `${f} copied`);
    }
    const env = readFileSync(join(dir, '.env'), 'utf8');
    assert.match(env, /^WORCA_PROJECTS=\/Users\/me\/dev$/m);
    assert.match(env, /^GIT_AUTHOR_NAME=Test User$/m);
    const r2 = await initDir(dir, { projects: '/elsewhere', exec });
    assert.equal(r2.envCreated, false);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), env, '.env is the user\'s file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('up remembers --with overlays; later verbs reuse them; run passes args through', async () => {
  const dir = tmp();
  try {
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up', '--with', 'egress,ssh', '--tag', '1.3.0', '--projects', '/Users/me/dev'], { ...o, exec, dir }), 0);
    const up = calls.find((k) => k.args.includes('up'));
    assert.deepEqual(up.args, ['compose', '-f', 'compose.yml', '-f', 'compose.egress.yml', '-f', 'compose.ssh.yml', 'up', '-d']);
    assert.equal(up.cwd, dir);
    assert.equal(up.env.WORCA_TAG, '1.3.0');
    assert.ok(o.lines.some((l) => l.includes('http://localhost:4317')));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).with, ['egress', 'ssh']);

    calls.length = 0;
    assert.equal(await cmdContainer(['status'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args, ['compose', '-f', 'compose.yml', '-f', 'compose.egress.yml', '-f', 'compose.ssh.yml', 'ps']);

    calls.length = 0;
    assert.equal(await cmdContainer(['run', '--', '--project', '/Users/me/dev/api', '--prompt', 'add search'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args.slice(-7), ['run', '--rm', 'worca', 'worca', '--project', '/Users/me/dev/api', '--prompt', 'add search'].slice(-7));

    calls.length = 0;
    assert.equal(await cmdContainer(['login'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args.slice(-4), ['run', '--rm', 'worca', 'claude']);

    calls.length = 0;
    assert.equal(await cmdContainer(['logs', '--follow'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args.slice(-3), ['logs', '-f', 'worca']);

    assert.equal(await cmdContainer(['up', '--with', 'nope'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /unknown overlay nope/);
    assert.equal(await cmdContainer(['bogus'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /unknown container verb: bogus/);
    assert.equal(await cmdContainer(['run'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /Usage: worca container run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('where / help / no runtime / not initialised', async () => {
  const dir = tmp();
  try {
    const o = io();
    assert.equal(await cmdContainer(['where'], { ...o, exec: fakeExec([]).exec, dir }), 0);
    assert.equal(o.lines.at(-1), dir);
    assert.equal(await cmdContainer(['help'], { ...o, exec: fakeExec([]).exec, dir }), 0);
    assert.match(o.lines.at(-1), /worca container up/);
    assert.equal(await cmdContainer(['status'], { ...o, exec: fakeExec([]).exec, dir }), 1);
    assert.match(o.fails.at(-1), /no container runtime/);
    assert.equal(await cmdContainer(['status'], { ...o, exec: fakeExec().exec, dir }), 1);
    assert.match(o.fails.at(-1), /run: worca container init/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real CLI routes `worca container help` and lists the subcommand in --help', async () => {
  const run = (args) => new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.on('exit', (code) => res({ code, stdout }));
  });
  const h = await run(['container', 'help']);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /worca container — run Worca in a container/);
  const top = await run(['--help']);
  assert.match(top.stdout, /container <cmd> \[\.\.\.\]/);
});

const POSIX_ONLY = process.platform === 'win32' && 'POSIX paths and symlinks';

/** A real repo, by its real path (macOS /var → /private/var): an untracked .env, an ignored .env.local, a committed
 *  config/.env, a .env.example, a .tfvars, a link to a file inside, a link out of the project, and a legacy worca
 *  checkout holding a .env. */
function secretProject() {
  const repo = realpathSync.native(tmp());
  const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  mkdirSync(join(repo, 'config'));
  writeFileSync(join(repo, 'config', '.env'), 'COMMITTED=1\n');
  writeFileSync(join(repo, '.gitignore'), '.env.local\n.worca-cc/\n');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  writeFileSync(join(repo, '.env'), 'TOKEN=host-only\n');
  writeFileSync(join(repo, '.env.local'), 'TOKEN=local\n');
  writeFileSync(join(repo, '.env.example'), 'TOKEN=\n');
  writeFileSync(join(repo, 'prod.tfvars'), 'k = "v"\n');
  writeFileSync(join(repo, 'notes.txt'), 'plain\n');
  symlinkSync('notes.txt', join(repo, '.env.linked'));
  symlinkSync('/etc/hosts', join(repo, '.env.outside'));
  mkdirSync(join(repo, '.worca-cc', 'worktrees', 'r1'), { recursive: true });
  writeFileSync(join(repo, '.worca-cc', 'worktrees', 'r1', '.env'), 'RUN=own\n');
  return repo;
}
/** The mask targets an overlay binds, in file order (each volume line is a JSON flow map with `$` doubled). */
const maskTargets = (yml) => yml.split('\n').filter((l) => l.startsWith('      - ')).map((l) => JSON.parse(l.slice(8).replaceAll('$$', '$')));

test('secretPathsUnmask is a project setting validated like secretPaths', () => {
  const entry = settingEntry('secretPathsUnmask');
  assert.ok(entry, 'the cascade knows secretPathsUnmask');
  assert.ok(entry.validate([]));
  assert.ok(entry.validate(['.env.example']));
  for (const bad of ['.env.example', [''], ['  '], ['a\nb'], [1], Array(201).fill('x')]) assert.ok(!entry.validate(bad), JSON.stringify(bad).slice(0, 40));
  const repo = realpathSync.native(tmp());
  try {
    assert.throws(() => writeProjectSettings({ projectDir: repo }, { secretPathsUnmask: [''] }), /secretPathsUnmask must be a list of project-relative file patterns/);
    writeProjectSettings({ projectDir: repo }, { secretPaths: ['*.tfvars'], secretPathsUnmask: [' .env.example '] });
    const s = maskSettingsFor(repo);
    assert.ok(s.patterns.includes('*.tfvars') && s.patterns.includes('.env*'), 'the defaults plus the project addition');
    assert.deepEqual(s.unmask, ['.env.example']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('resolveProjectDir: one real project folder, never a root, the home or the Worca home', () => {
  const home = realpathSync.native(tmp());
  try {
    const proj = join(home, 'dev', 'api');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(home, 'f'), '');
    assert.deepEqual(resolveProjectDir(proj, { home }), { dir: proj });
    assert.deepEqual(resolveProjectDir(`${proj}/`, { home }), { dir: proj });
    assert.match(resolveProjectDir('', { home }).error, /needs a folder/);
    assert.match(resolveProjectDir(join(home, 'nope'), { home }).error, /does not exist/);
    assert.match(resolveProjectDir(join(home, 'f'), { home }).error, /is not a folder/);
    assert.match(resolveProjectDir('/', { home }).error, /too wide/);
    assert.match(resolveProjectDir(home, { home }).error, /too wide/);
    assert.match(resolveProjectDir(join(home, 'dev'), { home, worcaHomeDir: join(home, 'dev', '.worca') }).error, /holds the Worca home/);
    assert.deepEqual(resolveProjectDir(proj, { home, worcaHomeDir: join(home, 'dev', '.worca') }), { dir: proj }, 'a sibling of the Worca home is fine');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('planProjectMasks: untracked and ignored secrets, project additions and in-project link targets; committed ones are only named', { skip: POSIX_ONLY }, async () => {
  const repo = secretProject();
  try {
    const plan = await planProjectMasks(repo, { patterns: secretPathsFor({ secretPaths: ['*.tfvars'] }), unmask: ['.env.example'] });
    assert.deepEqual(plan.masks, ['.env', '.env.local', 'notes.txt', 'prod.tfvars'],
      'never .env.example (unmasked), config/.env (committed), .env.outside (leads out) or .worca-cc/** (worca\'s checkouts)');
    assert.deepEqual(plan.committed, ['config/.env']);
    assert.deepEqual(plan.skippedLinks, ['.env.outside']);
    assert.equal(plan.trackedUnknown, null);
    const plain = await planProjectMasks(repo, { patterns: secretPathsFor({}) });
    assert.ok(plain.masks.includes('.env.example') && !plain.masks.includes('prod.tfvars'), 'the defaults alone');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('planProjectMasks without git: every match is masked, and the reason is given', { skip: POSIX_ONLY }, async (t) => {
  const repo = secretProject();
  try {
    withNoGit(t);
    const plan = await planProjectMasks(repo, { patterns: secretPathsFor({}) });
    assert.ok(plan.masks.includes('config/.env'), 'a committed file cannot be told apart');
    assert.match(plan.trackedUnknown, /git is not installed/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('renderMaskOverlay: the parent as projects root, one read-only bind of the empty file per mask, `$` doubled', () => {
  const yml = renderMaskOverlay({ projectDir: '/Users/me/dev/api', masks: ['.env', 'a/$x.pem'], emptyFile: '/w/container/mask-empty' });
  assert.match(yml, /^services:\n {2}worca:\n {4}environment:\n {6}WORCA_PROJECTS_ROOT: "\/Users\/me\/dev"\n {4}volumes:\n/m,
    'New and Clone in the box land in the unwritable parent, never inside the project');
  assert.ok(yml.includes('a/$$x.pem'), 'a literal $ is escaped');
  assert.deepEqual(maskTargets(yml), [
    { type: 'bind', source: '/w/container/mask-empty', target: '/Users/me/dev/api/.env', read_only: true },
    { type: 'bind', source: '/w/container/mask-empty', target: '/Users/me/dev/api/a/$x.pem', read_only: true },
  ]);
  const none = renderMaskOverlay({ projectDir: '/srv/p$1', masks: [], emptyFile: '/e' });
  assert.ok(none.includes('WORCA_PROJECTS_ROOT: "/srv"') && !none.includes('volumes:'), 'no masks: the projects root only');
});

test('boxName: one valid compose project per real path', () => {
  assert.match(boxName('/Users/me/dev/My API!'), /^worca-my-api-[0-9a-f]{8}$/);
  assert.equal(boxName('/a/api'), boxName('/a/api'));
  assert.notEqual(boxName('/a/api'), boxName('/b/api'), 'same folder name, another project: another box');
  assert.match(boxName('/x/---'), /^worca-project-[0-9a-f]{8}$/);
  assert.match(boxName(`/x/${'a'.repeat(29)}-b`), /^worca-a{29}-[0-9a-f]{8}$/, 'cut to 30 characters, no dash left at the end');
});

test('up --project: only that folder is bound, its untracked secrets are masked, and every later verb keeps it', { skip: POSIX_ONLY }, async () => {
  const dir = tmp();
  const repo = secretProject();
  try {
    writeProjectSettings({ projectDir: repo }, { secretPaths: ['*.tfvars'], secretPathsUnmask: ['.env.example'] });
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up', '--project', repo, '--projects', '/Users/me/dev'], { ...o, exec, dir }), 0);
    const box = boxName(repo);
    const first = calls.filter((k) => k.cmd === 'docker' && k.args[1] !== 'version');
    assert.deepEqual(first.map((k) => k.args), [['compose', '-f', 'compose.yml', 'down'], ['compose', '-p', box, '-f', 'compose.yml', '-f', MOUNT_FILE, 'up', '-d']],
      'the whole-folder box is stopped first, then the project starts in a box (and volumes) of its own');
    const up = first[1];
    assert.equal(up.env.WORCA_PROJECTS, repo, 'the bind is this project, not the tree in .env');
    assert.equal(up.env.WORCA_PROJECTS_MOUNT, repo, 'at the same path');
    const empty = join(dir, EMPTY_FILE);
    assert.equal(statSync(empty).size, 0);
    assert.equal(statSync(empty).mode & 0o777, 0o444);
    const vols = maskTargets(readFileSync(join(dir, MOUNT_FILE), 'utf8'));
    assert.deepEqual(vols.map((v) => v.target), ['.env', '.env.local', 'notes.txt', 'prod.tfvars'].map((r) => `${repo}/${r}`),
      'a masked .env reads empty; the project\'s own *.tfvars addition is masked; .env.example is left unmasked');
    assert.ok(vols.every((v) => v.source === empty && v.read_only === true));
    assert.ok(o.lines.some((l) => l.includes(`project  ${repo}   only this folder is mounted; 4 secret files masked`)));
    assert.ok(o.lines.some((l) => /1 committed file looks like a secret and is readable in the box with the git history: config\/\.env\./.test(l)));
    assert.ok(o.lines.some((l) => /1 link named like a secret leads out of the project or nowhere, so it is not masked: \.env\.outside/.test(l)));
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).project, repo);
    assert.ok(o.lines.some((l) => l.includes(`box: ${box}`)));

    calls.length = 0;
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir }), 0, 'up again, the project remembered');
    assert.ok(!calls.some((k) => k.args.includes('down')), 'the same box: nothing to stop');
    assert.deepEqual(calls.at(-1).args, ['compose', '-p', box, '-f', 'compose.yml', '-f', MOUNT_FILE, 'up', '-d']);

    for (const verb of [['status'], ['run', '--', 'list'], ['shell'], ['run', '--project', repo, 'list']]) {
      calls.length = 0;
      assert.equal(await cmdContainer(verb, { ...o, exec, dir }), 0, verb.join(' '));
      const call = calls.at(-1);
      assert.deepEqual(call.args.slice(0, 7), ['compose', '-p', box, '-f', 'compose.yml', '-f', MOUNT_FILE], `${verb[0]} keeps the box and its masks`);
      assert.equal(call.env.WORCA_PROJECTS, repo, `${verb[0]} keeps the narrow bind`);
    }
    assert.deepEqual(calls.at(-1).args.slice(-4), ['worca', '--project', repo, 'list'], 'run without `--` passes the worca CLI\'s own --project through');

    calls.length = 0;
    o.lines.length = 0;
    assert.equal(await cmdContainer(['up', '--no-project'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.find((k) => k.args.includes('down')).args, ['compose', '-p', box, '-f', 'compose.yml', 'down'], 'the project box is stopped first');
    const back = calls.find((k) => k.args.includes('up'));
    assert.deepEqual(back.args, ['compose', '-f', 'compose.yml', 'up', '-d']);
    assert.equal(back.env?.WORCA_PROJECTS, undefined, 'the .env tree again');
    assert.equal(back.env?.WORCA_PROJECTS_MOUNT, undefined);
    assert.ok(!existsSync(join(dir, MOUNT_FILE)) && !existsSync(empty));
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).project, null);
    assert.ok(o.lines.some((l) => /projects {2}\/Users\/me\/dev {3}the whole folder is mounted, unmasked/.test(l)));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});

test('up --project refusals: with clone-in, with --no-project, a missing folder, and a lost mount file', { skip: POSIX_ONLY }, async () => {
  const dir = tmp();
  const repo = secretProject();
  try {
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up', '--project', repo, '--with', 'clonein', '--projects', '/Users/me/dev'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /clone-in mounts none/);
    assert.equal(await cmdContainer(['up', '--project', repo, '--no-project'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /cannot go together/);
    assert.equal(await cmdContainer(['up', '--project', join(repo, 'nope')], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /does not exist/);
    assert.ok(!calls.some((k) => k.args.includes('up')), 'nothing started');

    assert.equal(await cmdContainer(['up', '--project', repo], { ...o, exec, dir }), 0);
    rmSync(join(dir, MOUNT_FILE));
    calls.length = 0;
    assert.equal(await cmdContainer(['shell'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /project mount for .* is missing; run: worca container up/);
    assert.equal(calls.filter((k) => k.args.includes('run')).length, 0, 'no one-off container without its masks');
    assert.equal(await cmdContainer(['down'], { ...o, exec, dir }), 0, 'down still works');

    calls.length = 0;
    const downFails = (cmd, args, opts) => (args.includes('down') ? { status: 3, stdout: '', stderr: '' } : exec(cmd, args, opts));
    assert.equal(await cmdContainer(['up', '--no-project'], { ...o, exec: downFails, dir }), 3);
    assert.match(o.fails.at(-1), /could not stop the box for .*; nothing was started/);
    assert.ok(!calls.some((k) => k.args.includes('up')), 'the old box still runs: no second one on its port');
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).project, repo, 'still the project box');

    const other = secretProject();
    try {
      calls.length = 0;
      assert.equal(await cmdContainer(['up', '--project', other], { ...o, exec, dir }), 0, 'another project');
      assert.deepEqual(calls.filter((k) => k.args.includes('down') || k.args.includes('up')).map((k) => k.args.slice(0, 3).concat(k.args.at(-1))),
        [['compose', '-p', boxName(repo), 'down'], ['compose', '-p', boxName(other), '-d']], 'the first project\'s box stops before the next one starts');
      rmSync(other, { recursive: true, force: true });
      calls.length = 0;
      assert.equal(await cmdContainer(['up'], { ...o, exec, dir }), 1, 'the remembered project is gone');
      assert.match(o.fails.at(-1), /does not exist \(remembered from an earlier up: pass --project <dir> or --no-project\)/);
      assert.ok(!calls.some((k) => k.args.includes('up')), 'compose would create the missing folder: nothing started');
    } finally { rmSync(other, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});

test('up --project refuses a folder that holds the Worca home, before it stops or starts anything', { skip: POSIX_ONLY }, async () => {
  const dir = tmp();
  const holder = realpathSync.native(tmp());
  const savedWorcaHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = holder;   // worcaHome() is <holder>/.worca-cc: its database and settings sit inside
  try {
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up', '--project', holder, '--projects', '/Users/me/dev'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), /holds the Worca home .*\.worca-cc; name one project folder/);
    assert.ok(!calls.some((k) => k.args.includes('up') || k.args.includes('down')), 'nothing stopped or started');
    assert.ok(!existsSync(join(dir, MOUNT_FILE)), 'no project mount written');
  } finally {
    process.env.WORCA_HOME = savedWorcaHome;
    rmSync(dir, { recursive: true, force: true }); rmSync(holder, { recursive: true, force: true });
  }
});

test('planProjectMasks in a folder that is not a repository: nothing is committed, every match is masked', { skip: POSIX_ONLY }, async () => {
  const folder = realpathSync.native(tmp());
  try {
    writeFileSync(join(folder, '.env'), 'X=1\n');
    writeFileSync(join(folder, 'id_rsa'), 'k\n');
    writeFileSync(join(folder, 'notes.txt'), 'plain\n');
    const plan = await planProjectMasks(folder, { patterns: secretPathsFor({}) });
    assert.deepEqual(plan.masks, ['.env', 'id_rsa']);
    assert.deepEqual(plan.committed, []);
    assert.equal(plan.trackedUnknown, null, 'no repository is not "git could not tell"');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('up --project refuses more than MAX_MASKS masks before it stops or starts anything', { skip: POSIX_ONLY }, async () => {
  const dir = tmp();
  const folder = realpathSync.native(tmp());
  try {
    for (let i = 0; i <= MAX_MASKS; i++) writeFileSync(join(folder, `.env.${i}`), '');
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up', '--project', folder, '--projects', '/Users/me/dev'], { ...o, exec, dir }), 1);
    assert.match(o.fails.at(-1), new RegExp(`${MAX_MASKS + 1} secret files to mask \\(the limit is ${MAX_MASKS}\\)`));
    assert.ok(!calls.some((k) => k.args.includes('down') || k.args.includes('up')), 'a running box is left alone');
    assert.ok(!existsSync(join(dir, MOUNT_FILE)), 'no overlay written');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(folder, { recursive: true, force: true }); }
});

const COMPOSE = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
test('docker compose config: a project-scoped box binds the project and the masks only', { skip: POSIX_ONLY || (!COMPOSE && 'docker compose is not installed') }, async () => {
  const dir = tmp();
  const repo = secretProject();
  try {
    const { exec } = fakeExec();
    assert.equal(await cmdContainer(['up', '--project', repo, '--projects', '/Users/me/dev'], { ...io(), exec, dir }), 0);
    const r = spawnSync('docker', ['compose', '-p', boxName(repo), '-f', 'compose.yml', '-f', MOUNT_FILE, 'config', '--format', 'json'],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, WORCA_PROJECTS: repo, WORCA_PROJECTS_MOUNT: repo } });
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(r.stdout);
    assert.equal(cfg.name, boxName(repo), 'its own compose project, so its own volumes');
    assert.equal(cfg.services.worca.environment.WORCA_PROJECTS_ROOT, dirname(repo));
    const binds = cfg.services.worca.volumes.filter((v) => v.type === 'bind');
    const empty = join(dir, EMPTY_FILE);
    assert.deepEqual(binds.filter((v) => v.source !== empty).map((v) => [v.source, v.target]), [[repo, repo]], 'no sibling project is bound');
    const masks = binds.filter((v) => v.source === empty);
    assert.equal(masks.length, 4, '.env, .env.example, .env.local and notes.txt (no project settings for this fresh path)');
    assert.ok(masks.every((v) => v.read_only === true));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});

test('planProjectMasks: a refused git config masks every match; a dangling link is named; a link into worca\'s checkouts masks nothing', { skip: POSIX_ONLY }, async () => {
  const repo = secretProject();
  try {
    assert.equal(spawnSync('git', ['config', 'core.gitProxy', 'not-run'], { cwd: repo }).status, 0);
    symlinkSync('missing', join(repo, '.env.dangling'));
    symlinkSync('.worca-cc/worktrees/r1/.env', join(repo, '.env.run'));
    const plan = await planProjectMasks(repo, { patterns: secretPathsFor({}) });
    assert.match(plan.trackedUnknown, /its git config was refused/);
    assert.ok(plan.masks.includes('config/.env'), 'committed files cannot be told apart, so they are masked too');
    assert.ok(!plan.masks.some((m) => m.startsWith('.worca-cc/')), 'a link into worca\'s own checkouts masks nothing there');
    assert.deepEqual(plan.skippedLinks, ['.env.dangling', '.env.outside']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('planProjectMasks: installed packages are never masked (a virtualenv\'s CA bundle, vendored gems, Composer, pixi)', { skip: POSIX_ONLY }, async () => {
  const folder = realpathSync.native(tmp());
  try {
    const put = (rel) => { mkdirSync(dirname(join(folder, rel)), { recursive: true }); writeFileSync(join(folder, rel), 'x\n'); };
    put('.venv/lib/python3.12/site-packages/certifi/cacert.pem');
    put('venv/lib/python3/dist-packages/pip/_vendor/certifi/cacert.pem');
    put('vendor/bundle/ruby/3.3.0/gems/httpclient-2.8.3/lib/httpclient/cacert.pem');
    put('vendor/composer/ca-bundle/res/cacert.pem');
    put('.pixi/envs/default/ssl/cacert.pem');
    put('certs/server.pem');
    symlinkSync('.venv/lib/python3.12/site-packages/certifi/cacert.pem', join(folder, 'ca.pem'));
    const plan = await planProjectMasks(folder, { patterns: secretPathsFor({}) });
    assert.deepEqual(plan.masks, ['certs/server.pem'], 'the project\'s own key file only: an empty CA bundle would break TLS in the box');
    assert.deepEqual(plan.skippedLinks, []);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('docs: the project-scoped box is one box per project, not a mount per run (the owner\'s choice, said where it is used)', () => {
  const doc = readFileSync(join(__dirname, '..', 'docs', 'docker.md'), 'utf8');
  assert.match(doc, /one box per project, shared by\s+every run of that project, not a separate mount per run/);
  assert.match(doc, /One box per project, not per run: every run of the project shares this box/);
});

test('up: a remembered project that now resolves to another real path is remembered by that path', { skip: POSIX_ONLY }, async () => {
  const dir = tmp();
  const repo = secretProject();
  const parent = realpathSync.native(tmp());
  try {
    const link = join(parent, 'api');
    symlinkSync(repo, link);
    writeFileSync(join(dir, '.worca-container.json'), JSON.stringify({ with: [], project: link }));
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir }), 0);
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).project, repo, 'the real path the box binds');
    assert.deepEqual(calls.at(-1).args.slice(0, 3), ['compose', '-p', boxName(repo)]);
    calls.length = 0;
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir }), 0);
    assert.ok(!calls.some((k) => k.args.includes('down')), 'the same box again: nothing to stop');
  } finally { for (const p of [dir, repo, parent]) rmSync(p, { recursive: true, force: true }); }
});
