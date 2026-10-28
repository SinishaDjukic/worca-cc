// test/workflow-export-marketplace-cli.test.mjs
// `worca workflow export <id> --format plugin --marketplace <id> [--name] [--draft] [--dry-run]` (#717),
// spawned like workflow-share-cli.test.mjs. A spawned process cannot reach in-process stubs, so it
// preloads test/helpers/marketplace-publish-stub.mjs with `node --import` (ESM modules are singletons
// per process: the CLI's dynamic import gets the already-stubbed instance).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeMarketplaces } from '../src/core/marketplaces.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const STUB = pathToFileURL(resolve(__dirname, 'helpers', 'marketplace-publish-stub.mjs')).href;
const home = useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-mkt-cli-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).trim();
let bare;

before(() => {
  const src = join(scratch, 'src');
  g(scratch, 'init', '-q', '-b', 'main', src);
  writeFileSync(join(src, 'worca-cc-marketplace.json'), JSON.stringify({ name: 'Acme', plugins: [] }, null, 2) + '\n');
  g(src, 'add', '-A'); g(src, 'commit', '-qm', 'c1');
  bare = join(scratch, 'market.git');
  g(scratch, 'clone', '-q', '--bare', src, bare);
  writeMarketplaces({ seededBuiltin: true, marketplaces: {
    acme: { id: 'acme', url: 'https://github.com/acme/market', name: 'Acme', description: '', addedAt: '2026-10-15T00:00:00Z', lastSync: null, plugins: [], warnings: [] },
  } });
});

function run(args) {
  return new Promise((res) => {
    const env = { ...process.env, WORCA_MOCK: '1', WORCA_HOME: home, WORCA_CLONE_ALLOW: '',
      WORCA_TEST_MKT_REMOTES: JSON.stringify({ 'https://github.com/acme/market.git': bare }) };
    const child = spawn(process.execPath, ['--import', STUB, CLI, ...args], { env, cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b)); child.stderr.on('data', (b) => (stderr += b));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}
const branchTip = () => g(bare, 'ls-remote', bare, 'refs/heads/worca/plugin/shared-default').split(/\s+/)[0] || '';

test('usage errors exit 2', async () => {
  const both = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--marketplace', 'acme', '--target', scratch]);
  assert.equal(both.code, 2); assert.match(both.stderr, /mutually exclusive/);
  const draft = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--target', join(scratch, 'p'), '--draft']);
  assert.equal(draft.code, 2); assert.match(draft.stderr, /--draft applies only to --marketplace/);
  const keep = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--marketplace', 'acme', '--keep-version']);
  assert.equal(keep.code, 2); assert.match(keep.stderr, /--keep-version does not apply/);
  const none = await run(['workflow', 'export', 'wf_default', '--format', 'plugin']);
  assert.equal(none.code, 2); assert.match(none.stderr, /requires --target/);
  const json = await run(['workflow', 'export', 'wf_default', '--format', 'json', '--marketplace', 'acme']);
  assert.equal(json.code, 2); assert.match(json.stderr, /--marketplace and --draft apply only to --format plugin/);
});

test('--dry-run prints files, the index change and the PR body; pushes nothing', async () => {
  const r = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--marketplace', 'acme', '--name', 'shared-default', '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /create\tplugins\/shared-default\/worca-cc-plugin\.json/);
  assert.match(r.stdout, /index\tworca-cc-marketplace\.json\t\+ "plugins\/shared-default"/);
  assert.match(r.stdout, /--- pull request: Add plugin shared-default v0\.1\.0/);
  assert.match(r.stdout, /## Validation/);
  assert.match(r.stdout, /dry run: nothing pushed/);
  assert.equal(branchTip(), '');
});

test('a real export pushes worca/plugin/<name> and prints the PR link; unknown marketplace exits 1', async () => {
  const r = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--marketplace', 'acme', '--name', 'shared-default', '--draft']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /pull request opened \(draft\): https:\/\/github\.com\/acme\/market\/pull\/7/);
  assert.notEqual(branchTip(), '');
  const bad = await run(['workflow', 'export', 'wf_default', '--format', 'plugin', '--marketplace', 'nope']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /marketplace not found: nope/);
});
