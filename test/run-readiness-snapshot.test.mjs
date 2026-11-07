import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { writeReadinessSnapshot } from '../src/core/repo-readiness/snapshot.mjs';
import { getCachedOrEvaluate, readinessSummary } from '../src/core/repo-readiness/cache.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';

useTempHome(after);

const HARNESS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'core', 'run-harness.mjs');

function gitProject() {
  const dir = mkdtempSync(join(tmpdir(), 'proj-'));
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git commit --allow-empty -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function runRootWith(manifest) {
  const runRoot = mkdtempSync(join(tmpdir(), 'run-'));
  writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest));
  return runRoot;
}

describe('writeReadinessSnapshot', () => {
  it('merges readiness into the existing run.json', async () => {
    const runRoot = runRootWith({ pipelineId: 'p1' });
    const projectDir = gitProject();
    try {
      const recorded = await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-a', engine: 'claude' });
      const manifest = await readRunManifest(runRoot);
      assert.equal(manifest.pipelineId, 'p1', 'merge keeps existing manifest data');
      assert.deepEqual(manifest.readiness, recorded);
      assert.equal(manifest.readiness.engine, 'claude');
      assert.equal(typeof manifest.readiness.level, 'string');
      assert.ok(Array.isArray(manifest.readiness.failing));
      assert.equal(manifest.readiness.catalogVersion, 2);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('records the level of the run engine, not the primary one', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    try {
      writeFileSync(join(projectDir, 'AGENTS.md'), '# a');
      execSync('git add -A && git commit -m x -q', { cwd: projectDir, stdio: 'ignore' });
      await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-b', engine: 'codex' });
      assert.equal((await readRunManifest(runRoot)).readiness.engine, 'codex');
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('judges the run engine even when the project marks it Not used, and folds in repository failures', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    try {
      writeFileSync(join(projectDir, 'CLAUDE.md'), '# c');
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, 'package-lock.json'), '{}');
      execSync('git add -A && git commit -m x -q', { cwd: projectDir, stdio: 'ignore' });
      writeProjectSettings({ projectDir, projectKey: 'snap-u' }, { 'readiness.tools': { codex: 'unused' } });
      const r = await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-u', engine: 'codex' });
      assert.equal(r.engine, 'codex');
      assert.equal(r.level, 'not-ready');
      assert.ok(r.failing.includes('instructions.present'));
      assert.ok(r.failing.includes('commands.test'), 'repository failures are part of the run snapshot');
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('a ready tool still records partial when the repository is partial', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    try {
      writeFileSync(join(projectDir, 'CLAUDE.md'), '# c');
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, 'package-lock.json'), '{}');
      execSync('git add -A && git commit -m x -q', { cwd: projectDir, stdio: 'ignore' });
      const r = await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-p', engine: 'claude' });
      assert.equal(r.level, 'partial');
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('applies the project readiness.ignore list from the project settings layer', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    try {
      await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-c', engine: 'claude' });
      const before = (await readRunManifest(runRoot)).readiness.failing;
      assert.ok(before.includes('instructions.present'), 'a bare repo fails instructions.present');
      writeProjectSettings({ projectDir, projectKey: 'snap-c' }, { 'readiness.ignore': ['instructions.present'] });
      await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-c', engine: 'claude' });
      assert.ok(!(await readRunManifest(runRoot)).readiness.failing.includes('instructions.present'));
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('never touches the shared cache entry the Projects chip reads', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    try {
      await getCachedOrEvaluate({ dir: projectDir, projectKey: 'snap-d', ignore: ['instructions.present'] });
      const chip = readinessSummary('snap-d');
      await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-d', engine: 'codex', ignore: [] });
      assert.deepEqual(readinessSummary('snap-d'), chip);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('does not write a snapshot when readiness is disabled', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    const orig = process.env.WORCA_READINESS;
    try {
      process.env.WORCA_READINESS = '0';
      assert.equal(await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-e', engine: 'claude' }), null);
      assert.ok(!(await readRunManifest(runRoot)).readiness);
    } finally {
      if (orig === undefined) delete process.env.WORCA_READINESS; else process.env.WORCA_READINESS = orig;
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('swallows evaluation failures and records nothing', async () => {
    const runRoot = runRootWith({});
    const projectDir = gitProject();
    try {
      // resolve() throws on a non-string dir; an undeclared engine yields no row to record.
      assert.equal(await writeReadinessSnapshot({ runRoot, projectDir: 42, projectKey: 'snap-f', engine: 'claude' }), null);
      assert.equal(await writeReadinessSnapshot({ runRoot, projectDir, projectKey: 'snap-f', engine: 'no-such-engine' }), null);
      assert.ok(!(await readRunManifest(runRoot)).readiness);
      assert.ok(readdirSync(runRoot).includes('run.json'));
      assert.equal(JSON.parse(readFileSync(join(runRoot, 'run.json'), 'utf8')).readiness, undefined);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('run-harness calls it only inside the detached guard of _setupRunRoot, with the run engine', () => {
    const src = readFileSync(HARNESS, 'utf8');
    const setup = src.slice(src.indexOf('async _setupRunRoot('));
    const body = setup.slice(0, setup.indexOf('await this._persist();'));
    const guard = body.indexOf('if (detached) await writeRunManifest(');
    const call = body.indexOf('if (detached) await writeReadinessSnapshot(');
    assert.ok(guard !== -1 && call > guard, 'snapshot follows the Phase-1 manifest write');
    assert.match(body.slice(call), /engine: this\.claude\.engine/);
    assert.ok(!/getCachedOrEvaluate/.test(src), 'the harness never writes the shared readiness cache');
  });
});
