// test/cli-plugin.test.mjs — `worca plugin <verb>` subcommand family.
// Harness mirrors test/cli-subcommands.test.mjs (spawn the real CLI). Two safety
// nets on every spawn: WORCA_MOCK=1 (if a regression ever routes `plugin …`
// into the bare-positional-prompt path, the run degrades to an offline mock run
// instead of spawning claude) and a throwaway non-git cwd (so such a stray run
// can never create worktrees/branches inside THIS repo).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { validatePluginDir } from '../src/core/plugin-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

useTempHome(after);

const created = [];
const scratchCwd = mkdtempSync(join(tmpdir(), 'worca-cc-cli-plugin-cwd-'));
created.push(scratchCwd);
async function freshDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { home, cwd, extraEnv } = {}) {
  return new Promise((res) => {
    const env = { ...process.env, WORCA_MOCK: '1' };
    if (home) env.WORCA_HOME = home;
    if (extraEnv) Object.assign(env, extraEnv);
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      cwd: cwd || scratchCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

test('plugin init scaffolds a plugin that validates cleanly (strict)', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const dir = join(await freshDir('worca-cc-plugin-init-'), 'demo-plugin');
  const r = await run(['plugin', 'init', 'demo-plugin', '--dir', dir], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /scaffolded demo-plugin/);
  const v = validatePluginDir(dir, { strict: true });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  assert.deepEqual(v.problems.filter((p) => p.level === 'error'), []);
  const manifest = JSON.parse(await readFile(join(dir, 'worca-cc-plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'demo-plugin');
  assert.equal(manifest.taskSources[0].id, 'main');
  assert.equal(manifest.taskSources[0].inputs.filter((i) => i.type === 'task-browser').length, 1);
  const cliValidate = await run(['plugin', 'validate', dir, '--strict'], { home });
  assert.equal(cliValidate.code, 0, cliValidate.stderr);
  assert.match(cliValidate.stdout, /OK: demo-plugin/);
});

test('validate --strict exits 2 on an injected unknown manifest field; non-strict passes', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const dir = join(await freshDir('worca-cc-plugin-init-'), 'strict-plugin');
  await run(['plugin', 'init', 'strict-plugin', '--dir', dir], { home });
  const mPath = join(dir, 'worca-cc-plugin.json');
  const m = JSON.parse(await readFile(mPath, 'utf8'));
  m.bogusField = true; // unknown fields are ignored normally, an ERROR under --strict
  await writeFile(mPath, JSON.stringify(m, null, 2));
  const lax = await run(['plugin', 'validate', dir], { home });
  assert.equal(lax.code, 0, lax.stderr);
  const strict = await run(['plugin', 'validate', dir, '--strict'], { home });
  assert.equal(strict.code, 2, strict.stdout + strict.stderr);
  assert.match(strict.stdout + strict.stderr, /bogusField/);
});

test('link + list reflect the lock (name, enabled, linked)', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const dir = join(await freshDir('worca-cc-plugin-init-'), 'linked-plugin');
  await run(['plugin', 'init', 'linked-plugin', '--dir', dir], { home });
  const link = await run(['plugin', 'link', dir], { home });
  assert.equal(link.code, 0, link.stderr);
  assert.match(link.stdout, /linked linked-plugin ->/);
  const list = await run(['plugin', 'list'], { home });
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /linked-plugin/);
  assert.match(list.stdout, /enabled/);
  assert.match(list.stdout, /linked/);
});

test('exec under WORCA_MOCK prints the canned frame result as JSON on stdout', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const dir = join(await freshDir('worca-cc-plugin-init-'), 'exec-plugin');
  await run(['plugin', 'init', 'exec-plugin', '--dir', dir], { home });
  await run(['plugin', 'link', dir], { home });
  const r = await run(['plugin', 'exec', 'exec-plugin', 'main', 'listTasks'], { home });
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout); // stdout carries ONLY the result JSON (scriptable)
  assert.ok(Array.isArray(result.tasks), `expected canned {tasks:[...]}, got: ${r.stdout}`);
  assert.ok(result.tasks.length >= 1);
  assert.ok(result.tasks.every((t) => t.id && t.title));
});

test('install --yes from a local git repo installs end to end (no prompt)', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const repoDir = await freshDir('worca-cc-plugin-repo-');
  const init = await run(['plugin', 'init', 'local-plugin', '--dir', repoDir], { home });
  assert.equal(init.code, 0, init.stderr);
  const g = (args) => spawnSync('git', args, { cwd: repoDir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'cli@test']);
  g(['config', 'user.name', 'cli-test']);
  g(['add', '-A']);
  g(['commit', '-qm', 'plugin v1']);
  const r = await run(['plugin', 'install', 'local-plugin', '--repo', repoDir, '--yes'], { home });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /will install local-plugin/);
  assert.match(r.stdout, /installed:/);
  const list = await run(['plugin', 'list'], { home });
  assert.match(list.stdout, /local-plugin/);
  assert.match(list.stdout, /enabled/);
});

test('unknown verb exits 2; bare `worca plugin` prints help at 0', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const bogus = await run(['plugin', 'bogus'], { home });
  assert.equal(bogus.code, 2);
  assert.match(bogus.stderr, /Unknown plugin subcommand: bogus/);
  const help = await run(['plugin'], { home });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /worca plugin add <repo-url>/);
});
