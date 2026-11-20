// test/cli-install.test.mjs
// `worca --install <dir> [--force]`: the shared parseArgs used to reject --force as an
// unknown flag before the install branch could forward it to tools/install.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const CLI = join(ROOT, 'src', 'cli', 'worca-cc.mjs');
// Any shipped agent works; pick one from disk so a renamed agent cannot break the test.
const AGENT = readdirSync(join(ROOT, 'agents')).filter((n) => n.endsWith('.md')).sort()[0];

// Spawned children inherit process.env, so this temp home reaches the CLI too.
useTempHome(after, 'worca-cc-cliinstall-home-');

const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

function targetWithStaleAgent() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-install-target-'));
  scratch.push(dir);
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', AGENT), 'STALE\n');
  return dir;
}

const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], {
  env: { ...process.env, WORCA_MOCK: '1' },
  encoding: 'utf8',
});

test('--install <dir> --force exits 0 and overwrites an existing agent file', () => {
  const dir = targetWithStaleAgent();
  const r = runCli(['--install', dir, '--force']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /Unknown flag/);
  assert.equal(
    readFileSync(join(dir, '.claude', 'agents', AGENT), 'utf8'),
    readFileSync(join(ROOT, 'agents', AGENT), 'utf8'),
  );
});

test('--install <dir> without --force keeps an existing agent file', () => {
  const dir = targetWithStaleAgent();
  const r = runCli(['--install', dir]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(readFileSync(join(dir, '.claude', 'agents', AGENT), 'utf8'), 'STALE\n');
  assert.match(r.stdout, /Re-run with --force to overwrite/);
});

test('--force without --install is a usage error (exit 2) and installs nothing', () => {
  const r = runCli(['--force']);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(r.stderr.trim(), 'worca: --force only applies to --install <targetDir>.');
});
