// test/chat-links.test.mjs — chat link roots (issue 1064 §1–§2): resolve, every refusal, open_tab's strict target,
// and the Files tab's reads of a branch root.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatLinks, ChatLinkError, CHAT_LINK_LIMITS, mapLimit, linkRefusal } from '../src/core/chat-links.mjs';

let repo, outside, links, dirRoot, branchRoot;
const sh = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
const put = (rel, text) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text); };

before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'chat-links-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'chat-links-out-')));
  writeFileSync(join(outside, 'secret.txt'), 'x');
  execFileSync('git', ['init', '-q', '-b', 'dev', repo]);
  put('src/a.js', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  put('src/dup/app.js', 'a\n'); put('lib/app.js', 'b\n'); put('uniq.md', '# u\n');
  put('.env', 'K=v\n'); put('keys/id_rsa', 'k\n'); put('.claude/rules/worca/x.md', 'm\n');
  writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 0, 2, 3]));
  symlinkSync(outside, join(repo, 'out'));
  symlinkSync('src/a.js', join(repo, 'inlink'));
  symlinkSync('.env', join(repo, 'envlink'));
  sh('add', '-A'); sh('commit', '-qm', 'base');
  sh('checkout', '-qb', 'feat'); put('src/only-on-branch.js', 'x\ny\n'); sh('add', '-A'); sh('commit', '-qm', 'feat'); sh('checkout', '-q', 'dev');
  links = createChatLinks();
  dirRoot = { kind: 'dir', dir: repo, root: null, member: null, label: 'app' };
  branchRoot = { kind: 'branch', repoDir: repo, ref: 'refs/heads/feat', root: 'run:abcd1234', member: null, label: 'run' };
});
after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

const ASK = ['src/a.js', 'app.js', 'uniq.md', 'src/', 'src/a.js/', 'nope.js', '.env', 'keys/id_rsa', '.claude/rules/worca/x.md',
  'out/secret.txt', 'out', 'inlink', 'envlink', '../x.js', '/etc/hosts', '.git/config', 'bin.dat'];

test('folder root: files, folders, a unique bare name; every refusal is plain {ok:false}', async () => {
  const r = await links.resolve([dirRoot], ASK);
  assert.deepEqual(r['src/a.js'], { ok: true, path: 'src/a.js', type: 'file', lines: 10 });
  assert.deepEqual(r['uniq.md'], { ok: true, path: 'uniq.md', type: 'file', lines: 1 });
  assert.deepEqual(r['src/'], { ok: true, path: 'src', type: 'dir' });
  assert.deepEqual(r.inlink, { ok: true, path: 'inlink', type: 'file', lines: 10 });
  assert.deepEqual(r['bin.dat'], { ok: true, path: 'bin.dat', type: 'file' });
  for (const k of ['app.js', 'src/a.js/', 'nope.js', '.env', 'keys/id_rsa', '.claude/rules/worca/x.md', 'out/secret.txt', 'out', 'envlink', '../x.js', '/etc/hosts', '.git/config']) {
    assert.deepEqual(r[k], { ok: false }, k);
  }
});

test('branch root: a file only on the branch resolves; links are refused there', async () => {
  const r = await links.resolve([branchRoot], ['src/only-on-branch.js', 'src/a.js', 'inlink', 'out', '.env', 'src/', 'uniq.md']);
  assert.deepEqual(r['src/only-on-branch.js'], { ok: true, path: 'src/only-on-branch.js', type: 'file', lines: 2 });
  assert.deepEqual(r['src/a.js'], { ok: true, path: 'src/a.js', type: 'file', lines: 10 });
  assert.deepEqual(r['src/'], { ok: true, path: 'src', type: 'dir' });
  for (const k of ['inlink', 'out', '.env']) assert.deepEqual(r[k], { ok: false }, k);
  const gone = await links.resolve([{ ...branchRoot, ref: 'refs/heads/nope' }], ['src/a.js']);
  assert.deepEqual(gone['src/a.js'], { ok: false });
});

test('workspace roots: the first member that has the path answers, with its member', async () => {
  const r = await links.resolve([{ ...dirRoot, dir: outside, member: 'other' }, { ...dirRoot, member: 'app' }], ['src/a.js']);
  assert.deepEqual(r['src/a.js'], { ok: true, path: 'src/a.js', type: 'file', lines: 10, member: 'app' });
});

const code = async (p, c) => { await assert.rejects(p, (e) => e instanceof ChatLinkError && e.code === c); };

test('target: strict errors for open_tab', async () => {
  assert.deepEqual(await links.target([dirRoot], { path: 'src/a.js', line: 3, endLine: 5 }), { path: 'src/a.js', type: 'file', line: 3, endLine: 5, root: null });
  assert.deepEqual(await links.target([dirRoot], { path: 'uniq.md' }), { path: 'uniq.md', type: 'file', root: null });
  assert.deepEqual(await links.target([branchRoot], { path: 'src/only-on-branch.js', line: 2 }), { path: 'src/only-on-branch.js', type: 'file', line: 2, root: 'run:abcd1234' });
  await code(links.target([dirRoot], { path: 'src/a.js', line: 11 }), 'BAD_LINE');
  await code(links.target([dirRoot], { path: 'src/a.js', line: 2, endLine: 1 }), 'BAD_LINE');
  await code(links.target([dirRoot], { path: 'src/a.js', endLine: 4 }), 'BAD_LINE');
  await code(links.target([dirRoot], { path: 'src/a.js', line: 1.5 }), 'BAD_LINE');
  await code(links.target([dirRoot], { path: 'src', line: 1 }), 'BAD_LINE');
  await code(links.target([dirRoot], { path: 'bin.dat', line: 1 }), 'BAD_LINE');
  await code(links.target([dirRoot], { path: 'nope.js' }), 'NOT_FOUND');
  await code(links.target([dirRoot], { path: 'app.js' }), 'NOT_FOUND');      // two app.js, none at the top
  await code(links.target([dirRoot], { path: '.env' }), 'REFUSED');
  await code(links.target([dirRoot], { path: 'out/secret.txt' }), 'REFUSED');
  await code(links.target([dirRoot], { path: '/etc/hosts' }), 'BAD_PATH');
  await code(links.target([dirRoot], { path: '../x' }), 'BAD_PATH');
});

test('branch reads for the Files tab: list, read, openRaw, TOO_LARGE', async () => {
  const l = await links.list(branchRoot, 'src');
  assert.deepEqual(l.entries.map((e) => [e.name, e.type]), [['dup', 'dir'], ['a.js', 'file'], ['only-on-branch.js', 'file']]);
  assert.equal((await links.list(branchRoot, '')).entries.find((e) => e.name === 'inlink').type, 'link');
  const f = await links.read(branchRoot, 'src/only-on-branch.js');
  assert.deepEqual({ ...f }, { path: 'src/only-on-branch.js', size: 4, shown: 4, truncated: false, binary: false, text: 'x\ny\n' });
  const { fh, cleanup } = await links.openRaw(branchRoot, 'src/only-on-branch.js');
  try { assert.equal((await fh.readFile('utf8')), 'x\ny\n'); } finally { await fh.close(); cleanup(); }
  const tiny = createChatLinks({ limits: { scanBytes: 1, listMax: 10, listTreeBytes: 1 << 20, cacheMs: 0, blobMax: 2, gitTimeoutMs: 5000 } });
  await code(tiny.openRaw(branchRoot, 'src/only-on-branch.js'), 'TOO_LARGE');
  // a branch root never serves a refused file (.env and worca's own files are committed on the fixture's branch)
  await code(links.read(branchRoot, '.env'), 'REFUSED');
  await code(links.openRaw(branchRoot, '.claude/rules/worca/x.md'), 'REFUSED');
});

test('linkRefusal: credential files the show_files rule misses outside the home (v3)', () => {
  for (const p of ['.claude/.credentials.json', '.claude/settings.local.json', 'conf/.htpasswd', 'deploy/gcp-service-account.json']) {
    assert.ok(linkRefusal(p), p);
  }
  for (const p of ['src/a.js', 'README.md', '.claude/settings.json']) assert.ok(!linkRefusal(p), p);
});

test('a binary branch blob reaches the raw handle byte-exact (why readBlobHead is not runGitCapture)', async () => {
  const { fh, cleanup } = await links.openRaw({ ...branchRoot, ref: 'refs/heads/dev' }, 'bin.dat');
  try { assert.deepEqual([...(await fh.readFile())], [1, 0, 2, 3]); } finally { await fh.close(); cleanup(); }
});

test('resolve checks at most resolveConcurrency paths at once (review minor 8)', async () => {
  let now = 0, peak = 0;
  const traced = createChatLinks({ limits: { ...CHAT_LINK_LIMITS, resolveConcurrency: 2 },
    trace: (ev) => { now += ev === 'start' ? 1 : -1; peak = Math.max(peak, now); } });
  const r = await traced.resolve([dirRoot], ['src/a.js', 'uniq.md', 'bin.dat', 'src/', 'nope.js', 'lib/app.js']);
  assert.equal(r['lib/app.js'].ok, true);
  assert.equal(peak, 2);
  assert.equal(now, 0);
});

test('mapLimit keeps order and the bound', async () => {
  let live = 0, peak = 0;
  const out = await mapLimit([5, 1, 3, 2], 2, async (x) => { live += 1; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, x)); live -= 1; return x * 10; });
  assert.deepEqual(out, [50, 10, 30, 20]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});
