// test/workflow-share-cli.test.mjs
// `worca workflow export --format json|plugin` and `worca workflow import`
// (issue #421), spawned like workflow-export-cli.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

const home = useTempHome(after);
const created = [];
const scratchCwd = mkdtempSync(join(tmpdir(), 'worca-cc-wfs-cwd-'));
created.push(scratchCwd);
async function freshDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { cwd, stdin } = {}) {
  return new Promise((res) => {
    const env = { ...process.env, WORCA_MOCK: '1', WORCA_HOME: home };
    const child = spawn(process.execPath, [CLI, ...args], {
      env, cwd: cwd || scratchCwd, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
    if (stdin !== undefined) { child.stdin.end(stdin); }
  });
}

test('workflow export --format json prints the unstamped graph; --out writes a file', async () => {
  const r = await run(['workflow', 'export', 'wf_default', '--format', 'json']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ['version', 'name', 'domain', 'nodes', 'wires']);
  assert.equal(j.name, 'Default');
  const dir = await freshDir('worca-cc-wfs-out-');
  const out = join(dir, 'default.json');
  const w = await run(['workflow', 'export', 'wf_default', '--format', 'json', '--out', out]);
  assert.equal(w.code, 0, w.stderr);
  assert.match(w.stdout, /wrote\t/);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), j);
  const bad = await run(['workflow', 'export', 'wf_default', '--format', 'yaml']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--format must be/);
});

test('workflow import: mints, then suffixes on a second import; stdin works; bad JSON is a usage error', async () => {
  const dir = await freshDir('worca-cc-wfs-imp-');
  const file = join(dir, 'shared.json');
  const src = JSON.parse((await run(['workflow', 'export', 'wf_default', '--format', 'json'])).stdout);
  await writeFile(file, JSON.stringify({ ...src, name: 'From File' }), 'utf8');
  const a = await run(['workflow', 'import', file]);
  assert.equal(a.code, 0, a.stderr);
  assert.match(a.stdout, /^imported\twf_[a-z0-9-]+\tFrom File$/m);
  const b = await run(['workflow', 'import', file]);
  assert.equal(b.code, 0, b.stderr);
  assert.match(b.stdout, /imported\twf_[a-z0-9-]+\tFrom File \(2\)/);
  assert.match(b.stdout, /renamed: "From File" was already taken/);
  const c = await run(['workflow', 'import', '-', '--name', 'Via Stdin'], { stdin: JSON.stringify(src) });
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /imported\twf_via-stdin\tVia Stdin/);
  const list = await run(['workflow', 'list']);
  assert.match(list.stdout, /From File \(2\)/);
  assert.match(list.stdout, /Via Stdin/);
  await writeFile(file, '{ not json', 'utf8');
  const bad = await run(['workflow', 'import', file]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /not valid JSON/);
  const missing = await run(['workflow', 'import', join(dir, 'nope.json')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /cannot read/);
});

test('workflow import refuses a graph that needs agents this host lacks, naming them and the plugin path', async () => {
  const dir = await freshDir('worca-cc-wfs-ghost-');
  const file = join(dir, 'ghost.json');
  const src = JSON.parse((await run(['workflow', 'export', 'wf_default', '--format', 'json'])).stdout);
  const nodes = src.nodes.map((n) => (n.kind === 'agent' && n.key === 'planner' ? { ...n, key: 'ghostAgent' } : n));
  await writeFile(file, JSON.stringify({ ...src, name: 'Ghost', nodes }), 'utf8');
  const r = await run(['workflow', 'import', file]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /1 agent not installed here \(ghostAgent\)/);
  assert.match(r.stderr, /--format plugin/);
  assert.match(r.stderr, /- V4: unknown agent "ghostAgent"/);
});

test('workflow export --format plugin --target writes a linkable folder; --dry-run writes nothing', async () => {
  const dir = join(await freshDir('worca-cc-wfs-plg-'), 'shared-default');
  const dry = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--target', dir, '--dry-run']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /create\t.*worca-cc-plugin\.json/);
  assert.match(dry.stdout, /create\t.*workflows[\\/]default\.json/);
  assert.match(dry.stdout, /warn\tbuilt-in agent\(s\) not bundled/);
  assert.equal(existsSync(dir), false);
  const r = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--target', dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /wrote\t.*workflows[\\/]default\.json/);
  assert.match(r.stdout, /plugin "shared-default" v0\.1\.0 at /);
  assert.match(r.stdout, /worca plugin link /);
  assert.ok(existsSync(join(dir, 'worca-cc-plugin.json')));
  // The recipient side: the folder lints clean under the CLI's own validator.
  const v = await run(['plugin', 'validate', dir, '--strict']);
  assert.equal(v.code, 0, v.stderr + v.stdout);
  // Re-export: all no-op, version unchanged.
  const again = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--target', dir]);
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /wrote\t/);
  assert.match(again.stdout, /v0\.1\.0 at /);
  const usage = await run(['workflow', 'export', 'wf_default', '--format', 'plugin']);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /requires --target/);
});

test('plugin init --with workflows no longer requires agents: the scaffold runs a built-in', async () => {
  const dir = join(await freshDir('worca-cc-wfs-init-'), 'wf-only');
  const r = await run(['plugin', 'init', 'wf-only', '--dir', dir, '--with', 'workflows']);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const tpl = JSON.parse(await readFile(join(dir, 'workflows', 'example-flow.json'), 'utf8'));
  assert.equal(tpl.nodes.find((n) => n.kind === 'agent').key, 'planner');
  assert.equal(existsSync(join(dir, 'agents')), false);
});
