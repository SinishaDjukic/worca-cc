// test/workflow-export-cli.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

const home = useTempHome(after);
const created = [];
const scratchCwd = mkdtempSync(join(tmpdir(), 'worca-cc-wfx-cwd-'));
created.push(scratchCwd);
async function freshDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { cwd } = {}) {
  return new Promise((res) => {
    const env = { ...process.env, WORCA_MOCK: '1', WORCA_HOME: home };
    const child = spawn(process.execPath, [CLI, ...args], {
      env, cwd: cwd || scratchCwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

test('workflow list prints wf_default', async () => {
  const r = await run(['workflow', 'list']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /wf_default\tDefault\tcoding/);
});

test('workflow export --dry-run writes nothing and shows a plan', async () => {
  const dest = await freshDir('worca-cc-wfx-dry-');
  const r = await run(['workflow', 'export', 'wf_default', '--target', dest, '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /create\t.*SKILL\.md/);
  // dry-run: nothing wrote
  const r2 = await run(['workflow', 'export', 'wf_default', '--target', dest, '--dry-run']);
  assert.doesNotMatch(r2.stdout, /wrote\t/);
});

test('workflow export --on-conflict=overwrite writes the tree; re-export is all no-op/skip', async () => {
  const dest = await freshDir('worca-cc-wfx-app-');
  const r = await run(['workflow', 'export', 'wf_default', '--target', dest, '--on-conflict=overwrite']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /wrote\t.*SKILL\.md/);
  // Idempotent re-export: everything is no-op (plan) and nothing new is written.
  const r2 = await run(['workflow', 'export', 'wf_default', '--target', dest, '--on-conflict=overwrite']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stdout, /no-op\t.*SKILL\.md/);
  assert.doesNotMatch(r2.stdout, /wrote\t/);
});

test('invalid --on-conflict is a usage error (exit 2)', async () => {
  const dest = await freshDir('worca-cc-wfx-bad-');
  const r = await run(['workflow', 'export', 'wf_default', '--target', dest, '--on-conflict=bogus']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /on-conflict must be/);
});
