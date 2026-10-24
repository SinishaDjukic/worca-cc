// test/proxy-credentials.test.mjs — the saved corporate-proxy login (src/core/proxy-credentials.mjs)
// and the writeJsonAtomic hooks it relies on (src/core/json-atomic.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, chmodSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pbkdf2 } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { writeJsonAtomic } from '../src/core/json-atomic.mjs';
import { ntHash } from '../src/core/ntlm.mjs';
import { EGRESS_PROXY_VAR } from '../src/core/egress-policy.mjs';
import {
  saveProxyLogin, readProxyLogin, clearProxyLogin, markLoginRejected, watchProxyLogin, redactProxyLine,
  proxyState, stateLine, STATE_TEXT, upstreamEnv, loginView, parseAccount, ownerAclArgs, windowsAccount,
  proxyLoginFile, ProxyLoginError, PROXY_LOGIN_FILE,
} from '../src/core/proxy-credentials.mjs';

const POSIX = process.platform !== 'win32';
const PW = 'Pässw0rd!🙂';

function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'worca-proxy-login-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

async function until(cond, ms = 1000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Collect everything console.* and process.stderr.write print while `fn` runs. */
async function captureOutput(fn) {
  const seen = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info, write: process.stderr.write };
  for (const k of ['log', 'warn', 'error', 'info']) console[k] = (...a) => seen.push(a.join(' '));
  process.stderr.write = (chunk, ...rest) => { seen.push(String(chunk)); return saved.write.call(process.stderr, chunk, ...rest); };
  try { await fn(); } finally {
    for (const k of ['log', 'warn', 'error', 'info']) console[k] = saved[k];
    process.stderr.write = saved.write;
  }
  return seen.join('\n');
}

// ── writeJsonAtomic hooks ──

test('writeJsonAtomic: a throwing beforeRename or prepareTmp leaves no tmp and no target', (t) => {
  const dir = tempHome(t);
  const file = join(dir, 'x.json');
  assert.throws(() => writeJsonAtomic(file, { a: 1 }, { mode: 0o600, beforeRename: () => { throw new Error('stop'); } }), /stop/);
  assert.deepEqual(readdirSync(dir), []);
  let size = -1;
  assert.throws(() => writeJsonAtomic(file, { a: 1 }, { mode: 0o600, prepareTmp: (tmp) => { size = statSync(tmp).size; throw new Error('acl'); } }), /acl/);
  assert.equal(size, 0, 'prepareTmp sees the EMPTY tmp file');
  assert.deepEqual(readdirSync(dir), []);
});

test('writeJsonAtomic: with or without hooks the bytes are the same', (t) => {
  const dir = tempHome(t);
  writeJsonAtomic(join(dir, 'a.json'), { a: 1, b: [2] });
  writeJsonAtomic(join(dir, 'b.json'), { a: 1, b: [2] }, { mode: 0o600, prepareTmp: () => {}, beforeRename: () => {} });
  assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
  assert.equal(readFileSync(join(dir, 'b.json'), 'utf8'), readFileSync(join(dir, 'a.json'), 'utf8'));
});

// ── save / read ──

test('saveProxyLogin stores domain, user and the NT hash, never the password', (t) => {
  const home = tempHome(t);
  const view = saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, { home });
  assert.equal(view.label, 'ACME\\jdoe');
  assert.equal('ntHash' in view, false);
  const text = readFileSync(join(home, PROXY_LOGIN_FILE), 'utf8');
  assert.ok(!text.includes(PW) && !text.includes('Pässw0rd'));
  const r = JSON.parse(text);
  assert.deepEqual(Object.keys(r).sort(), ['domain', 'id', 'ntHash', 'rejected', 'savedAt', 'user', 'v']);
  assert.equal(r.domain, 'ACME');
  assert.equal(r.user, 'jdoe');
  assert.match(r.ntHash, /^[0-9a-f]{32}$/);
  assert.equal(r.ntHash, ntHash(PW).toString('hex'));
  assert.equal(r.rejected, null);
  const back = readProxyLogin({ home });
  assert.equal(back.id, r.id);
  assert.deepEqual(back.ntHash, ntHash(PW));
});

test('saveProxyLogin refuses bad fields with a ProxyLoginError naming the field', (t) => {
  const home = tempHome(t);
  const field = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ProxyLoginError); return e.field; } return null; };
  assert.equal(field(() => saveProxyLogin({ user: '', password: 'x' }, { home })), 'user');
  assert.equal(field(() => saveProxyLogin({ user: 'a\\b', password: 'x' }, { home })), 'user');
  assert.equal(field(() => saveProxyLogin({ domain: 'A\nB', user: 'u', password: 'x' }, { home })), 'domain');
  assert.equal(field(() => saveProxyLogin({ user: 'u', password: '' }, { home })), 'password');
  assert.equal(field(() => saveProxyLogin({ user: 'u', password: 'x'.repeat(257) }, { home })), 'password');
  assert.deepEqual(readdirSync(home), []);
  assert.equal(proxyLoginFile(null), null);
});

test('parseAccount and the Windows account', () => {
  assert.deepEqual(parseAccount('ACME\\jdoe'), { domain: 'ACME', user: 'jdoe' });
  assert.deepEqual(parseAccount(' ACME/jdoe '), { domain: 'ACME', user: 'jdoe' });
  assert.deepEqual(parseAccount('jdoe@acme.example'), { domain: '', user: 'jdoe@acme.example' });
  assert.equal(windowsAccount({ USERDOMAIN: 'ACME' }, 'jdoe'), 'ACME\\jdoe');
  assert.equal(windowsAccount({}, 'jdoe'), 'jdoe');
});

test('POSIX: mode is exactly 0600 even with umask 0, and a 0644 file is refused', { skip: !POSIX }, (t) => {
  const home = tempHome(t);
  const old = process.umask(0);
  try { saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, { home }); } finally { process.umask(old); }
  const file = join(home, PROXY_LOGIN_FILE);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  chmodSync(file, 0o644);
  const r = readProxyLogin({ home });
  assert.match(r.error, /worca proxy login/);
  assert.match(r.error, /other users/);
});

test('POSIX: a symlink, a directory and a file of another uid are refused', { skip: !POSIX }, (t) => {
  const home = tempHome(t);
  const real = tempHome(t);
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, { home: real });
  symlinkSync(join(real, PROXY_LOGIN_FILE), join(home, PROXY_LOGIN_FILE));
  assert.match(readProxyLogin({ home }).error, /not a plain file/);

  const dirHome = tempHome(t);
  mkdirSync(join(dirHome, PROXY_LOGIN_FILE));
  assert.match(readProxyLogin({ home: dirHome }).error, /not a plain file/);

  assert.match(readProxyLogin({ home: real, uid: process.getuid() + 1 }).error, /another user/);
});

test('readProxyLogin: none, bad JSON and a foreign shape', (t) => {
  const home = tempHome(t);
  assert.equal(readProxyLogin({ home }), null);
  writeFileSync(join(home, PROXY_LOGIN_FILE), '{nope', { mode: 0o600 });
  assert.match(readProxyLogin({ home }).error, /not valid JSON/);
  writeFileSync(join(home, PROXY_LOGIN_FILE), '{"v":1,"user":"u","ntHash":"xyz"}', { mode: 0o600 });
  assert.match(readProxyLogin({ home }).error, /not a Worca proxy login/);
});

test('win32: one icacls call by absolute path, on the empty tmp file, granting only ACME\\jdoe', (t) => {
  const home = tempHome(t);
  const calls = [];
  const exec = (cmd, args) => { calls.push({ cmd, args, size: statSync(args[0]).size }); };
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, {
    home, platform: 'win32', exec, env: { USERDOMAIN: 'ACME', SystemRoot: 'C:\\Windows' },
  });
  assert.equal(calls.length, 1);
  const [{ cmd, args, size }] = calls;
  assert.match(cmd, /System32[\\/]icacls\.exe$/);
  assert.equal(args.length, 4);
  assert.equal(args[3].split(':')[0].split('\\')[0], 'ACME');
  assert.deepEqual(args, ownerAclArgs(args[0], windowsAccount({ USERDOMAIN: 'ACME' })));
  assert.deepEqual(args.slice(1, 3), ['/inheritance:r', '/grant:r']);
  assert.equal(args.filter((a) => a === '/grant:r').length, 1);
  assert.equal(dirname(args[0]), home);
  assert.ok(args[0].endsWith('.tmp'));
  assert.ok(basename(args[0]).startsWith(PROXY_LOGIN_FILE));
  assert.equal(size, 0, 'the ACL goes on before the hash is written');
  assert.deepEqual(ownerAclArgs('f', 'ACME\\jdoe'), ['f', '/inheritance:r', '/grant:r', 'ACME\\jdoe:F']);
});

test('win32: a failing icacls leaves no file behind', (t) => {
  const home = tempHome(t);
  const exec = () => { throw Object.assign(new Error('icacls failed'), { code: 'EACCES' }); };
  assert.throws(() => saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, { home, platform: 'win32', exec, env: {} }), /icacls failed/);
  assert.deepEqual(readdirSync(home), []);
});

test('real icacls: the saved file lists one ACE, for the current user', { skip: process.platform !== 'win32' }, (t) => {
  const home = tempHome(t);
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, { home });
  const out = execFileSync('icacls', [join(home, PROXY_LOGIN_FILE)], { encoding: 'utf8' });
  const aces = out.split(/\r?\n/).filter((l) => /:\(/.test(l));
  assert.equal(aces.length, 1, out);
  assert.ok(aces[0].toLowerCase().includes(windowsAccount().toLowerCase()), out);
});

// ── clear / mark rejected / watch ──

test('clearProxyLogin deletes the file and reports whether one was there', (t) => {
  const home = tempHome(t);
  assert.equal(clearProxyLogin({ home }), false);
  saveProxyLogin({ user: 'jdoe', password: 'x' }, { home });
  assert.equal(clearProxyLogin({ home }), true);
  assert.equal(readProxyLogin({ home }), null);
});

test('markLoginRejected only marks the login it was given, checked again before the rename', (t) => {
  const home = tempHome(t);
  const a = saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'one' }, { home });
  const b = saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'two' }, { home });
  assert.equal(markLoginRejected(a.id, { home, upstream: 'p:8080' }), false);
  assert.equal(readProxyLogin({ home }).rejected, null);
  assert.equal(markLoginRejected(b.id, { home, upstream: 'p:8080' }), true);
  const marked = readProxyLogin({ home });
  assert.ok(marked.rejected.at);
  assert.equal(marked.rejected.upstream, 'p:8080');
  assert.deepEqual(marked.ntHash, ntHash('two'));
  assert.equal(markLoginRejected(b.id, { home }), false, 'already marked');
  if (POSIX) assert.equal(statSync(join(home, PROXY_LOGIN_FILE)).mode & 0o777, 0o600);

  // A new login lands between the first read and the rename: the second read sees it.
  const c = saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'three' }, { home });
  let fresh = null;
  let first = true;
  const exec = () => { if (first) { first = false; fresh = saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'four' }, { home, platform: 'linux' }); } };
  assert.equal(markLoginRejected(c.id, { home, platform: 'win32', exec, env: {} }), false);
  const now = readProxyLogin({ home });
  assert.equal(now.id, fresh.id);
  assert.equal(now.rejected, null);
  assert.deepEqual(readdirSync(home), [PROXY_LOGIN_FILE], 'no tmp file left');
});

test('watchProxyLogin fires on a new save and on a marker for the same id', async (t) => {
  const home = tempHome(t);
  let calls = 0;
  const stop = watchProxyLogin(() => { calls += 1; }, { home, intervalMs: 50 });
  t.after(stop);
  const v = saveProxyLogin({ user: 'jdoe', password: 'x' }, { home });
  await until(() => calls >= 1);
  const before = calls;
  markLoginRejected(v.id, { home });
  await until(() => calls > before);
  assert.equal(typeof watchProxyLogin(() => {}, { home: null }), 'function');
});

test('watchProxyLogin sees a save made right after it starts, even with the thread pool busy', async (t) => {
  // fs.watchFile took its baseline from a first stat queued on the pool, so a save made before
  // that stat ran became the baseline and was never reported (the Linux CI failure).
  const home = tempHome(t);
  const jobs = Array.from({ length: Number(process.env.UV_THREADPOOL_SIZE) || 4 },
    () => new Promise((r) => pbkdf2('x', 'y', 200000, 32, 'sha512', r)));
  let calls = 0;
  const stop = watchProxyLogin(() => { calls += 1; }, { home, intervalMs: 20 });
  t.after(stop);
  saveProxyLogin({ user: 'jdoe', password: 'x' }, { home });
  await Promise.all(jobs);
  await until(() => calls >= 1);
});

// ── redaction / status / env ──

test('redactProxyLine masks credential-shaped text', () => {
  const ntlm = redactProxyLine('Proxy-Authorization: NTLM TlRMTVNTUAADAAAAGAAYAEgAAAA');
  assert.ok(!ntlm.includes('TlRM'), ntlm);
  assert.ok(!redactProxyLine('sent NTLM TlRMTVNTUAADAAAAGAAYAEgAAAA').includes('TlRM'));
  assert.equal(redactProxyLine(`hash ${ntHash('x').toString('hex')} here`), 'hash [redacted] here');
  assert.ok(!redactProxyLine('http://u:pw@h').includes('pw'));
});

test('proxyState and stateLine for every state', (t) => {
  const home = tempHome(t);
  const up = { upstream: 'http://proxy.acme.example:8080' };
  const notSet = proxyState({ env: {}, networkProxy: {}, login: null });
  assert.equal(notSet.state, 'not-configured');
  const noLogin = proxyState({ env: {}, networkProxy: up, login: null });
  assert.equal(noLogin.state, 'no-login');
  assert.equal(noLogin.upstream, 'proxy.acme.example:8080');
  saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: 'x' }, { home });
  const login = readProxyLogin({ home });
  const ready = proxyState({ env: {}, networkProxy: up, login });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.line, 'ready: via proxy.acme.example:8080 (NTLMv2) as ACME\\jdoe.');
  assert.equal('ntHash' in ready.login, false);
  markLoginRejected(login.id, { home });
  const needs = proxyState({ env: {}, networkProxy: up, login: readProxyLogin({ home }) });
  assert.equal(needs.state, 'needs-login');
  const tripped = proxyState({ env: {}, networkProxy: up, login, live: { state: 'tripped' } });
  assert.equal(tripped.state, 'needs-login', 'a live tripped connector wins over the file');
  const err = proxyState({ env: {}, networkProxy: { upstream: 'ftp://x' }, login: null });
  assert.equal(err.state, 'error');
  for (const st of [notSet, noLogin, ready, needs, err]) {
    assert.equal(st.line, stateLine(st));
    assert.ok(st.line.startsWith(STATE_TEXT[st.state]), st.line);
    assert.equal(st.text, STATE_TEXT[st.state]);
  }
  const restart = proxyState({ env: {}, networkProxy: up, login: null, expectRunning: true, live: null });
  assert.equal(restart.restartNeeded, true);
  assert.match(restart.line, /Restart Worca/);
  const bad = proxyState({ env: {}, networkProxy: up, login: { error: 'x is bad' } });
  assert.equal(bad.loginError, 'x is bad');
  assert.equal(bad.login, null);
  assert.equal('ntHash' in loginView({ id: 'a', domain: '', user: 'u', ntHash: 'h', savedAt: '', rejected: null }), false);
});

test('upstreamEnv drops the proxy variables a parent Worca set', () => {
  assert.deepEqual(upstreamEnv({ WORCA_EGRESS_PROXY_URL: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', PATH: '/bin' }), { PATH: '/bin' });
  const plain = { HTTPS_PROXY: 'http://corp:8080' };
  assert.equal(upstreamEnv(plain), plain);
  assert.equal(EGRESS_PROXY_VAR, 'WORCA_EGRESS_PROXY_URL', 'the same name as LOCAL_PROXY_VAR in proxy-credentials.mjs');
});

test('save, read and mark print neither the password nor the hash', async (t) => {
  const home = tempHome(t);
  const seen = await captureOutput(async () => {
    const v = saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: PW }, { home });
    readProxyLogin({ home });
    markLoginRejected(v.id, { home });
  });
  assert.ok(!seen.includes(PW));
  assert.ok(!seen.includes(ntHash(PW).toString('hex')));
});
