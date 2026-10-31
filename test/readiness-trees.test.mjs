// test/readiness-trees.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from '../tools/readiness/proc.mjs';
import { assemble } from '../src/core/public-assets.mjs';
import { MARKER, cloneAt, hasSplitter, assertScratch, applySplit, treeHash, resetTree, commitMigration, rehearseRollback, servedEquivalence } from '../tools/readiness/trees.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEAD = run('git', ['-C', ROOT, 'rev-parse', 'HEAD']).stdout.trim();
// On the migrated tree (readiness runs this suite there, and dev holds it after freeze day) HEAD is already split and
// the suite runs inside a marked scratch clone; the tests below check those cases instead of failing on them.
const SPLIT = existsSync(join(ROOT, 'ui/public/parts.json'));
const IN_SCRATCH = existsSync(join(ROOT, '.git', MARKER));
const tmp = mkdtempSync(join(tmpdir(), 'readiness-trees-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
// each clone is removed by the test that made it: a full checkout takes ~1 s to delete, which would otherwise run after
// the last test and keep the file's process up outside its tests
const scratch = (t, name) => {
  const d = cloneAt(run, ROOT, HEAD, join(tmp, name)); t.after(() => rmSync(d, { recursive: true, force: true }));
  symlinkSync(join(ROOT, 'node_modules'), join(d, 'node_modules')); return d;
};
const git = (cwd, ...a) => { const r = run('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a]); assert.equal(r.code, 0, r.stderr); };

test('assertScratch refuses an unmarked checkout (this repo, detached or not), a branch checkout and a dirty clone', (t) => {
  if (!IN_SCRATCH) assert.throws(() => assertScratch(run, ROOT), /not a readiness scratch clone/);
  const b = join(tmp, 'on-branch'); mkdirSync(b);
  git(b, 'init', '-q', '-b', 'main'); git(b, 'commit', '-q', '--allow-empty', '-m', 'one');
  writeFileSync(join(b, '.git', MARKER), '');                        // marked, but still on main
  assert.throws(() => assertScratch(run, b), /it is on refs\/heads\/main/);
  const d = scratch(t, 'dirty'); writeFileSync(join(d, 'stray.txt'), 'x');
  assert.throws(() => assertScratch(run, d), /the checkout has changes/);
});

test('two builds on the same commit give the same tree hash; the revert gives back the commit exactly', async (t) => {
  const base = scratch(t, 'base'); const mig = scratch(t, 'mig');
  if (SPLIT) return assert.rejects(applySplit(run, mig), /is already split/);
  const first = await applySplit(run, mig); const h1 = treeHash(run, mig);
  resetTree(run, mig, HEAD);
  await applySplit(run, mig); const h2 = treeHash(run, mig);
  assert.equal(h1, h2);
  assert.ok(first.changed.includes('ui/public/parts.json'));
  assert.ok(!existsSync(join(mig, 'ui/public/style.css')));
  const eq = await servedEquivalence(base, mig, () => [{ method: 'GET', path: '/api/x' }]);  // routes are the parity lister's job
  assert.equal(eq.css, true); assert.equal(eq.html, true);
  const m = commitMigration(run, mig);
  // what a suite or parity run can leave behind: an untracked file and an edited tracked file
  writeFileSync(join(mig, 'leftover.tmp'), 'x'); appendFileSync(join(mig, 'README.md'), '\nedited by a test\n');
  const r = rehearseRollback(run, mig, HEAD, m);
  assert.match(r.cleaned, /leftover\.tmp/); assert.match(r.cleaned, /README\.md/);
  assert.equal(r.diff, ''); assert.equal(r.status, ''); assert.equal(r.ok, true);
  assert.ok(existsSync(join(mig, 'node_modules')));                 // ignored files survive the cleanup
  const again = await applySplit(run, mig, { splitter: base });   // the reverted tree is detached, clean and unsplit; a
  assert.equal(again.changed.length, first.changed.length);       // separate splitter tree (the catch-up recipe's M^)
  assert.equal(treeHash(run, mig), h1);                           // splits it exactly like its own copy
});

test('rehearseRollback fails when the reverted tree is not the given commit', (t) => {
  const d = scratch(t, 'rb-fail');
  appendFileSync(join(d, 'README.md'), '\nlater dev commit\n'); git(d, 'commit', '-qam', 'later');   // a commit between sha and M
  appendFileSync(join(d, 'README.md'), '\nthe "migration"\n'); git(d, 'commit', '-qam', 'migration');
  const m = run('git', ['-C', d, 'rev-parse', 'HEAD']).stdout.trim();
  const r = rehearseRollback(run, d, HEAD, m);
  assert.equal(r.ok, false); assert.match(r.diff, /README\.md/); assert.equal(r.status, '');
});

test('servedEquivalence reports a differing route table with the first differing index, extra trailing routes too', async (ctx) => {
  const base = scratch(ctx, 'eq-a'); const mig = scratch(ctx, 'eq-b');
  if (SPLIT) {                                            // a split base has no monoliths: give it the assembled ones
    for (const [kind, f] of [['css', 'style.css'], ['html', 'index.html']]) writeFileSync(join(base, 'ui/public', f), assemble(kind, f, join(base, 'ui/public')).text);
  }
  const seq = (tables) => { let n = 0; return () => tables[n++]; };
  const r = await servedEquivalence(base, mig, seq([[{ m: 'GET', p: '/a' }, { m: 'GET', p: '/b' }], [{ m: 'GET', p: '/b' }, { m: 'GET', p: '/a' }]]));
  assert.equal(r.routes, false); assert.equal(r.firstDiff.index, 0); assert.equal(r.ok, false);
  const t = await servedEquivalence(base, mig, seq([[{ m: 'GET', p: '/a' }], [{ m: 'GET', p: '/a' }, { m: 'GET', p: '/b' }]]));
  assert.equal(t.routes, false); assert.equal(t.firstDiff.index, 1);
});

test('hasSplitter: true with tools/split-by-feature.mjs, false without it', () => {
  const d = mkdtempSync(join(tmp, 'splitter-'));
  assert.equal(hasSplitter(d), false);
  mkdirSync(join(d, 'tools'), { recursive: true }); writeFileSync(join(d, 'tools/split-by-feature.mjs'), '');
  assert.equal(hasSplitter(d), true);
});
