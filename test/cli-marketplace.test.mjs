// test/cli-marketplace.test.mjs — `worca marketplace <verb>` family + install
// resolution through marketplace snapshots. Harness mirrors test/cli-plugin.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const execFileP = promisify(execFile);

useTempHome(after);
const created = [];
const scratchCwd = mkdtempSync(join(tmpdir(), 'worca-cc-cli-mkt-cwd-'));
created.push(scratchCwd);
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { home } = {}) {
  return new Promise((res) => {
    const env = { ...process.env, WORCA_MOCK: '1' };
    if (home) env.WORCA_HOME = home;
    const child = spawn(process.execPath, [CLI, ...args], {
      env, cwd: scratchCwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

async function makeMarketRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mktrepo-'));
  created.push(dir);
  await mkdir(join(dir, 'plugins', 'cli-demo'), { recursive: true });
  await writeFile(join(dir, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'CLI Market', plugins: ['plugins/cli-demo'] }));
  await writeFile(join(dir, 'plugins', 'cli-demo', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'cli-demo', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'Demo', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  await writeFile(join(dir, 'plugins', 'cli-demo', 'index.mjs'), 'export default () => ({});\n');
  const git = (...args) => execFileP('git', ['-C', dir, ...args]);
  await execFileP('git', ['init', '-q', '-b', 'main', dir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture');
  return dir;
}

test('marketplace add/list/refresh/remove lifecycle; builtin seeded on first use', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt-'));
  created.push(home);
  const dir = await makeMarketRepo();

  const add = await run(['marketplace', 'add', dir], { home });
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /CLI Market/);
  assert.match(add.stdout, /cli-demo/);

  const list = await run(['marketplace', 'list'], { home });
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /CLI Market/);
  assert.match(list.stdout, /Worca CC Official/, 'builtin seeded from the host checkout');

  const dup = await run(['marketplace', 'add', dir], { home });
  assert.equal(dup.code, 1);
  assert.match(dup.stderr, /already added/);

  const refresh = await run(['marketplace', 'refresh'], { home });
  assert.equal(refresh.code, 0, refresh.stderr);
  assert.match(refresh.stdout, /CLI Market/); // E13

  // remove needs the id: parse it from list output (second column, tab-separated)
  const idLine = list.stdout.split('\n').find((l) => l.includes('CLI Market'));
  const id = idLine.split('\t')[1];
  const rm1 = await run(['marketplace', 'remove', id, '--yes'], { home });
  assert.equal(rm1.code, 0, rm1.stderr);
  assert.match(rm1.stdout, /installed plugins remain/i);
  assert.doesNotMatch((await run(['marketplace', 'list'], { home })).stdout, /CLI Market/);
});

test('plugin install resolves the repo through marketplace snapshots (no --repo)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt2-'));
  created.push(home);
  const dir = await makeMarketRepo();
  assert.equal((await run(['marketplace', 'add', dir], { home })).code, 0);
  const inst = await run(['plugin', 'install', 'cli-demo', '--yes'], { home });
  assert.equal(inst.code, 0, inst.stderr);
  assert.match(inst.stdout, /installed:/);
  const list = await run(['plugin', 'list'], { home });
  assert.match(list.stdout, /cli-demo/);
  // E13: install stamped marketplace provenance into the lock. Child ran with WORCA_HOME=home,
  // and worcaHome() appends `.worca-cc`, so the lock is at <home>/.worca-cc/plugins/… (import readFileSync).
  const lock = JSON.parse(readFileSync(join(home, '.worca-cc', 'plugins', 'plugins.lock.json'), 'utf8'));
  assert.ok(lock['cli-demo'].marketplace, 'marketplace id recorded from the resolved snapshot');
});

test('plugin add is a marketplace-add alias', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt3-'));
  created.push(home);
  const dir = await makeMarketRepo();
  const r = await run(['plugin', 'add', dir], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /added marketplace/); // E16: assert the real alias output, not just any "marketplace"
  assert.match((await run(['marketplace', 'list'], { home })).stdout, /CLI Market/);
});

test('bare `worca marketplace` prints help and exits 0 (never starts a pipeline) (B1)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt0-'));
  created.push(home);
  const r = await run(['marketplace'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /worca marketplace — manage plugin marketplaces/);
  assert.doesNotMatch(r.stdout + r.stderr, /orchestrator|preflight|pipeline/);
});

test('plugin install of a bundled plugin works on a fresh home with no prior refresh (C5)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt4-'));
  created.push(home);
  // the builtin is seeded with lastSync:null; install must sync it once and resolve.
  // Runs against the host checkout's plugins/github-source (present since phase 2).
  const inst = await run(['plugin', 'install', 'github-source', '--yes'], { home });
  assert.equal(inst.code, 0, inst.stderr);
  assert.match(inst.stdout, /installed:/);
});
