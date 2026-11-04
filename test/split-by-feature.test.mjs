import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dryRun, treeHashOf, planSplit } from '../tools/split-by-feature.mjs';

const REPO = new URL('../', import.meta.url).pathname;
const worktrees = () => execFileSync('git', ['-C', REPO, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
/** The working tree as git would archive it after `git add -A` (tracked + untracked, not ignored), so the test sees
 *  uncommitted changes too. */
const exportWorktree = (dir) => {
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of files) {
    if (!existsSync(join(REPO, f))) continue;                                     // deleted, not yet staged
    mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(join(REPO, f), join(dir, f));
  }
};

test('dry run: same tree hash twice, equivalent, gate passed, second apply 0 files, split-tree tests green, no worktree made', { timeout: 1_200_000 }, () => {
  const wtBefore = worktrees();
  if (planSplit({ root: REPO }).alreadySplit) {                 // the migrated checkout: refused, nothing built
    const s = dryRun({ repo: REPO, exportTree: exportWorktree, tests: 'none' });
    assert.equal(worktrees(), wtBefore);
    assert.equal(s.ok, false); assert.deepEqual(s.problems, ['HEAD is already split (ui/public/parts.json exists)']);
    return;
  }
  const a = dryRun({ repo: REPO, exportTree: exportWorktree });
  const b = dryRun({ repo: REPO, exportTree: exportWorktree, tests: 'none' });
  assert.equal(worktrees(), wtBefore);
  assert.deepEqual(a.problems, []);
  assert.equal(a.ok, true);
  assert.equal(a.treeHash, b.treeHash);
  assert.equal(a.secondApplyChanged, 0);
  assert.equal(a.gate.pass, true);
  assert.deepEqual(a.generatedOverCap, []);
  assert.ok(a.tests.every((t) => t.ok), JSON.stringify(a.tests));
  assert.ok(a.equivalence.probes > 20 && a.equivalence.routes > 400, JSON.stringify(a.equivalence));
  assert.ok(a.acceptedDeltas.every((d) => d.note || ['GET //index.html', 'GET /%69ndex.html'].includes(d.probe)), JSON.stringify(a.acceptedDeltas));
});

test('treeHashOf ignores a hostile git environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'th-'));
  writeFileSync(join(dir, 'a.txt'), 'x\r\ny\n');
  const clean = treeHashOf(dir);
  const cfg = join(mkdtempSync(join(tmpdir(), 'th-cfg-')), 'hostile.gitconfig');
  writeFileSync(cfg, '[core]\n\tautocrlf = true\n');
  assert.equal(treeHashOf(dir, { env: { GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_SYSTEM: cfg, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' } }), clean);
});
