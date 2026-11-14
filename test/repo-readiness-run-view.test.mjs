import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { readinessForRun } from '../src/core/repo-readiness/run-view.mjs';
import { engineSources } from '../src/core/repo-readiness/engines.mjs';
import { GEMINI_INSTRUCTION_FILES } from '../src/core/engines/gemini.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

test('engineSources returns the chip\'s files for gemini', () => {
  assert.deepEqual(engineSources('gemini'), { files: GEMINI_INSTRUCTION_FILES, globs: [] });
});

test('readinessForRun judges the run engine and tool-file engines', async () => {
  const dir = tmp('rv-repo-');
  spawnSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'CLAUDE.md'), '# c\n');
  writeFileSync(join(dir, 'GEMINI.md'), '# g\n');
  spawnSync('git', ['-C', dir, 'add', '.']);
  const v = await readinessForRun({ dir, projectKey: 'rv-test', projectDir: dir, runEngine: 'codex' });
  for (const e of ['claude', 'codex', 'gemini']) assert.ok(v.judged.includes(e), `${e} judged`);
  assert.equal(v.engines.length, 8);
  assert.equal(v.labels.claude, 'Claude Code');
  assert.deepEqual(v.sources.gemini.files, GEMINI_INSTRUCTION_FILES);
  assert.equal(v.sources.codex.firstNonEmpty, true);
  assert.ok(v.limits.perFile > 0 && v.limits.total > 0);
  assert.ok(v.report && v.report.engines);
  assert.equal(v.error, undefined);
});

test('readinessForRun on a Folder project runs no git', async () => {
  const dir = tmp('rv-folder-');
  writeFileSync(join(dir, 'CLAUDE.md'), '# c\n');
  const bin = tmp('rv-bin-');
  const marker = join(bin, 'called');
  const shim = join(bin, 'git');
  writeFileSync(shim, `#!/bin/sh\necho called > ${JSON.stringify(marker)}\nexit 1\n`);
  chmodSync(shim, 0o755);
  await withEnv({ PATH: `${bin}:${process.env.PATH}` }, async () => {
    const v = await readinessForRun({ dir, projectKey: 'rv-folder', projectDir: dir, runEngine: 'claude', folder: true });
    assert.ok(v.report);
  });
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(marker), false, 'git was called');
});

// ── the run view judges the tree as the run's teardown will commit it (C1) ──────────────────────────────
const git = (dir, ...args) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
function committedRepo(prefix, files) {
  const dir = tmp(prefix);
  spawnSync('git', ['init', '-q', dir]);
  for (const [p, body] of Object.entries(files)) writeFileSync(join(dir, p), body);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const rowOf = (v, id, engine) => v.report.checks.find((r) => r.id === id && (!engine || r.engine === engine));

test('the run view counts an untracked AGENTS.md as committed: codex has no blocking chip rows', async () => {
  const { chipGate } = await import('../plugins/ai-readiness/scripts/readiness-lib.mjs');
  const dir = committedRepo('rv-agents-', { 'package.json': '{"name":"x","scripts":{"test":"node --test"}}\n', 'package-lock.json': '{}\n' });
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nRun `npm test`.\n');
  const v = await readinessForRun({ dir, projectKey: 'rv-agents', projectDir: dir, runEngine: 'codex' });
  assert.equal(v.error, undefined);
  assert.ok(v.judged.includes('codex'));
  assert.equal(rowOf(v, 'instructions.committed', 'codex').status, 'pass');
  assert.deepEqual(chipGate(v, ['codex']).blocking, []);
  // The run checkout's own index is untouched: AGENTS.md is still untracked there.
  assert.equal(git(dir, 'status', '--porcelain').stdout, '?? AGENTS.md\n');
});

test('the run view reads a test command named only in an untracked AGENTS.md', async () => {
  const dir = committedRepo('rv-cmd-', { 'package.json': '{"name":"x"}\n' });
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nRun the tests with `npm test`.\n');
  const v = await readinessForRun({ dir, projectKey: 'rv-cmd', projectDir: dir, runEngine: 'codex' });
  assert.equal(rowOf(v, 'commands.test').status, 'pass');
});

test('the run view keeps a .gitignored instruction file "not committed"', async () => {
  const dir = committedRepo('rv-ignored-', { '.gitignore': 'AGENTS.md\n', 'package.json': '{"name":"x"}\n' });
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  const v = await readinessForRun({ dir, projectKey: 'rv-ignored', projectDir: dir, runEngine: 'codex' });
  const row = rowOf(v, 'instructions.committed', 'codex');
  assert.equal(row.status, 'fail');
  assert.match(row.detail, /AGENTS\.md not committed/);
});

test('the run view leaves the commit exclusions out of the committed tree', async () => {
  const dir = committedRepo('rv-excl-', { 'package.json': '{"name":"x"}\n' });
  mkdirSync(join(dir, '.agents', 'skills', 'readiness-rubric'), { recursive: true });
  writeFileSync(join(dir, '.agents', 'skills', 'readiness-rubric', 'SKILL.md'), '# rubric\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'secrets.pem'), 'x\n');
  const v = await readinessForRun({ dir, projectKey: 'rv-excl', projectDir: dir, runEngine: 'codex', exclude: ['secrets.pem'] });
  assert.equal(rowOf(v, 'instructions.committed', 'codex').status, 'pass');
  assert.equal(rowOf(v, 'secrets.tracked-names').status, 'pass', 'an excluded path is never committed');
});

test('a partial collection makes the run view unavailable (view.error)', async () => {
  const dir = committedRepo('rv-partial-', { 'package.json': '{"name":"x"}\n' });
  const bin = tmp('rv-slow-');
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" ls-files "*) sleep 3;; esac\nexec ${JSON.stringify(real)} "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  await withEnv({ PATH: `${bin}:${process.env.PATH}` }, async () => {
    const v = await readinessForRun({ dir, projectKey: 'rv-partial', projectDir: dir, runEngine: 'codex', timeoutMs: 1500 });
    assert.match(String(v.error || ''), /could not be collected|timed out/i);
  });
});
