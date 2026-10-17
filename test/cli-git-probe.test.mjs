// test/cli-git-probe.test.mjs — the CLI resolves git before its first git call; without git a run, a resume and a
// clone refuse with the tool's name.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

useTempHome(after);   // the spawned CLI inherits WORCA_HOME: `worca add` writes into this file's own home
const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
// stdin closed: a headless run that got past the guard refuses at its first prompt instead of starting a pipeline.
const run = (args, env) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
const off = () => ({ ...process.env, WORCA_GIT: '0' });

test('CLI and git', async () => {
  await checkRows([
    { name: 'POSIX: the probe runs first (a fake git first on PATH logs --version before any other git call)', run: () => {
      if (process.platform === 'win32') return;   // POSIX only — checkRows ignores a skip: field
      const bin = mkdtempSync(join(tmpdir(), 'worca-p0-fakegit-')); const log = join(bin, 'calls.log');
      writeFileSync(join(bin, 'git'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$WORCA_FAKE_GIT_LOG"\n[ "$1" = "--version" ] && { echo "git version 2.99.0"; exit 0; }\nexit 128\n');
      chmodSync(join(bin, 'git'), 0o755);
      const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, WORCA_FAKE_GIT_LOG: log }; delete env.WORCA_GIT;
      const proj = mkdtempSync(join(tmpdir(), 'worca-p0-cliproj-'));
      const r = run(['add', 'p0cli', '--path', proj], env);
      assert.equal(r.status, 0, r.stderr);
      const lines = readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(lines[0], '--version');
      assert.ok(lines.some((l) => l.startsWith('rev-parse')), lines.join(' | '));
    } },
    { name: 'WORCA_GIT=0: a headless run refuses (exit 2), resume refuses (exit 1)', run: async () => {
      const proj = mkdtempSync(join(tmpdir(), 'worca-p0-runproj-'));   // never the checkout: a run past the guard cuts a branch there
      const r = run(['--mock', '--project', proj, '--prompt', 'x'], off());
      assert.equal(r.status, 2); assert.match(r.stderr, /^worca: git is not installed on this machine$/m);
      const { id: paused } = await seedPipeline(proj, { status: 'paused' });   // a git run: refused before (P0) and after (P1 S3) the row read
      const s = run(['resume', paused, '--mock'], off());
      assert.equal(s.status, 1); assert.match(s.stderr, /worca: git is not installed on this machine/);
    } },
    { name: 'WORCA_GIT=0: add --clone refuses before any folder exists', run: () => {
      const root = mkdtempSync(join(tmpdir(), 'worca-p0-root-'));
      const r = run(['add', '--clone', 'https://github.com/acme/api'], { ...off(), WORCA_PROJECTS_ROOT: root });
      assert.equal(r.status, 1); assert.match(r.stderr, /git is not installed on this machine \(git-missing\)/);
      assert.equal(existsSync(join(root, 'api')), false);
    } },
  ]);
});
