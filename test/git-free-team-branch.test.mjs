// test/git-free-team-branch.test.mjs — worca-metrics / worca-policy branch reads and writes over the GitHub API (P6 Task 8).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, chmodSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, posix } from 'node:path';
import { repoOfSlug, lsRemoteHttps, readBranchFile, createOrphanBranch, commitFiles, syncSnapshot, _testing as branchTesting } from '../src/core/git-free/team-branch.mjs';
import { ARCHIVE_LIMITS } from '../src/core/git-free/archive.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { BITBUCKET_NEEDS_GIT } from '../src/core/git-available.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
const POSIX = process.platform !== 'win32';
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
after(() => { ghTesting.reset(); gh.close(); });
const R = '.worca-metrics/runs/2026';

test('repoOfSlug: a two-segment slug is GitHub; host slugs are not', () => {
  assert.deepEqual(repoOfSlug('acme/billing'), { owner: 'acme', repo: 'billing' });
  for (const s of ['gitlab.com/acme/billing', 'dev.azure.com/o/p/r', 'billing', '']) assert.equal(repoOfSlug(s), null, s);
});

test('lsRemoteHttps answers in git ls-remote\'s shape; readBranchFile reads one file at a commit', async () => {
  gh.repo('acme/ls', { files: { a: '1' } });
  const head = gh.commit('acme/ls', { branch: 'worca-metrics', orphan: true, files: { 'README.md': 'r\n', ...(POSIX ? { 'l.json': { link: 'README.md' } } : {}) } });
  assert.deepEqual(await lsRemoteHttps('acme/ls', 'worca-metrics'), { ok: true, stdout: `${head}\trefs/heads/worca-metrics\n`, stderr: '' });
  assert.deepEqual(await lsRemoteHttps('acme/ls', 'worca-policy'), { ok: true, stdout: '', stderr: '' });
  assert.deepEqual(await withEnv(NO_CREDS, () => lsRemoteHttps('acme/missing', 'worca-metrics')),
    { ok: false, stdout: '', stderr: 'not found on GitHub: acme/missing (a private repository needs GH_TOKEN)' });
  assert.deepEqual(await lsRemoteHttps('gitlab.com/acme/x', 'worca-metrics'), { ok: false, stdout: '', stderr: 'git is not installed on this machine' });
  assert.deepEqual(await lsRemoteHttps('bitbucket.org/acme/x', 'worca-metrics'), { ok: false, stdout: '', stderr: BITBUCKET_NEEDS_GIT });
  assert.deepEqual(await readBranchFile('acme/ls', head, 'README.md'), { ok: true, text: 'r\n' });
  assert.deepEqual(await readBranchFile('acme/ls', head, 'nope.json'), { ok: true, text: null });
  if (POSIX) assert.deepEqual(await readBranchFile('acme/ls', head, 'l.json'), { ok: true, text: 'README.md' });
});

test('createOrphanBranch: one parentless commit by Worca holding exactly the files; an existing branch is reported, never overwritten', async () => {
  gh.repo('acme/orph', { files: { a: '1' } });
  const r = await createOrphanBranch('acme/orph', 'worca-metrics', { files: { 'README.md': 'r\n', '.worca-metrics/config.json': '{"schema":1}\n' }, message: 'metrics: enable team metrics' });
  assert.equal(r.ok, true);
  assert.equal(gh.sha('acme/orph', 'worca-metrics'), r.sha);
  assert.equal(gh.git('acme/orph', 'rev-list', '--count', 'worca-metrics'), '1');
  assert.equal(gh.git('acme/orph', 'ls-tree', '-r', '--name-only', 'worca-metrics'), '.worca-metrics/config.json\nREADME.md');
  assert.equal(gh.git('acme/orph', 'log', '-1', '--format=%an <%ae>|%s', 'worca-metrics'), 'Worca <worca@local>|metrics: enable team metrics');
  assert.deepEqual(await createOrphanBranch('acme/orph', 'worca-metrics', { files: { 'README.md': 'x' }, message: 'm' }), { ok: false, exists: true });
  assert.equal(gh.show('acme/orph', 'worca-metrics', 'README.md'), 'r\n');
});

test('commitFiles: on top of the parent; nothing new → unchanged and no commit; a teammate in between → conflict; protection → its message', async () => {
  gh.repo('acme/cf', { files: { a: '1' } });
  const p1 = gh.commit('acme/cf', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n' } });
  const r1 = await commitFiles('acme/cf', 'worca-metrics', { parent: p1, files: { [`${R}/09/b.jsonl`]: 'B\n' }, message: 'metrics: 1 run(s)' });
  assert.deepEqual([r1.ok, r1.unchanged, gh.sha('acme/cf', 'worca-metrics')], [true, false, r1.sha]);
  assert.equal(gh.git('acme/cf', 'ls-tree', '-r', '--name-only', 'worca-metrics'), `${R}/09/a.jsonl\n${R}/09/b.jsonl`);
  const n = gh.calls.length;
  assert.deepEqual(await commitFiles('acme/cf', 'worca-metrics', { parent: r1.sha, files: { [`${R}/09/b.jsonl`]: 'B\n' }, message: 'm' }), { ok: true, sha: r1.sha, unchanged: true });
  assert.equal(gh.calls.slice(n).some((c) => c.method === 'POST' && c.path.endsWith('/git/commits')), false);
  gh.beforeRefUpdate(() => gh.commit('acme/cf', { branch: 'worca-metrics', files: { [`${R}/09/t.jsonl`]: 'T\n' } }));
  const r3 = await commitFiles('acme/cf', 'worca-metrics', { parent: r1.sha, files: { [`${R}/09/c.jsonl`]: 'C\n' }, message: 'm' });
  assert.deepEqual([r3.ok, r3.conflict], [false, true]);
  gh.protect('acme/cf', 'worca-metrics');
  const r4 = await commitFiles('acme/cf', 'worca-metrics', { parent: gh.sha('acme/cf', 'worca-metrics'), files: { [`${R}/09/d.jsonl`]: 'D\n' }, message: 'm' });
  assert.deepEqual(r4, { ok: false, stderr: 'GitHub (HTTP 422): Protected branch update failed for refs/heads/worca-metrics.' });
});

test('syncSnapshot: a full download first, then only what changed; keep() decides what lands; no symlink is ever written', async () => {
  gh.repo('acme/snap', { files: { a: '1' } });
  gh.commit('acme/snap', { branch: 'worca-metrics', orphan: true, files: { 'README.md': 'r\n', [`${R}/09/a.jsonl`]: 'A\n', 'junk/x': 'j',
    ...(POSIX ? { [`${R}/09/l.jsonl`]: { link: '/etc/hosts' } } : {}) } });
  const dir = join(mkdtempSync(join(tmpdir(), 'worca-gf-snap-')), 'acme~snap');
  const keep = (p) => p === 'README.md' || p.startsWith('.worca-metrics/');
  const s1 = await syncSnapshot('acme/snap', 'worca-metrics', dir, { keep });
  assert.deepEqual([s1.ok, s1.changed], [true, true]);
  assert.equal(readFileSync(join(dir, '.worca-metrics', 'runs', '2026', '09', 'a.jsonl'), 'utf8'), 'A\n');
  assert.deepEqual([existsSync(join(dir, 'junk')), existsSync(join(dir, '.worca-metrics', 'runs', '2026', '09', 'l.jsonl'))], [false, false]);
  assert.deepEqual(await syncSnapshot('acme/snap', 'worca-metrics', dir, { keep }), { ok: true, sha: s1.sha, changed: false, stderr: '' });
  gh.commit('acme/snap', { branch: 'worca-metrics', files: { [`${R}/10/b.jsonl`]: 'B\n' } });
  const n = gh.calls.length;
  assert.equal((await syncSnapshot('acme/snap', 'worca-metrics', dir, { keep })).changed, true);
  assert.equal(readFileSync(join(dir, '.worca-metrics', 'runs', '2026', '10', 'b.jsonl'), 'utf8'), 'B\n');
  assert.deepEqual(gh.calls.slice(n).map((c) => c.path.replace(/[0-9a-f]{40}/g, '<sha>')),
    ['/repos/acme/snap/git/ref/heads/worca-metrics', '/repos/acme/snap/compare/<sha>...<sha>', `/repos/acme/snap/contents/${R}/10/b.jsonl`]);
  gh.commit('acme/snap', { branch: 'worca-metrics', orphan: true, files: { [`${R}/11/c.jsonl`]: 'C\n' } });
  assert.equal((await syncSnapshot('acme/snap', 'worca-metrics', dir, { keep })).changed, true);
  assert.equal(existsSync(join(dir, '.worca-metrics', 'runs', '2026', '09', 'a.jsonl')), false);
  assert.equal(gh.calls.at(-1).path.includes('/tarball/'), true);
  assert.deepEqual(await syncSnapshot('acme/snap', 'nope', dir, { keep }), { ok: false, sha: null, changed: false, stderr: "couldn't find remote ref refs/heads/nope" });
});

test('syncSnapshot incrementally removes a deleted file and never writes an unkept one', async () => {
  const { bare } = gh.repo('acme/incr', { files: { a: '1' } });
  gh.commit('acme/incr', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n', [`${R}/09/b.jsonl`]: 'B\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-incr-'));
  try {
    const dir = join(root, 'acme~incr');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/incr', 'worca-metrics', dir, { keep });
    const g = (args, env = {}) => execFileSync('git', ['--git-dir', bare, ...args], { env: { ...process.env, ...env } }).toString().trim();
    const idx = { GIT_INDEX_FILE: `${dir}.idx`, GIT_WORK_TREE: dirname(dir) };
    const head = g(['rev-parse', 'refs/heads/worca-metrics']);
    g(['read-tree', head], idx);
    g(['update-index', '--force-remove', `${R}/09/a.jsonl`], idx);
    const c = g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', g(['write-tree'], idx), '-p', head, '-m', 'rm'], idx);
    g(['update-ref', 'refs/heads/worca-metrics', c]);
    gh.commit('acme/incr', { branch: 'worca-metrics', files: { 'junk/y': 'j' } });
    const n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/incr', 'worca-metrics', dir, { keep })).changed, true);
    assert.equal(gh.calls.slice(n).some((x) => x.path.includes('/tarball/')), false, 'incremental, not a full download');
    assert.deepEqual([existsSync(join(dir, ...`${R}/09/a.jsonl`.split('/'))), existsSync(join(dir, ...`${R}/09/b.jsonl`.split('/'))), existsSync(join(dir, 'junk'))],
      [false, true, false]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: past 20 changed files one archive replaces the per-file reads; a replace that fails leaves no commit record', async () => {
  gh.repo('acme/many', { files: { a: '1' } });
  gh.commit('acme/many', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-snap-'));
  const dir = join(root, 'acme~many');
  try {
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/many', 'worca-metrics', dir, { keep });
    const kinds = (from) => gh.calls.slice(from).map((c) => c.path.split('/')[4]);
    const twenty = {};
    for (let i = 0; i < 20; i++) twenty[`${R}/10/r${i}.jsonl`] = `${i}\n`;
    gh.commit('acme/many', { branch: 'worca-metrics', files: twenty });
    let n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/many', 'worca-metrics', dir, { keep })).changed, true);
    assert.deepEqual(kinds(n), ['git', 'compare', ...Array(20).fill('contents')]);
    gh.commit('acme/many', { branch: 'worca-metrics', files: { ...Object.fromEntries(Object.keys(twenty).map((p) => [p, 'x\n'])), [`${R}/10/r20.jsonl`]: '20\n' } });
    n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/many', 'worca-metrics', dir, { keep })).changed, true);
    assert.deepEqual(kinds(n), ['git', 'compare', 'tarball']);
    assert.equal(readFileSync(join(dir, ...`${R}/10/r20.jsonl`.split('/')), 'utf8'), '20\n');
    if (!POSIX) return;
    const locked = join(dir, '.worca-metrics', 'runs', '2026', '09');
    gh.commit('acme/many', { branch: 'worca-metrics', files: { [`${R}/11/b.jsonl`]: 'B\n' } });
    gh.failOnce(500, null, { match: '/compare/' });   // the full path; its folder cannot be emptied (stands in for Windows EBUSY)
    chmodSync(locked, 0o555);
    let r;
    try { r = await syncSnapshot('acme/many', 'worca-metrics', dir, { keep }); } finally { chmodSync(locked, 0o755); }
    assert.deepEqual([r.ok, existsSync(`${dir}@sha`)], [false, false]);
    n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/many', 'worca-metrics', dir, { keep })).ok, true);
    assert.deepEqual(kinds(n), ['git', 'tarball']);
    assert.deepEqual([`${R}/09/a.jsonl`, `${R}/11/b.jsonl`].map((p) => readFileSync(join(dir, ...p.split('/')), 'utf8')), ['A\n', 'B\n']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('lsRemoteHttps and readBranchFile take a per-request timeout (a run start bounds its discovery)', { timeout: 5_000 }, async () => {
  gh.repo('acme/slowls', { files: { a: '1' } });
  const head = gh.commit('acme/slowls', { branch: 'worca-policy', orphan: true, files: { 'p.json': '{}' } });
  // Never answers those reads until the signal aborts (3 s at most, so a failure ends the test). The 3 s timer also stands in
  // for the socket a real fetch holds open: AbortSignal.timeout's own timer is unref'd, and without a ref'd handle Node 22
  // finds the event loop empty and cancels this test and every later one in the file.
  ghTesting.setFetch((url, init) => (/\/git\/ref\/heads\/|\/contents\//.test(new URL(url).pathname)
    ? new Promise((_, reject) => { const tm = setTimeout(() => reject(new Error('hung')), 3_000); init.signal.addEventListener('abort', () => { clearTimeout(tm); reject(init.signal.reason); }); })
    : gh.fetch(url, init)));
  try {
    const t0 = Date.now();
    assert.deepEqual(await lsRemoteHttps('acme/slowls', 'worca-policy', { timeoutMs: 50 }), { ok: false, stdout: '', stderr: 'GitHub unreachable (timeout)' });
    assert.deepEqual(await readBranchFile('acme/slowls', head, 'p.json', { timeoutMs: 50 }), { ok: false, stderr: 'GitHub unreachable (timeout)' });
    assert.ok(Date.now() - t0 < 2_000);
  } finally { ghTesting.setFetch(gh.fetch); }
});

test('syncSnapshot: a repository named <x>.sha keeps its own commit record beside <x>\'s', async () => {
  for (const [slug, f] of [['acme/b', 'b'], ['acme/b.sha', 's']]) {
    gh.repo(slug, { files: { a: '1' } });
    gh.commit(slug, { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/${f}.jsonl`]: `${f}\n` } });
  }
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-ns-'));
  try {
    const keep = (p) => p.startsWith('.worca-metrics/');
    const round = async () => [await syncSnapshot('acme/b', 'worca-metrics', join(root, 'acme~b'), { keep }), await syncSnapshot('acme/b.sha', 'worca-metrics', join(root, 'acme~b.sha'), { keep })]
      .map((r) => [r.ok, r.changed, r.stderr]);
    assert.deepEqual(await round(), [[true, true, ''], [true, true, '']]);
    const n = gh.calls.length;
    assert.deepEqual(await round(), [[true, false, ''], [true, false, '']]);
    assert.equal(gh.calls.slice(n).some((c) => c.path.includes('/tarball/')), false);
    assert.deepEqual(['b', 's'].map((f, i) => readFileSync(join(root, ['acme~b', 'acme~b.sha'][i], ...`${R}/09/${f}.jsonl`.split('/')), 'utf8')), ['b\n', 's\n']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: a local error applying an update (a kept folder that became a file) is repaired by one full download', async () => {
  gh.repo('acme/dirfile', { files: { a: '1' } });
  gh.commit('acme/dirfile', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n', '.worca-metrics/x/k.json': '{}' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-df-'));
  try {
    const dir = join(root, 'acme~dirfile');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/dirfile', 'worca-metrics', dir, { keep });
    gh.commit('acme/dirfile', { branch: 'worca-metrics', files: { '.worca-metrics/x/k.json': null, '.worca-metrics/x': 'now a file' } });
    const n = gh.calls.length;
    const s2 = await syncSnapshot('acme/dirfile', 'worca-metrics', dir, { keep });
    assert.deepEqual([s2.ok, s2.changed, s2.stderr], [true, true, '']);
    assert.equal(gh.calls.slice(n).at(-1).path.includes('/tarball/'), true);
    assert.deepEqual([statSync(join(dir, '.worca-metrics', 'x')).isFile(), readFileSync(join(dir, '.worca-metrics', 'x'), 'utf8')], [true, 'now a file']);
    gh.commit('acme/dirfile', { branch: 'worca-metrics', files: { [`${R}/10/b.jsonl`]: 'B\n' } });
    assert.equal((await syncSnapshot('acme/dirfile', 'worca-metrics', dir, { keep })).ok, true);
    assert.equal(readFileSync(join(dir, ...`${R}/10/b.jsonl`.split('/')), 'utf8'), 'B\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** All files under `d` (relative, sorted) with their text. */
const tree = (d) => readdirSync(d, { recursive: true }).map(String).filter((p) => statSync(join(d, p)).isFile()).sort().map((p) => [p, readFileSync(join(d, p), 'utf8')]);

test('syncSnapshot: a record that is a symlink is never written, though GitHub\'s contents API answers the file it names', { skip: !POSIX }, async () => {
  gh.repo('acme/ghlink', { files: { a: '1' } });
  gh.commit('acme/ghlink', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n', [`${R}/09/b.jsonl`]: 'B\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-ln-'));
  // GitHub follows a link whose target is in the repository: the target's answer, under the target's own path.
  ghTesting.setFetch(async (url, init) => {
    const u = new URL(url);
    const m = /^\/repos\/acme\/ghlink\/contents\/(.+)$/.exec(u.pathname);
    const path = m && decodeURIComponent(m[1]);
    if (!m || gh.git('acme/ghlink', 'ls-tree', u.searchParams.get('ref'), '--', path).split(' ')[0] !== '120000') return gh.fetch(url, init);
    const target = posix.join(posix.dirname(path), gh.show('acme/ghlink', u.searchParams.get('ref'), path));
    return gh.fetch(`${u.origin}/repos/acme/ghlink/contents/${target.split('/').map(encodeURIComponent).join('/')}${u.search}`, init);
  });
  try {
    const keep = (p) => p.startsWith('.worca-metrics/');
    const dir = join(root, 'acme~ghlink');
    await syncSnapshot('acme/ghlink', 'worca-metrics', dir, { keep });
    gh.commit('acme/ghlink', { branch: 'worca-metrics', files: { [`${R}/09/l.jsonl`]: { link: 'a.jsonl' }, [`${R}/09/b.jsonl`]: { link: 'a.jsonl' }, [`${R}/10/c.jsonl`]: 'C\n' } });
    const n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/ghlink', 'worca-metrics', dir, { keep })).changed, true);
    assert.equal(gh.calls.slice(n).some((c) => c.path.includes('/tarball/')), false, 'incremental');
    const full = join(root, 'full');
    await syncSnapshot('acme/ghlink', 'worca-metrics', full, { keep });
    assert.deepEqual(tree(dir), tree(full));
    assert.deepEqual(tree(dir).map(([p]) => p.split(/[\\/]/).at(-1)), ['a.jsonl', 'c.jsonl']);
  } finally { ghTesting.setFetch(gh.fetch); rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: a branch force-pushed from an older base (GitHub\'s three-dot compare, "diverged") is downloaded whole', async () => {
  gh.repo('acme/div', { files: { a: '1' } });
  const base = gh.commit('acme/div', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n' } });
  gh.commit('acme/div', { branch: 'worca-metrics', files: { [`${R}/09/bad.jsonl`]: 'BAD\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-div-'));
  // GitHub compares merge-base(A, B)...B (the fake diffs A..B): the files of the rewrite only, with the real status.
  ghTesting.setFetch(async (url, init) => {
    const m = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(new URL(url).pathname);
    if (!m) return gh.fetch(url, init);
    const real = await (await gh.fetch(url, init)).json();
    const three = await (await gh.fetch(url.replace(`${m[1]}...`, `${gh.git('acme/div', 'merge-base', m[1], m[2])}...`), init)).json();
    return new Response(JSON.stringify({ ...three, status: real.status }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const dir = join(root, 'acme~div');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/div', 'worca-metrics', dir, { keep });
    assert.equal(existsSync(join(dir, ...`${R}/09/bad.jsonl`.split('/'))), true);
    gh.git('acme/div', 'update-ref', 'refs/heads/worca-metrics', gh.commit('acme/div', { branch: 'rewrite', from: base, files: { [`${R}/09/c.jsonl`]: 'C\n' } }));
    const n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/div', 'worca-metrics', dir, { keep })).ok, true);
    assert.equal(gh.calls.slice(n).at(-1).path.includes('/tarball/'), true);
    assert.deepEqual(tree(dir).map(([p]) => p.split(/[\\/]/).at(-1)), ['a.jsonl', 'c.jsonl']);
  } finally { ghTesting.setFetch(gh.fetch); rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: a renamed record loses its old path; ref, compare and one contents read', async () => {
  gh.repo('acme/ren', { files: { a: '1' } });
  gh.commit('acme/ren', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A-unique-content-long-enough\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-ren-'));
  try {
    const dir = join(root, 'acme~ren');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/ren', 'worca-metrics', dir, { keep });
    gh.commit('acme/ren', { branch: 'worca-metrics', files: { [`${R}/09/a.jsonl`]: null, [`${R}/10/a.jsonl`]: 'A-unique-content-long-enough\n' } });
    const n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/ren', 'worca-metrics', dir, { keep })).changed, true);
    assert.deepEqual(gh.calls.slice(n).map((c) => c.path.split('/')[4]), ['git', 'compare', 'contents']);
    assert.deepEqual(tree(dir), [[join('.worca-metrics', 'runs', '2026', '10', 'a.jsonl'), 'A-unique-content-long-enough\n']]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: a compare of 300 files is downloaded whole, though only one of them is kept', async () => {
  gh.repo('acme/cap300', { files: { a: '1' } });
  gh.commit('acme/cap300', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-cap-'));
  // One commit of 300 files, 299 of them outside .worca-metrics/ (listed in the answer, as GitHub lists them).
  ghTesting.setFetch(async (url, init) => {
    if (!/\/compare\//.test(new URL(url).pathname)) return gh.fetch(url, init);
    const j = await (await gh.fetch(url, init)).json();
    const junk = Array.from({ length: 299 }, (_, i) => ({ filename: `junk/u${i}.txt`, status: 'added' }));
    return new Response(JSON.stringify({ ...j, files: [...j.files, ...junk] }), { status: 200 });
  });
  try {
    const dir = join(root, 'acme~cap300');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/cap300', 'worca-metrics', dir, { keep });
    gh.commit('acme/cap300', { branch: 'worca-metrics', files: { [`${R}/10/k.jsonl`]: 'K\n' } });
    const n = gh.calls.length;
    assert.equal((await syncSnapshot('acme/cap300', 'worca-metrics', dir, { keep })).changed, true);
    assert.deepEqual(gh.calls.slice(n).map((c) => c.path.split('/')[4]), ['git', 'compare', 'tarball']);
    assert.equal(readFileSync(join(dir, ...`${R}/10/k.jsonl`.split('/')), 'utf8'), 'K\n');
  } finally { ghTesting.setFetch(gh.fetch); rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: an unsafe file name in a compare answer writes nothing outside the snapshot', async () => {
  gh.repo('acme/esc', { files: { a: '1' } });
  gh.commit('acme/esc', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-esc-'));
  const bad = '.worca-metrics/../../esc.jsonl';
  ghTesting.setFetch(async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('esc.jsonl')) return new Response(JSON.stringify({ type: 'file', path: bad, encoding: 'base64', content: Buffer.from('X\n').toString('base64') }), { status: 200 });
    if (!/\/compare\//.test(u.pathname)) return gh.fetch(url, init);
    const j = await (await gh.fetch(url, init)).json();
    return new Response(JSON.stringify({ ...j, files: [{ filename: bad, status: 'added' }, ...j.files] }), { status: 200 });
  });
  try {
    const dir = join(root, 'snap', 'acme~esc');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/esc', 'worca-metrics', dir, { keep });
    gh.commit('acme/esc', { branch: 'worca-metrics', files: { [`${R}/10/b.jsonl`]: 'B\n' } });
    assert.equal((await syncSnapshot('acme/esc', 'worca-metrics', dir, { keep })).changed, true);
    assert.deepEqual([existsSync(join(root, 'esc.jsonl')), existsSync(join(root, 'snap', 'esc.jsonl')), readFileSync(join(dir, ...`${R}/10/b.jsonl`.split('/')), 'utf8')], [false, false, 'B\n']);
  } finally { ghTesting.setFetch(gh.fetch); rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: GitHub failing during an update is reported, never answered by a full download', async () => {
  gh.repo('acme/ghfail', { files: { a: '1' } });
  gh.commit('acme/ghfail', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-ghf-'));
  try {
    const dir = join(root, 'acme~ghfail');
    const keep = (p) => p.startsWith('.worca-metrics/');
    const s1 = await syncSnapshot('acme/ghfail', 'worca-metrics', dir, { keep });
    gh.commit('acme/ghfail', { branch: 'worca-metrics', files: { [`${R}/10/b.jsonl`]: 'B\n' } });
    gh.failOnce(500, null, { match: '/contents/' });
    const n = gh.calls.length;
    assert.deepEqual(await syncSnapshot('acme/ghfail', 'worca-metrics', dir, { keep }), { ok: false, sha: null, changed: false, stderr: 'GitHub (HTTP 500)' });
    assert.deepEqual([gh.calls.slice(n).some((c) => c.path.includes('/tarball/')), readFileSync(`${dir}@sha`, 'utf8').trim()], [false, s1.sha]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: GitHub failing half-way through an update leaves the copy at its commit; a later commit restoring files reads right', async () => {
  gh.repo('acme/half', { files: { a: '1' } });
  gh.commit('acme/half', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A0\n', [`${R}/09/d.jsonl`]: 'D0\n', [`${R}/09/z.jsonl`]: 'Z0\n' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-half-'));
  try {
    const dir = join(root, 'acme~half');
    const keep = (p) => p.startsWith('.worca-metrics/');
    const s1 = await syncSnapshot('acme/half', 'worca-metrics', dir, { keep });
    const before = tree(dir);
    // a changed, d removed, z changed — GitHub fails the read of z, after a's
    gh.commit('acme/half', { branch: 'worca-metrics', files: { [`${R}/09/a.jsonl`]: 'A1\n', [`${R}/09/d.jsonl`]: null, [`${R}/09/z.jsonl`]: 'Z1\n' } });
    gh.failOnce(500, null, { match: `/contents/${R}/09/z.jsonl` });
    assert.equal((await syncSnapshot('acme/half', 'worca-metrics', dir, { keep })).ok, false);
    assert.deepEqual([tree(dir), readFileSync(`${dir}@sha`, 'utf8').trim()], [before, s1.sha]);
    // a and d back to their first content: since the copy's commit only z changed
    gh.commit('acme/half', { branch: 'worca-metrics', files: { [`${R}/09/a.jsonl`]: 'A0\n', [`${R}/09/d.jsonl`]: 'D0\n' } });
    assert.equal((await syncSnapshot('acme/half', 'worca-metrics', dir, { keep })).ok, true);
    const full = join(root, 'full');
    await syncSnapshot('acme/half', 'worca-metrics', full, { keep });
    assert.deepEqual(tree(dir), tree(full));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: an update applied half-way (a local error, then GitHub failing the full download) keeps no commit record', async () => {
  gh.repo('acme/halfapply', { files: { a: '1' } });
  gh.commit('acme/halfapply', { branch: 'worca-metrics', orphan: true, files: { [`${R}/09/a.jsonl`]: 'A0\n', '.worca-metrics/x/k.json': '{}' } });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-halfap-'));
  try {
    const dir = join(root, 'acme~halfapply');
    const keep = (p) => p.startsWith('.worca-metrics/');
    await syncSnapshot('acme/halfapply', 'worca-metrics', dir, { keep });
    // a is written, then the file x cannot replace the folder x (EISDIR): one full download, which GitHub fails
    gh.commit('acme/halfapply', { branch: 'worca-metrics', files: { [`${R}/09/a.jsonl`]: 'A1\n', '.worca-metrics/x/k.json': null, '.worca-metrics/x': 'now a file' } });
    gh.failOnce(500, null, { match: '/tarball/' });
    assert.deepEqual([(await syncSnapshot('acme/halfapply', 'worca-metrics', dir, { keep })).ok, existsSync(`${dir}@sha`)], [false, false]);
    // everything but a new file back as it was: the next sync must not trust the half-applied copy
    gh.commit('acme/halfapply', { branch: 'worca-metrics', files: { [`${R}/09/a.jsonl`]: 'A0\n', '.worca-metrics/x': null, '.worca-metrics/x/k.json': '{}', [`${R}/10/b.jsonl`]: 'B\n' } });
    assert.equal((await syncSnapshot('acme/halfapply', 'worca-metrics', dir, { keep })).ok, true);
    const full = join(root, 'full');
    await syncSnapshot('acme/halfapply', 'worca-metrics', full, { keep });
    assert.deepEqual(tree(dir), tree(full));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncSnapshot: a full download has no entry cap (a branch keeps one file per run, never compacted); the byte caps stay', async () => {
  gh.repo('acme/runs', { files: { a: '1' } });
  const runs = {};
  for (let i = 0; i < 6; i++) runs[`${R}/09/r${i}.jsonl`] = `${i}\n`;
  gh.commit('acme/runs', { branch: 'worca-metrics', orphan: true, files: runs });
  const root = mkdtempSync(join(tmpdir(), 'worca-gf-cap-'));
  // The shared caps lowered (3 entries, 64 bytes) stand in for ARCHIVE_LIMITS' 200 000 entries and 1 GiB.
  branchTesting.setArchiveLimits({ ...ARCHIVE_LIMITS, entries: 3, extractBytes: 64 });
  try {
    const keep = (p) => p.startsWith('.worca-metrics/');
    const a = await syncSnapshot('acme/runs', 'worca-metrics', join(root, 'a'), { keep });
    assert.deepEqual([a.ok, a.stderr], [true, '']);
    assert.equal(tree(join(root, 'a')).length, 6);
    gh.commit('acme/runs', { branch: 'worca-metrics', files: { [`${R}/10/big.jsonl`]: `${'x'.repeat(100)}\n` } });
    assert.deepEqual(await syncSnapshot('acme/runs', 'worca-metrics', join(root, 'b'), { keep }), { ok: false, sha: null, changed: false, stderr: 'archive too large (extractBytes)' });
  } finally { branchTesting.reset(); rmSync(root, { recursive: true, force: true }); }
});
