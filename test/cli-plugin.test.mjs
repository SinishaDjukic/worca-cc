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
  assert.equal(manifest.engines['worca-cc-api'], '>=3 <4', 'scaffolds the current plugin API');
  const sidecar = JSON.parse(await readFile(join(dir, 'agents', 'demoPluginHelper.meta.json'), 'utf8'));
  assert.equal(sidecar.metaVersion, 2);
  assert.deepEqual(sidecar.inputs, [{ id: 'task', type: 'md', required: true }]);
  assert.deepEqual(sidecar.outputs, [{ id: 'notes', type: 'md', filename: 'notes.md', store: 'run' }]);
  assert.equal(sidecar.consumes, undefined, 'no channel vocabulary in an API-3 scaffold');
  const flow = JSON.parse(await readFile(join(dir, 'workflows', 'example-flow.json'), 'utf8'));
  assert.equal(flow.version, 2);
  assert.deepEqual(flow.nodes.map((n) => n.kind), ['task', 'agent', 'end']);
  assert.equal(flow.nodes[1].key, 'demoPluginHelper');
  assert.equal(flow.wires.length, 2);
  // Product-name rule: user-facing scaffold prose says "worca", never "worca-cc"
  // (the worca-cc-plugin.json filename and the worca-cc-api key are identifiers).
  const agentMd = await readFile(join(dir, 'agents', 'demoPluginHelper.md'), 'utf8');
  assert.match(agentMd, /worca plugin\./);
  assert.doesNotMatch(agentMd, /worca-cc/);
  assert.doesNotMatch(manifest.description, /worca-cc/);
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

test('plugin list prints the API-3 data-contract line for an outdated plugin', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const dir = join(await freshDir('worca-cc-plugin-init-'), 'stale-plugin');
  // No `workflows` part: this test is about the SIDECAR contract, and a v2
  // example flow wired to a downgraded agent would fail the graph rules too.
  await run(['plugin', 'init', 'stale-plugin', '--dir', dir, '--with', 'task-source,agents'], { home });
  // An honest old plugin: an API-1 range shipping API-1 data. It still LINKS
  // (warn path — its connector works); worca just ignores the agent it ships.
  // `plugin link` REFUSES a `>=3 <4` manifest shipping a v1 sidecar (the hard
  // gate), so an "outdated plugin" fixture must declare an OLD range.
  const mPath = join(dir, 'worca-cc-plugin.json');
  const m = JSON.parse(await readFile(mPath, 'utf8'));
  m.engines['worca-cc-api'] = '>=1 <2';
  await writeFile(mPath, JSON.stringify(m, null, 2));
  const metaPath = join(dir, 'agents', 'stalePluginHelper.meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  delete meta.metaVersion; delete meta.inputs; delete meta.outputs;
  meta.consumes = ['userPrompt']; meta.produces = ['code'];
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  const linked = await run(['plugin', 'link', dir], { home });
  assert.equal(linked.code, 0, linked.stdout + linked.stderr);
  const list = await run(['plugin', 'list'], { home });
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout,
    /built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates \u2014 update or reinstall the plugin \(1 agent\(s\), 0 template\(s\) ignored\)/);

  const clean = join(await freshDir('worca-cc-plugin-init-'), 'fresh-plugin');
  await run(['plugin', 'init', 'fresh-plugin', '--dir', clean, '--with', 'task-source,agents'], { home });
  await run(['plugin', 'link', clean], { home });
  const both = await run(['plugin', 'list'], { home });
  assert.match(both.stdout, /fresh-plugin/);
  assert.equal((both.stdout.match(/update or reinstall the plugin/g) || []).length, 1,
    'only the outdated plugin carries the line');
});

test('plugin link surfaces the mid-migration cause at every level, with no derived template errors (MAJ-12)', async () => {
  const home = await freshDir('worca-cc-cli-plugin-');
  const dir = join(await freshDir('worca-cc-plugin-init-'), 'midmig-plugin');
  await run(['plugin', 'init', 'midmig-plugin', '--dir', dir,
    '--with', 'task-source,agents,skills,workflows'], { home });
  // The plugin author ports the HARDER half first: the template is already a v2
  // graph while the sidecar is still v1.
  const metaPath = join(dir, 'agents', 'midmigPluginHelper.meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  delete meta.metaVersion; delete meta.inputs; delete meta.outputs;
  meta.consumes = ['userPrompt']; meta.produces = ['code'];
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  const hard = await run(['plugin', 'link', dir], { home });
  const hardOut = hard.stdout + hard.stderr;
  assert.equal(hard.code, 2, hardOut);
  assert.match(hardOut, /error: agents\/midmigPluginHelper\.meta\.json: not a meta v2 sidecar/);
  assert.match(hardOut, /error: workflows\/example-flow\.json: references agent key "midmigPluginHelper" whose sidecar is not a valid meta v2 sidecar/);
  assert.doesNotMatch(hardOut, /V4:|V5:|V20:|V21:/, 'no derived template errors');

  // The SAME tree under an API-1 range links — and the author still reads the
  // accurate cause, as a warning.
  const mPath = join(dir, 'worca-cc-plugin.json');
  const m = JSON.parse(await readFile(mPath, 'utf8'));
  m.engines['worca-cc-api'] = '>=1 <2';
  await writeFile(mPath, JSON.stringify(m, null, 2));
  const soft = await run(['plugin', 'link', dir], { home });
  const softOut = soft.stdout + soft.stderr;
  assert.equal(soft.code, 0, softOut);
  assert.match(softOut, /warn: agents\/midmigPluginHelper\.meta\.json: not a meta v2 sidecar/);
  assert.match(softOut, /warn: workflows\/example-flow\.json: references agent key "midmigPluginHelper" whose sidecar is not a valid meta v2 sidecar/);
  assert.match(softOut, /linked midmig-plugin ->/);
});
