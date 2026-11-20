// test/readiness-projects.test.mjs — src/core/repo-readiness/projects.mjs and the run-start snapshot on a Folder project
// (vcs 'none', or no git installed): its runs work on a copy of the folder, and worca never runs git in it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { getReadiness } from '../src/core/repo-readiness/projects.mjs';
import { writeReadinessSnapshot } from '../src/core/repo-readiness/snapshot.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';

useTempHome(after);
const POSIX = { skip: process.platform === 'win32' ? 'the git shim is a POSIX shell script' : false };

/** Runs `fn` with a `git` on PATH that logs each call's cwd, then calls the real git. */
async function withGitShim(fn) {
  const shim = mkdtempSync(join(tmpdir(), 'readiness-gitshim-'));
  const log = join(shim, 'calls.tsv');
  const real = execSync('command -v git', { encoding: 'utf8' }).trim();
  writeFileSync(join(shim, 'git'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = `${shim}:${prev}`;
  try {
    return await fn(() => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []));
  } finally {
    process.env.PATH = prev;
    rmSync(shim, { recursive: true, force: true });
  }
}

function folderProject(name) {
  const dir = mkdtempSync(join(tmpdir(), `readiness-${name}-`));
  writeFileSync(join(dir, 'CLAUDE.md'), '# c');
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('getReadiness on a Folder project runs no git, and its CLAUDE.md makes Claude Code ready', POSIX, async () => {
  const dir = folderProject('folder');
  await withGitShim(async (calls) => {
    const report = await getReadiness({ key: 'folder-00000001', name: 'folder', path: dir, exists: true, vcs: 'none' });
    assert.ok(report, 'a report');
    assert.equal(report.engines.claude.level, 'ready');
    assert.equal(report.checks.find((c) => c.id === 'git.repo').status, 'skip');
    assert.deepEqual(calls().filter((l) => l.startsWith(dir) || l.includes(dir)), [], 'no git in the folder');
  });
});

test('the run-start snapshot of a Folder project runs no git', POSIX, async () => {
  const dir = folderProject('snap');
  const runRoot = mkdtempSync(join(tmpdir(), 'readiness-snap-run-'));
  after(() => rmSync(runRoot, { recursive: true, force: true }));
  mkdirSync(join(runRoot, '.worca'), { recursive: true });
  await withGitShim(async (calls) => {
    await writeReadinessSnapshot({ runRoot, projectDir: dir, projectKey: 'snap-00000001', engine: 'claude', folder: true });
    assert.deepEqual(calls().filter((l) => l.includes(dir)), [], 'no git in the folder');
  });
  const manifest = await readRunManifest(runRoot).catch(() => null);
  if (manifest && manifest.readiness) assert.notEqual(manifest.readiness.level, 'unknown');
});
