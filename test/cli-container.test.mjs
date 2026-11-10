// test/cli-container.test.mjs
// `worca container` (src/cli/container.mjs): the wrapper around `docker compose`.
// Every runtime call goes through an injected exec, so nothing here needs Docker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  cmdContainer, detectRuntime, commonParent, seedEnv, composeFileArgs, initDir, defaultExec, OVERLAYS, COMPOSE_SRC_DIR,
} from '../src/cli/container.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
useTempHome(after);

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
      assert.deepEqual(OVERLAYS, ['egress', 'ssh', 'teams', 'clonein', 'workers', 'broker']);
      assert.deepEqual(composeFileArgs(['workers']), ['-f', 'compose.yml', '-f', 'compose.workers.yml']);
      assert.deepEqual(composeFileArgs(['workers', 'egress', 'ca']), ['-f', 'compose.yml', '-f', 'compose.egress.yml', '-f', 'compose.workers.yml', '-f', 'compose.ca.yml'], 'one order whatever was typed: a later file wins in compose, and the workers overlay widens NO_PROXY over the egress one');
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
    for (const f of ['compose.yml', 'compose.egress.yml', 'compose.ssh.yml', 'compose.teams.yml', 'compose.clonein.yml', 'compose.workers.yml', 'compose.dev.yml']) {
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
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')), { with: ['egress', 'ssh'], tag: '1.3.0' });

    calls.length = 0;
    assert.equal(await cmdContainer(['status'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args, ['compose', '-f', 'compose.yml', '-f', 'compose.egress.yml', '-f', 'compose.ssh.yml', 'ps']);
    // The tag is remembered like the overlays: login, pull, status and down resolve the image `up` ran, never `:latest`.
    assert.equal(calls.at(-1).env.WORCA_TAG, '1.3.0', 'status uses the remembered tag');

    calls.length = 0;
    assert.equal(await cmdContainer(['run', '--', '--project', '/Users/me/dev/api', '--prompt', 'add search'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args.slice(-7), ['run', '--rm', 'worca', 'worca', '--project', '/Users/me/dev/api', '--prompt', 'add search'].slice(-7));

    calls.length = 0;
    assert.equal(await cmdContainer(['login'], { ...o, exec, dir }), 0);
    assert.deepEqual(calls.at(-1).args.slice(-4), ['run', '--rm', 'worca', 'claude']);
    assert.equal(calls.at(-1).env.WORCA_TAG, '1.3.0', 'login runs the remembered tag');

    // A later `up --tag` replaces the remembered one; `up` without it keeps it.
    calls.length = 0;
    assert.equal(await cmdContainer(['up', '--tag', 'local'], { ...o, exec, dir }), 0);
    assert.equal(calls.find((k) => k.args.includes('up')).env.WORCA_TAG, 'local');
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).tag, 'local');
    calls.length = 0;
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir }), 0);
    assert.equal(calls.find((k) => k.args.includes('up')).env.WORCA_TAG, 'local');

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

/** A runtime with the real exec's contract (defaultExec): what a command printed comes back only when the caller
 *  asked to capture it. `prints(args)` is that command's output. */
function printingExec(prints) {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'compose' && args[1] === 'version') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'git') return { status: 0, stdout: 'x\n', stderr: '' };
    return { status: 0, stdout: opts.capture ? (prints(args) || '') : '', stderr: '' };
  };
  return { exec, calls };
}

test('defaultExec hands back what a command printed only when asked to capture it', () => {
  const quiet = defaultExec(process.execPath, ['-e', 'process.stdout.write("ids")'], { capture: true });
  assert.deepEqual([quiet.status, quiet.stdout], [0, 'ids']);
  assert.equal(defaultExec(process.execPath, ['-e', ''], {}).stdout, '', 'inherited stdio: nothing to read');
  assert.equal(defaultExec('worca-no-such-binary', [], { capture: true }).status, 127);
});

test("down removes this installation's leftover worker containers; pull refreshes the worker images that are here", async () => {
  const dir = tmp();
  try {
    const { exec, calls } = printingExec((args) => {
      if (args[0] === 'ps') return 'aaa111\nbbb222\n';
      if (args[0] === 'images') return 'ghcr.io/sinishadjukic/worca-worker:latest-claude\nghcr.io/sinishadjukic/worca-worker:latest-codex\n';
      return '';
    });
    const o = io();
    const env = { PATH: process.env.PATH || '', COMPOSE_PROJECT_NAME: 'team-a' };
    assert.equal(await cmdContainer(['up', '--with', 'workers', '--projects', '/Users/me/dev'], { ...o, exec, dir, env }), 0);
    const before = calls.length;
    assert.equal(await cmdContainer(['down'], { ...o, exec, dir, env }), 0);
    const verbs = calls.slice(before).filter((c) => c.args[0] !== 'compose' || c.args[1] !== 'version').map((c) => (c.args[0] === 'compose' ? `compose ${c.args[c.args.length - 1]}` : c.args[0]));
    assert.deepEqual(verbs, ['compose stop', 'ps', 'rm', 'compose down'], 'the controller stops (and releases its workers) first, leftovers go, then the network can be removed');
    const ps = calls.find((c) => c.args[0] === 'ps');
    assert.deepEqual(ps.args, ['ps', '-aq', '--filter', 'label=worca.instance=team-a'], "this stack's workers only");
    assert.deepEqual(calls.find((c) => c.args[0] === 'rm').args, ['rm', '-f', 'aaa111', 'bbb222']);
    assert.ok(o.lines.includes('removed 2 worker container(s)'), o.lines.join('|'));
    assert.equal(await cmdContainer(['pull'], { ...o, exec, dir, env }), 0);
    assert.deepEqual(calls.filter((c) => c.args[0] === 'pull').map((c) => c.args[1]),
      ['ghcr.io/sinishadjukic/worca-worker:latest-claude', 'ghcr.io/sinishadjukic/worca-worker:latest-codex']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('`--with` without a value is refused rather than read as "no overlays"', async () => {
  const dir = tmp();
  try {
    const { exec } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up', '--with', 'workers', '--projects', '/Users/me/dev'], { ...o, exec, dir }), 0);
    assert.equal(await cmdContainer(['up', '--with'], { ...o, exec, dir }), 1);
    assert.match(o.fails[0], /--with needs a comma-separated list of overlays/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).with, ['workers'], 'the remembered overlays are untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
