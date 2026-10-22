// test/git-free-github.test.mjs — the one GitHub REST client of the git-free transports (P6 Task 2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { githubRepoOf, createGithubClient, resolveCommit, resolveBranch, _testing } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTarGz } from '../src/core/git-free/archive.mjs';
import { tarGz } from './helpers/tar-writer.mjs';

const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
const gh = await fakeGithub();
_testing.setFetch(gh.fetch);
after(() => { _testing.reset(); gh.close(); });
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'worca-gf-gh-')); roots.push(d); return d; };

test('githubRepoOf: github.com URLs that name one repository; everything else null', () => {
  const ok = { owner: 'acme', repo: 'tools' };
  for (const u of ['https://github.com/acme/tools', 'https://github.com/acme/tools.git', 'https://github.com/acme/tools/', 'http://github.com/acme/tools',
    'git@github.com:acme/tools.git', 'ssh://git@github.com/acme/tools.git', 'ssh://git@ssh.github.com:443/acme/tools.git', 'git://github.com/acme/tools.git']) {
    assert.deepEqual(githubRepoOf(u), ok, u);
  }
  assert.deepEqual(githubRepoOf('acme/tools', { shorthand: true }), ok);
  for (const u of ['acme/tools', 'https://github.com/acme/tools/tree/main', 'https://gitlab.com/acme/tools', 'https://github.example.com/acme/tools',
    'https://dev.azure.com/o/p/_git/r', '/abs/path', 'file:///x/y', 'https://github.com/acme', 'https://user:pw@github.com/acme/tools', 'https://github.com/-acme/tools']) {
    assert.equal(githubRepoOf(u), null, u);
  }
});

test('requests: the API version header; worca\'s token for the repository when one is set, anonymous otherwise', async () => {
  const { sha } = gh.repo('acme/tools', { files: { 'README.md': 'x\n' } });
  const n = gh.calls.length;
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'tok-1' }, async () => {
    assert.equal(await resolveCommit(createGithubClient({ owner: 'acme', repo: 'tools' }), 'main'), sha);
  });
  await withEnv(NO_CREDS, async () => {
    assert.equal(await resolveCommit(createGithubClient({ owner: 'acme', repo: 'tools' }), null), sha);
  });
  assert.deepEqual(gh.calls.slice(n).map((c) => [c.method, c.path, c.auth]), [
    ['GET', '/repos/acme/tools/commits/main', 'Bearer tok-1'],
    ['GET', '/repos/acme/tools', null],
    ['GET', '/repos/acme/tools/commits/main', null],
  ]);
  assert.equal(gh.calls[n].headers['x-github-api-version'], '2022-11-28');
  assert.equal(gh.calls[n].headers.accept, 'application/vnd.github.sha');
});

test('a repeated GET revalidates with its ETag: the 304 answers from the cache', async () => {
  const { sha } = gh.repo('acme/etag', { files: { a: '1' } });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'etag' });
    const n = gh.calls.length;
    assert.equal(await resolveCommit(c, 'main'), sha);
    assert.equal(await resolveCommit(c, 'main'), sha);
    assert.deepEqual(gh.calls.slice(n).map((x) => x.status), [200, 304]);
  });
});

test('errors: one code each, a message that names no secret', async () => {
  gh.repo('acme/errs', { files: { a: '1' } });
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'secret-token' }, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'errs' });
    await assert.rejects(resolveCommit(createGithubClient({ owner: 'acme', repo: 'nope' }), 'main'),
      { code: 'GITHUB_NOT_FOUND', message: 'not found on GitHub: acme/nope' });
    const soon = Math.floor(Date.now() / 1000) + 1800;
    gh.rateLimitOnce(soon);
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_RATE_LIMITED', message: `GitHub rate limit reached (resets ${new Date(soon * 1000).toISOString().slice(11, 16)} UTC)` });
    _testing.reset(); _testing.setFetch(gh.fetch);   // the token stays refused for half an hour otherwise
    gh.failOnce(401);
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_AUTH', message: 'GitHub rejected the token (HTTP 401)' });
    gh.failOnce(403, 'Resource not accessible by integration');
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_FORBIDDEN', message: 'GitHub refused (HTTP 403): Resource not accessible by integration' });
    gh.failOnce(502);
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_HTTP', message: 'GitHub (HTTP 502)' });
    gh.offline(true);
    await assert.rejects(resolveCommit(c, 'main'), (e) => e.code === 'GITHUB_NETWORK' && e.message === 'GitHub unreachable (ENOTFOUND)' && !e.message.includes('secret-token'));
    gh.offline(false);
    assert.equal(await resolveBranch(c, 'missing'), null);
    await assert.rejects(resolveCommit(c, 'missing'), { code: 'GITHUB_CONFLICT', message: 'GitHub (HTTP 422): No commit found for SHA: missing' });
  });
});

test('requests: anonymous calls never revalidate with a token\'s ETag; the default accept and user agent', async () => {
  gh.repo('acme/hdr', { files: { a: '1' } });
  const n = gh.calls.length;
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'tok-1' }, async () => { await resolveCommit(createGithubClient({ owner: 'acme', repo: 'hdr' }), 'main'); });
  await withEnv(NO_CREDS, async () => { await resolveCommit(createGithubClient({ owner: 'acme', repo: 'hdr' }), null); });
  assert.deepEqual(gh.calls.slice(n).map((c) => c.status), [200, 200, 200]);
  assert.equal(gh.calls[n + 1].headers.accept, 'application/vnd.github+json');
  assert.equal(gh.calls[n + 1].headers['user-agent'], 'worca');
});

test('roles: the read and the write token by role, never "as person"', async () => {
  gh.repo('acme/roles', { files: { a: '1' } });
  const n = gh.calls.length;
  await withEnv({ ...NO_CREDS, WORCA_GH_READ_TOKEN: 'tok-r', WORCA_GH_WRITE_TOKEN: 'tok-w', WORCA_BROKER_URL: 'http://127.0.0.1:9', WORCA_GH_AS_PERSON: 'required' }, async () => {
    await resolveBranch(createGithubClient({ owner: 'acme', repo: 'roles' }), 'main');
    await resolveBranch(createGithubClient({ owner: 'acme', repo: 'roles', role: 'write' }), 'main');
  });
  assert.deepEqual(gh.calls.slice(n).map((c) => c.auth), ['Bearer tok-r', 'Bearer tok-w']);
});

test('errors: 429 + retry-after is the rate limit; conflicts keep status and the API message; a timeout says timeout', async () => {
  gh.repo('acme/err2', { files: { a: '1' } });
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  await withEnv(NO_CREDS, async () => {
    const before = Date.now();
    const c429 = createGithubClient({ owner: 'acme', repo: 'err2', fetchImpl: async () => new Response('{"message":"You have exceeded a secondary rate limit"}', { status: 429, headers: { 'retry-after': '3600' } }) });
    const e = await resolveCommit(c429, 'main').then(() => null, (x) => x);
    assert.equal(e?.code, 'GITHUB_RATE_LIMITED');
    assert.ok([hhmm(before + 3_600_000), hhmm(Date.now() + 3_600_000)].map((t) => `GitHub rate limit reached (resets ${t} UTC)`).includes(e.message), e.message);
    _testing.reset(); _testing.setFetch(gh.fetch);   // anonymous calls stay refused for the hour otherwise
    const c = createGithubClient({ owner: 'acme', repo: 'err2' });
    gh.failOnce(409, 'Git Repository is empty.');
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_CONFLICT', status: 409, apiMessage: 'Git Repository is empty.', message: 'GitHub (HTTP 409): Git Repository is empty.' });
    await assert.rejects(resolveCommit(c, 'missing'), { code: 'GITHUB_CONFLICT', status: 422, apiMessage: 'No commit found for SHA: missing' });
    const slow = createGithubClient({ owner: 'acme', repo: 'err2', fetchImpl: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); } });
    await assert.rejects(resolveCommit(slow, 'main'), { code: 'GITHUB_NETWORK', message: 'GitHub unreachable (timeout)' });
  });
});

test('errors: a secondary limit waits retry-after, not the primary reset; an anonymous 401 asks for a token; a body failing midway is GITHUB_NETWORK', async () => {
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  await withEnv(NO_CREDS, async () => {
    _testing.reset();
    const before = Date.now();
    const sec = createGithubClient({ owner: 'acme', repo: 'sec', fetchImpl: async () => new Response('{"message":"You have exceeded a secondary rate limit"}',
      { status: 403, headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4870', 'x-ratelimit-reset': String(Math.floor(before / 1000) + 3300) } }) });
    const e = await sec.json('GET', '').then(() => null, (x) => x);
    _testing.reset(); _testing.setFetch(gh.fetch);   // anonymous calls stay refused for the minute otherwise
    assert.equal(e?.code, 'GITHUB_RATE_LIMITED');
    assert.ok(e.resetAtMs >= before + 60_000 && e.resetAtMs <= Date.now() + 60_000, `${e.resetAtMs - before} ms`);
    assert.ok([hhmm(before + 60_000), hhmm(Date.now() + 60_000)].map((t) => `GitHub rate limit reached (resets ${t} UTC)`).includes(e.message), e.message);
    const w = createGithubClient({ owner: 'acme', repo: 'w', fetchImpl: async () => new Response('{"message":"Requires authentication"}', { status: 401 }) });
    await assert.rejects(w.json('POST', '/git/trees', { tree: [] }),
      { code: 'GITHUB_AUTH', anonymous: true, message: 'GitHub (HTTP 401): Requires authentication (writing needs GH_TOKEN)' });
    const reset = Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
    const broken = () => new Response(new ReadableStream({ pull(ctl) { ctl.error(reset); } }), { status: 200 });
    const b = createGithubClient({ owner: 'acme', repo: 'b', fetchImpl: async () => broken() });
    await assert.rejects(b.json('GET', ''), { code: 'GITHUB_NETWORK', message: 'GitHub unreachable (UND_ERR_SOCKET)' });
    await assert.rejects(b.json('POST', '/git/trees', {}), { code: 'GITHUB_NETWORK', message: 'GitHub unreachable (UND_ERR_SOCKET)' });
    await assert.rejects(extractTarGz(await b.archive('a'.repeat(40)), fresh()), { code: 'GITHUB_NETWORK', message: 'GitHub unreachable (UND_ERR_SOCKET)' });
  });
});

test('errors: a bare 429, or a 403 secondary limit without retry-after, is the rate limit: a minute, no request until then', async () => {
  const cases = [[429, '', {}], [403, '{"message":"You have exceeded a secondary rate limit"}', { 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3000) }]];
  try {
    await withEnv(NO_CREDS, async () => {
      for (const [status, body, headers] of cases) {
        _testing.reset();
        let calls = 0;
        _testing.setFetch(async () => { calls += 1; return new Response(body, { status, headers }); });
        const before = Date.now();
        const e = await createGithubClient({ owner: 'acme', repo: 'sec2' }).json('GET', '').then(() => null, (x) => x);
        assert.equal(e?.code, 'GITHUB_RATE_LIMITED', `${status}: ${e?.message}`);
        assert.ok(e.resetAtMs >= before + 60_000 && e.resetAtMs <= Date.now() + 60_000, `${status}: ${e.resetAtMs - before} ms`);
        await assert.rejects(createGithubClient({ owner: 'acme', repo: 'sec3' }).json('GET', ''), { code: 'GITHUB_RATE_LIMITED' });
        assert.equal(calls, 1, `${status}: fetches`);
      }
    });
  } finally { _testing.reset(); _testing.setFetch(gh.fetch); }   // the shared guard: anonymous calls stay refused for the minute otherwise
});

test('errors: a reset more than an hour away (a garbled header, a clock far off) waits an hour, never an invalid date', async () => {
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const cases = [{ 'retry-after': '99999999999999' }, { 'retry-after': 'Infinity' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' }];
  try {
    await withEnv(NO_CREDS, async () => {
      for (const headers of cases) {
        _testing.reset();
        const before = Date.now();
        const fetchImpl = async () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers });
        const e = await createGithubClient({ owner: 'acme', repo: 'far', fetchImpl }).json('GET', '').then(() => null, (x) => x);
        const label = JSON.stringify(headers);
        assert.equal(e?.code, 'GITHUB_RATE_LIMITED', `${label}: ${e}`);
        assert.ok(e.resetAtMs >= before + 3_600_000 && e.resetAtMs <= Date.now() + 3_600_000, `${label}: ${e.resetAtMs - before} ms`);
        assert.ok([before, Date.now()].map((t) => `GitHub rate limit reached (resets ${hhmm(t + 3_600_000)} UTC)`).includes(e.message), `${label}: ${e.message}`);
      }
    });
  } finally { _testing.reset(); _testing.setFetch(gh.fetch); }   // anonymous calls stay refused for the hour otherwise
});

test('githubRepoOf refuses . and .. and names GitHub cannot hold; refs are path-encoded', async () => {
  for (const u of ['https://github.com/acme/..', 'https://github.com/acme/.', 'https://github.com/acme/t@ols']) assert.equal(githubRepoOf(u), null, u);
  gh.repo('acme/refs', { files: { a: '1' } });
  const s2 = gh.commit('acme/refs', { branch: 'fix#1', from: 'main', files: { b: '2' } });
  const s3 = gh.commit('acme/refs', { branch: 'feat/x', from: 'main', files: { c: '3' } });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'refs' });
    assert.equal(await resolveCommit(c, 'fix#1'), s2);
    assert.equal(await resolveBranch(c, 'fix#1'), s2);
    assert.equal(await resolveCommit(c, 'feat/x'), s3);
    assert.equal(await resolveBranch(c, 'feat/x'), s3);
  });
});

test('a ref or path with a ".", ".." or empty segment is refused before any request: URL parsing would fold it into another name', async () => {
  const { sha } = gh.repo('acme/dots', { files: { 'a/b.txt': 'b\n' } });
  gh.commit('acme/dots', { branch: 'rel/v2', from: 'main', files: { c: '3' } });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'dots' });
    const n = gh.calls.length;
    for (const ref of ['./main', 'rel/./v2', 'rel/../main', 'rel//v2', 'main/']) {
      await assert.rejects(resolveCommit(c, ref), { code: 'GITHUB_NOT_FOUND', status: 404, message: `not found on GitHub: ${ref}` }, ref);
      assert.equal(await resolveBranch(c, ref), null, ref);
    }
    await assert.rejects(c.contents('a/./b.txt', sha), { code: 'GITHUB_NOT_FOUND', message: 'not found on GitHub: a/./b.txt' });
    assert.equal(gh.calls.length, n);
  });
});

test('a commit sha GitHub answers must be 40 hex: anything else is GITHUB_HTTP, never a folder name', async () => {
  gh.repo('acme/lying', { files: { a: '1' } });
  const lie = '../../../../ESCAPED';
  const fetchImpl = async (url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/commits/main')) return new Response(`${lie}\n`, { status: 200 });
    if (p.endsWith('/git/ref/heads/main')) return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: lie, type: 'commit' } }), { status: 200 });
    if (p.endsWith('/git/ref/heads/rel')) return new Response(JSON.stringify([{ ref: 'refs/heads/rel/v2' }]), { status: 200 });
    return gh.fetch(url, init);
  };
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'lying', fetchImpl });
    for (const call of [() => resolveCommit(c, 'main'), () => resolveBranch(c, 'main'), () => resolveBranch(c, 'rel')]) {
      await assert.rejects(call(), { name: 'GithubError', code: 'GITHUB_HTTP', message: 'GitHub answered no commit' }, String(call));
    }
  });
});

test('an answer that is not JSON (a proxy\'s or a captive portal\'s page) is GITHUB_HTTP, never a SyntaxError', async () => {
  const fetchImpl = async () => new Response('<!DOCTYPE html><html>Sign in to continue</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'portal', fetchImpl });
    for (const call of [() => c.json('GET', ''), () => c.json('POST', '/git/trees', { tree: [] }), () => c.contents('a.md', 'main'), () => resolveCommit(c, null)]) {
      await assert.rejects(call(), { name: 'GithubError', code: 'GITHUB_HTTP', message: 'GitHub answered no JSON' }, String(call));
    }
  });
});

test('contents: a file, a symlink, a missing path (null); archive: a commit\'s tar.gz, never revalidated; reset empties the ETag cache', async () => {
  const { sha } = gh.repo('acme/cont', { files: { 'dir/a.txt': 'hello\n', ln: { link: 'dir/a.txt' } } });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'cont' });
    assert.deepEqual(await c.contents('dir/a.txt', sha), { type: 'file', bytes: Buffer.from('hello\n'), path: 'dir/a.txt' });
    assert.deepEqual(await c.contents('ln', sha), { type: 'symlink', target: 'dir/a.txt' });
    assert.equal(await c.contents('nope.txt', sha), null);
    for (let i = 0; i < 2; i++) {
      const dest = fresh();
      await extractTarGz(await c.archive(sha), dest, { links: false });
      assert.equal(readFileSync(join(dest, 'dir', 'a.txt'), 'utf8'), 'hello\n');
    }
    assert.deepEqual(gh.calls.filter((x) => x.path.endsWith(`/tarball/${sha}`)).map((x) => [x.status, x.headers['if-none-match'] ?? null]), [[200, null], [200, null]]);
    const n = gh.calls.length;
    await resolveCommit(c, 'main');
    await resolveCommit(c, 'main');
    _testing.reset(); _testing.setFetch(gh.fetch);
    await resolveCommit(c, 'main');
    assert.deepEqual(gh.calls.slice(n).map((x) => x.status), [200, 304, 200]);
  });
});

test('githubRepoOf takes the github.com host in any case; the ETag cache keeps at most 500 entries, the oldest leaving first', async () => {
  for (const u of ['https://GitHub.com/acme/tools', 'git@GITHUB.COM:acme/tools.git', 'ssh://git@SSH.GitHub.com/acme/tools.git', 'git://Github.Com/acme/tools']) {
    assert.deepEqual(githubRepoOf(u), { owner: 'acme', repo: 'tools' }, u);
  }
  _testing.reset();
  _testing.setFetch(gh.fetch);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers['if-none-match'] ?? null);
    return new Response('"x"', { status: 200, headers: { etag: `"e-${url.split('/').pop()}"` } });
  };
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'cap', fetchImpl });
    for (let i = 0; i <= 500; i++) await c.text(`/contents/f${i}`);
    seen.length = 0;
    await c.text('/contents/f1');
    await c.text('/contents/f0');
  });
  assert.deepEqual(seen, ['"e-f1"', null]);
});

test('rate limit: the same credentials fail fast until the reset, without a request; another token is not blocked; a past reset blocks nothing', async () => {
  const { sha } = gh.repo('acme/rl', { files: { a: '1' } });
  _testing.reset(); _testing.setFetch(gh.fetch);
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'tok-rl' }, async () => {
    const soon = Math.floor(Date.now() / 1000) + 1800;
    gh.rateLimitOnce(soon);
    await assert.rejects(resolveCommit(createGithubClient({ owner: 'acme', repo: 'rl' }), 'main'), { code: 'GITHUB_RATE_LIMITED' });
    const n = gh.calls.length;
    await assert.rejects(resolveCommit(createGithubClient({ owner: 'acme', repo: 'rl' }), 'main'),
      { code: 'GITHUB_RATE_LIMITED', resetAtMs: soon * 1000, message: `GitHub rate limit reached (resets ${new Date(soon * 1000).toISOString().slice(11, 16)} UTC)` });
    await assert.rejects(createGithubClient({ owner: 'acme', repo: 'other' }).json('GET', ''), { code: 'GITHUB_RATE_LIMITED' });
    assert.equal(gh.calls.length, n);
  });
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'tok-other' }, async () => {
    assert.equal(await resolveCommit(createGithubClient({ owner: 'acme', repo: 'rl' }), 'main'), sha);
  });
  await withEnv(NO_CREDS, async () => {
    gh.rateLimitOnce(1_700_000_000);   // 2023-11-14: already reset
    await assert.rejects(resolveCommit(createGithubClient({ owner: 'acme', repo: 'rl' }), 'main'), { code: 'GITHUB_RATE_LIMITED' });
    const n = gh.calls.length;
    assert.equal(await resolveCommit(createGithubClient({ owner: 'acme', repo: 'rl' }), 'main'), sha);
    assert.equal(gh.calls.length, n + 1);
  });
  _testing.reset(); _testing.setFetch(gh.fetch);
});

test('not found: without a token the message says a private repository needs GH_TOKEN; with one it does not; every error says which', async () => {
  const hint = 'not found on GitHub: acme/private-one (a private repository needs GH_TOKEN)';
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'private-one' });
    await assert.rejects(c.json('GET', ''), { code: 'GITHUB_NOT_FOUND', status: 404, anonymous: true, message: hint });
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_NOT_FOUND', anonymous: true, message: hint });
    gh.offline(true);
    try { await assert.rejects(c.json('GET', ''), { code: 'GITHUB_NETWORK', anonymous: true }); } finally { gh.offline(false); }
  });
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'tok-p' }, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'private-one' });
    await assert.rejects(c.json('GET', ''), { code: 'GITHUB_NOT_FOUND', anonymous: false, message: 'not found on GitHub: acme/private-one' });
    await assert.rejects(resolveCommit(c, 'main'), { code: 'GITHUB_NOT_FOUND', anonymous: false, message: 'not found on GitHub: acme/private-one' });
  });
});

test('githubRepoOf takes a user name without a password in an http(s) URL', () => {
  for (const u of ['https://user@github.com/acme/tools.git', 'http://denis@github.com/acme/tools', 'https://x-access@GitHub.com/acme/tools/']) {
    assert.deepEqual(githubRepoOf(u), { owner: 'acme', repo: 'tools' }, u);
  }
  for (const u of ['https://user:pw@github.com/acme/tools', 'https://user:@github.com/acme/tools', 'https://@github.com/acme/tools', 'https://a@b@github.com/acme/tools']) {
    assert.equal(githubRepoOf(u), null, u);
  }
});

test('a GET naming a 40-hex sha keeps no ETag entry (it never changes); a ref still revalidates', async () => {
  const { sha } = gh.repo('acme/imm', { files: { 'a.txt': 'a\n' } });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'imm' });
    const n = gh.calls.length;
    await c.contents('a.txt', sha); await c.contents('a.txt', sha);
    await c.json('GET', `/git/trees/${sha}`); await c.json('GET', `/git/trees/${sha}`);
    await c.contents('a.txt', 'main'); await c.contents('a.txt', 'main');
    assert.deepEqual(gh.calls.slice(n).map((x) => [x.status, !!x.headers['if-none-match']]),
      [[200, false], [200, false], [200, false], [200, false], [200, false], [304, true]]);
  });
});

test('contents of a file over 1 MB (encoding "none", no content) is read from the blob API', async () => {
  const { sha } = gh.repo('acme/big', { files: { 'big.bin': 'a large body\n' } });
  const blob = gh.git('acme/big', 'rev-parse', `${sha}:big.bin`);
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'big' });
    gh.bigContents(true);
    const n = gh.calls.length;
    try { assert.deepEqual(await c.contents('big.bin', sha), { type: 'file', bytes: Buffer.from('a large body\n'), path: 'big.bin' }); } finally { gh.bigContents(false); }
    assert.deepEqual(gh.calls.slice(n).map((x) => [x.path, x.status]), [['/repos/acme/big/contents/big.bin', 200], [`/repos/acme/big/git/blobs/${blob}`, 200]]);
  });
});

test('a credential that cannot be read (GitHub App key missing) warns once, without a secret, and goes anonymous', async () => {
  gh.repo('acme/appless', { files: { a: '1' } });
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    await withEnv({ ...NO_CREDS, WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_FILE: '/nonexistent/worca-gf-key.pem' }, async () => {
      const c = createGithubClient({ owner: 'acme', repo: 'appless' });
      const n = gh.calls.length;
      await c.json('GET', '');
      await c.json('GET', '');
      assert.deepEqual(gh.calls.slice(n).map((x) => x.auth), [null, null]);
    });
  } finally { console.warn = orig; }
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /^\[worca\] GitHub credential for acme\/appless: .+; going anonymous$/);
});

test('GitHub App mode: the token is minted through the client\'s fetch, within the timeout of the request that needs it', async () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const seen = { client: [], global: [] };
  // Never answers: honours the signal (an aborted one too, as fetch does) and gives up by itself after 3 s.
  const hang = (who) => (url, init = {}) => new Promise((resolve, reject) => {
    seen[who].push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    if (init.signal?.aborted) return reject(init.signal.reason);
    const timer = setTimeout(() => reject(new Error('hung')), 3_000);
    init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); });
  });
  const warns = [];
  const orig = { warn: console.warn, fetch: globalThis.fetch };
  console.warn = (...a) => { warns.push(a.join(' ')); };
  globalThis.fetch = hang('global');   // a mint past the client's fetch would reach the network
  let ms;
  try {
    await withEnv({ ...NO_CREDS, WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_B64: Buffer.from(pem).toString('base64'), WORCA_GH_APP_INSTALLATION_ID: '7' }, async () => {
      const c = createGithubClient({ owner: 'acme', repo: 'app', fetchImpl: hang('client'), timeoutMs: 500 });
      const t0 = Date.now();
      await assert.rejects(c.json('GET', ''), { code: 'GITHUB_NETWORK', message: 'GitHub unreachable (timeout)' });
      ms = Date.now() - t0;
    });
  } finally { console.warn = orig.warn; globalThis.fetch = orig.fetch; }
  assert.deepEqual(seen, { client: ['POST /app/installations/7/access_tokens', 'GET /repos/acme/app'], global: [] });
  assert.ok(ms < 950, `${ms} ms`);   // one 500 ms deadline for the mint and the request, never one each
  assert.deepEqual(warns, ['[worca] GitHub credential for acme/app: GitHub API unreachable (timeout); going anonymous']);
});

test('archive: a reader that stops early (a cap) cancels the download', async () => {
  const gz = tarGz(Array.from({ length: 50 }, (_, i) => ({ path: `top/d${i}/`, type: '5' })));
  let cancelled = false;
  const fetchImpl = async () => new Response(new ReadableStream({
    start(ctl) { ctl.enqueue(gz.subarray(0, gz.length - 30)); },   // never closes: a slow, large download
    cancel() { cancelled = true; },
  }), { status: 200 });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'stop', fetchImpl });
    await assert.rejects(extractTarGz(await c.archive('a'.repeat(40)), fresh(), { limits: { downloadBytes: 1e9, extractBytes: 1e9, fileBytes: 1e9, entries: 3 } }),
      { code: 'TOO_LARGE', limit: 'entries' });
  });
  for (let i = 0; i < 40 && !cancelled; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(cancelled, true);
});

test('the ETag cache keys on accept: one URL read as a sha, then as JSON, is two answers', async () => {
  const sha = 'b'.repeat(40);
  const seen = [];
  const fetchImpl = async (url, init) => {
    const inm = init.headers['if-none-match'] ?? null;
    seen.push(inm);
    const [etag, body] = init.headers.accept === 'application/vnd.github.sha' ? ['"as-sha"', sha] : ['"as-json"', JSON.stringify({ sha })];
    return inm === null ? new Response(body, { status: 200, headers: { etag } }) : new Response(null, { status: 304 });
  };
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'accept', fetchImpl });
    assert.equal(await c.text('/commits/main', 'application/vnd.github.sha'), sha);
    assert.deepEqual(await c.json('GET', '/commits/main'), { sha });
  });
  assert.deepEqual(seen, [null, null]);
});

test('a client\'s timeoutMs bounds each of its requests; the archive keeps its own deadline', async () => {
  const { sha } = gh.repo('acme/slow', { files: { a: '1' } });
  const slow = (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(gh.fetch(url, init)), 200);
    init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); });
  });
  await withEnv(NO_CREDS, async () => {
    const c = createGithubClient({ owner: 'acme', repo: 'slow', fetchImpl: slow, timeoutMs: 50 });
    const t0 = Date.now();
    await assert.rejects(c.json('GET', ''), { code: 'GITHUB_NETWORK', message: 'GitHub unreachable (timeout)' });
    assert.ok(Date.now() - t0 < 1_000);
    const dest = fresh();
    await extractTarGz(await c.archive(sha), dest, { links: false });
    assert.equal(readFileSync(join(dest, 'a'), 'utf8'), '1');
    assert.equal((await createGithubClient({ owner: 'acme', repo: 'slow', fetchImpl: slow }).json('GET', '')).full_name, 'acme/slow');
  });
});
