// test/git-guard-proxy.test.mjs — security G2 and the corporate proxy: a guarded git call still goes through the
// proxy git would use without the guard. Git reads an empty http.proxy as "no proxy, ignore HTTPS_PROXY", so the
// guard pins the proxy keys only when the repository sets them, to the trusted value or else the env proxy. The
// real-git case runs `git ls-remote` under guardedGitEnv against a fake CONNECT proxy that records each target.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { envProxy, guardEntries, guardedGitEnv } from '../src/core/git-guard.mjs';

useTempHome(after);
const created = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

const L = (key, value) => ({ scope: 'local', key, value });
const G = (key, value) => ({ scope: 'global', key, value });
const map = (entries) => { const m = new Map(); for (const [k, v] of entries) m.set(k, [...(m.get(k) || []), v]); return m; };
const PROXY = 'http://127.0.0.1:3128';

test('envProxy: git\'s own order, lower case first; http_proxy only for an http URL', () => {
  assert.equal(envProxy({}), '');
  assert.equal(envProxy({ HTTPS_PROXY: 'http://a' }), 'http://a');
  assert.equal(envProxy({ HTTPS_PROXY: 'http://a', https_proxy: 'http://b' }), 'http://b');
  assert.equal(envProxy({ http_proxy: 'http://h' }), '', 'an https URL never takes http_proxy');
  assert.equal(envProxy({ http_proxy: 'http://h', HTTPS_PROXY: 'http://a' }, 'http://x.example'), 'http://h');
  assert.equal(envProxy({ ALL_PROXY: 'http://all' }), 'http://all');
  assert.equal(envProxy({ ALL_PROXY: 'http://A', all_proxy: 'http://a' }, 'http://x.example'), 'http://a');
});

test('guardEntries: no proxy pin unless the repository sets one, so git keeps the env and trusted proxy', () => {
  const env = { HTTPS_PROXY: PROXY };
  for (const list of [[], [G('http.proxy', 'http://corp:8080')], [G('http.https://x.example.proxy', 'http://corp:8080')]]) {
    const keys = guardEntries(list, { env, isolated: false }).entries.map(([k]) => k);
    assert.equal(keys.some((k) => /proxy$/i.test(k)), false, JSON.stringify(list));
  }
});

test('guardEntries: a repository proxy is replaced by the trusted value, else the env proxy, else none', () => {
  const env = { HTTPS_PROXY: PROXY, http_proxy: 'http://plain:3128' };
  const pinned = (list, key, e = env) => map(guardEntries(list, { env: e, isolated: false }).entries).get(key);
  assert.deepEqual(pinned([L('http.proxy', 'http://evil')], 'http.proxy'), [PROXY]);
  assert.deepEqual(pinned([G('http.proxy', 'http://corp:8080'), L('http.proxy', 'http://evil')], 'http.proxy'), ['http://corp:8080']);
  assert.deepEqual(pinned([G('http.proxy', ''), L('http.proxy', 'http://evil')], 'http.proxy'), [''], 'a person\'s own "no proxy" stays');
  assert.deepEqual(pinned([L('http.proxy', 'http://evil')], 'http.proxy', {}), ['']);
  // A per-URL key: the trusted same key, else the trusted http.proxy (what git would have used), else the env.
  const url = 'http.https://x.example.proxy';
  assert.deepEqual(pinned([L(url, 'http://evil')], url), [PROXY]);
  assert.deepEqual(pinned([G('http.proxy', 'http://corp:8080'), L(url, 'http://evil')], url), ['http://corp:8080']);
  assert.deepEqual(pinned([G(url, 'http://site:1'), G('http.proxy', 'http://corp:8080'), L(url, 'http://evil')], url), ['http://site:1']);
  assert.deepEqual(pinned([L('http.http://x.example.proxy', 'http://evil')], 'http.http://x.example.proxy'), ['http://plain:3128']);
  assert.deepEqual(pinned([L('remote.origin.proxy', 'http://evil')], 'remote.origin.proxy'), [PROXY]);
  assert.deepEqual(pinned([G('remote.origin.proxy', 'http://r:1'), L('remote.origin.proxy', 'http://evil')], 'remote.origin.proxy'), ['http://r:1']);
});

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};
/** A proxy that records each CONNECT target and refuses it, so git fails fast after asking. */
async function fakeProxy() {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.url); res.writeHead(502).end(); });
  server.on('connect', (req, socket) => { seen.push(req.url); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const lsRemote = (cwd, env) => new Promise((done) => execFile('git', ['ls-remote', 'https://upstream.invalid/repo.git'],
  { cwd, env, timeout: 30_000, windowsHide: true }, () => done()));

test('a guarded git call goes through HTTPS_PROXY, and through it when the repository names another proxy', async () => {
  const proxy = await fakeProxy();
  try {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'worca-cc-g2-proxy-')));
    created.push(repo);
    git(repo, 'init', '-q');
    // Only the env proxy: no global or system http.proxy may get in the way (the temp HOME has no ~/.gitconfig).
    const env = { ...process.env, HTTPS_PROXY: proxy.url, https_proxy: proxy.url, NO_PROXY: '', no_proxy: '', GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0' };
    await lsRemote(repo, await guardedGitEnv(repo, { env }));
    assert.deepEqual(proxy.seen, ['upstream.invalid:443'], 'the guarded call asked the env proxy');
    proxy.seen.length = 0;
    git(repo, 'config', 'http.https://upstream.invalid.proxy', 'http://127.0.0.1:9');
    git(repo, 'config', 'http.proxy', 'http://127.0.0.1:9');
    await lsRemote(repo, await guardedGitEnv(repo, { env }));
    assert.deepEqual(proxy.seen, ['upstream.invalid:443'], 'the repository\'s proxy was replaced by the env proxy');
  } finally { await proxy.close(); }
});
