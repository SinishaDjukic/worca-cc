// test/readiness-open-prs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../tools/readiness/proc.mjs';
import { listTargets, fetchHeads, mergeCheck, actionFor, openPrsProblems, keyOf, branchUrl, ACTIONS } from '../tools/readiness/open-prs.mjs';

const git = (cwd, ...a) => { const r = run('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a]); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); };

test('mergeCheck: clean merge → no conflict; same line changed on both sides → conflict naming the file', () => {
  const d = mkdtempSync(join(tmpdir(), 'readiness-mt-'));
  git(d, 'init', '-q', '-b', 'main'); writeFileSync(join(d, 'a.txt'), 'one\ntwo\n'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'base');
  git(d, 'switch', '-qc', 'x'); writeFileSync(join(d, 'a.txt'), 'ONE\ntwo\n'); git(d, 'commit', '-qam', 'x');
  git(d, 'switch', '-q', 'main'); git(d, 'switch', '-qc', 'y'); writeFileSync(join(d, 'a.txt'), 'uno\ntwo\n'); git(d, 'commit', '-qam', 'y');
  git(d, 'switch', '-q', 'main'); writeFileSync(join(d, 'b.txt'), 'b\n'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'z');
  assert.deepEqual(mergeCheck(run, d, 'main', 'x'), { conflict: false, files: [] });
  assert.deepEqual(mergeCheck(run, d, 'x', 'y'), { conflict: true, files: ['a.txt'] });
  assert.throws(() => mergeCheck(run, d, 'main', 'no-such-ref'), /git merge-tree main no-such-ref: exit/);
});

test('actionFor: express 5 first, then dev conflicts, then split-only conflicts, else none — one action each', () => {
  const c = (dev, split) => ({ dev: { conflict: dev }, split: { conflict: split } });
  assert.equal(actionFor({ title: 'chore(deps): bump express from 4.22.3 to 5.3.0' }, c(true, true)), ACTIONS.express5);
  assert.equal(actionFor({ title: 'feat: x' }, c(true, true)), ACTIONS.dev);
  assert.equal(actionFor({ title: 'feat: x' }, c(false, true)), ACTIONS.split);
  assert.equal(actionFor({ title: 'feat: x' }, c(false, false)), ACTIONS.none);
});

const GH = [
  { number: 1049, title: 'chore(deps): bump express from 4.22.3 to 5.3.0', headRefName: 'dependabot/npm_and_yarn/dev/express-5.3.0', headRefOid: 'a'.repeat(40), url: 'https://github.com/o/r/pull/1049' },
  { number: 1041, title: 'Requirements', headRefName: 'feat/requirements-import', headRefOid: 'b'.repeat(40), url: 'https://github.com/o/r/pull/1041' }];
const fake = (cmd) => cmd === 'gh'
  ? { code: 0, stderr: '', stdout: JSON.stringify(GH) }
  : { code: 0, stderr: '', stdout: `${'a'.repeat(40)}\trefs/heads/dependabot/npm_and_yarn/dev/express-5.3.0\n${'c'.repeat(40)}\trefs/heads/dependabot/docker/old\n` };

test('listTargets: open PRs plus dependabot branches without a PR, each once, PRs by number first', () => {
  const t = listTargets(fake, { repo: 'o/r', remoteUrl: 'git@github.com:o/r.git' });
  assert.deepEqual(t.map((x) => [x.kind, x.number, x.branch]), [
    ['PR', 1041, 'feat/requirements-import'], ['dependabot PR', 1049, 'dependabot/npm_and_yarn/dev/express-5.3.0'],
    ['dependabot branch', null, 'dependabot/docker/old']]);
});

test('openPrsProblems: one row per target with 2 flags and 1 action passes; a missing row, a lost flag or a wrong express action fails', () => {
  const t = listTargets(fake, { repo: 'o/r', remoteUrl: 'git@github.com:o/r.git' });
  const flags = { dev: { conflict: false }, split: { conflict: false } };
  const rows = t.map((x) => ({ ...x, ...flags, action: actionFor(x, flags) }));
  assert.deepEqual(openPrsProblems(t, rows), []);
  assert.match(openPrsProblems(t, rows.slice(1)).join('\n'), /2 rows for 3 targets/);
  assert.match(openPrsProblems(t, [{ ...rows[0], split: {} }, ...rows.slice(1)]).join('\n'), /missing a conflict flag/);
  assert.match(openPrsProblems(t, rows.map((r) => ({ ...r, action: ACTIONS.none }))).join('\n'), /^#1049: express 5 bump must read/m);
});

test('a fork PR named like another PR or a dependabot branch gets its own row, keyed and named by #N', () => {
  const gh = [...GH, { number: 1050, title: 'x', headRefName: 'feat/requirements-import', headRefOid: 'e'.repeat(40), url: 'u', isCrossRepository: true },
    { number: 1051, title: 'y', headRefName: 'dependabot/docker/old', headRefOid: 'f'.repeat(40), url: 'u', isCrossRepository: true }];
  const f = (cmd) => (cmd === 'gh' ? { code: 0, stderr: '', stdout: JSON.stringify(gh) } : fake(cmd));
  const t = listTargets(f, { repo: 'o/r', remoteUrl: 'r' });
  assert.deepEqual(t.map(keyOf), ['#1041', '#1049', '#1050', '#1051', 'dependabot/docker/old']);
  const flags = { dev: { conflict: false }, split: { conflict: false } };
  const rows = t.map((x) => ({ ...x, ...flags, action: actionFor(x, flags) }));
  assert.deepEqual(openPrsProblems(t, rows), []);
  assert.match(openPrsProblems(t, rows.filter((r) => r.number !== 1050)).join('\n'), /^#1050: not exactly one row$/m);
});

test('branchUrl percent-encodes each segment, parentheses included', () => {
  assert.equal(branchUrl('o/r', 'dependabot/a b/(x)#1'), 'https://github.com/o/r/tree/dependabot/a%20b/%28x%29%231');
});

test('fetchHeads makes one fetch of every head into its own ref, none for no targets, and throws on failure', () => {
  const calls = []; const rec = (code) => (cmd, args) => { calls.push([cmd, ...args]); return { code, stdout: '', stderr: 'boom' }; };
  fetchHeads(rec(0), '/c', 'url', []);
  assert.equal(calls.length, 0);
  const t = listTargets(fake, { repo: 'o/r', remoteUrl: 'url' });
  fetchHeads(rec(0), '/c', 'url', t);
  assert.deepEqual(calls[0], ['git', '-C', '/c', 'fetch', '--quiet', '--no-tags', 'url', '+refs/pull/1041/head:refs/readiness/pr/1041',
    '+refs/pull/1049/head:refs/readiness/pr/1049', '+refs/heads/dependabot/docker/old:refs/readiness/branch/dependabot/docker/old']);
  assert.throws(() => fetchHeads(rec(1), '/c', 'url', t), /git fetch of 3 heads failed: boom/);
});

test('fetchHeads: one vanished head fails the joint fetch; a retry per head returns only that one', () => {
  const t = listTargets(fake, { repo: 'o/r', remoteUrl: 'url' });
  const calls = [];
  const r = (cmd, args) => { calls.push(args.slice(6)); return { code: args.some((a) => a.startsWith('+refs/pull/1041/')) ? 1 : 0, stdout: '', stderr: "couldn't find remote ref refs/pull/1041/head" }; };
  assert.deepEqual(fetchHeads(r, '/c', 'url', t).map(keyOf), ['#1041']);
  assert.deepEqual(calls.map((c) => c.length), [3, 1, 1, 1]);
  assert.deepEqual(fetchHeads(() => ({ code: 0, stdout: '', stderr: '' }), '/c', 'url', t), []);
});
