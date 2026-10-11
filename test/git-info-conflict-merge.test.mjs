import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkConflictMerge } from '../src/core/git-info.mjs';

const dir = mkdtempSync(join(tmpdir(), 'conflict-merge-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();
const commit = (file, text, msg) => { writeFileSync(join(dir, file), text); git('add', file); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };

test('checkConflictMerge: the base must be merged, and no added line may be a conflict marker', async () => {
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  commit('a.txt', 'one\n', 'base');
  git('checkout', '-qb', 'feat');
  const head = commit('a.txt', 'feat\n', 'feat');
  git('checkout', '-q', 'main');
  const base = commit('a.txt', 'main\n', 'main moves');
  git('checkout', '-q', 'feat');

  assert.deepEqual(await checkConflictMerge(dir, { baseSha: base, from: head, to: head }), { ok: true, merged: false, markers: [] });

  // A merge committed with its markers still in: merged, but not resolved.
  try { git('merge', '--no-ff', 'main'); } catch { /* conflicts */ }
  git('add', 'a.txt'); git('commit', '-qm', 'merge with markers');
  const bad = await checkConflictMerge(dir, { baseSha: base, from: head, to: git('rev-parse', 'HEAD') });
  assert.equal(bad.merged, true);
  assert.deepEqual(bad.markers.map((m) => m.split(':')[0]), ['a.txt', 'a.txt', 'a.txt']);

  // Resolved (trailing whitespace is no marker).
  const good = commit('a.txt', 'feat and main  \n', 'resolve');
  assert.deepEqual(await checkConflictMerge(dir, { baseSha: base, from: head, to: good }), { ok: true, merged: true, markers: [] });
  assert.equal((await checkConflictMerge(dir, { baseSha: 'nope', from: head, to: good })).ok, false);
});
