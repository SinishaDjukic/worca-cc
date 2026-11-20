// test/cli-container-proxy-ca.test.mjs
// `worca container` and the network a box gets: a loopback proxy from the shell (Worca's own
// local proxy) never reaches the box, and a corporate CA is mounted through compose.ca.yml.
// Compose takes a variable from the shell before .env, so every case asserts the env the
// compose call gets. Settings and the saved login are injected; nothing here needs Docker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { cmdContainer, boxProxyEnv, boxCaCert, isLoopbackProxy, dotenvValue, initDir } from '../src/cli/container.mjs';
import { SPAWN_ENV_BASE } from '../src/core/engines/spawn.mjs';

useTempHome(after);

const LOCAL = 'http://127.0.0.1:53128';
/** The proxy variables Worca's terminal and children carry with the corporate proxy on (egressChildEnv). */
const worcaShell = { HTTPS_PROXY: LOCAL, HTTP_PROXY: LOCAL, https_proxy: LOCAL, http_proxy: LOCAL,
  NO_PROXY: '127.0.0.1,localhost,::1,*.corp', WORCA_EGRESS_PROXY_URL: LOCAL, WORCA_CORPORATE_PROXY_URL: LOCAL, PATH: '/usr/bin' };
const noLogin = () => null;
const savedLogin = () => ({ id: 'x', domain: 'ACME', user: 'jdoe', ntHash: 'a'.repeat(32), savedAt: 1 });
const fileOf = (vars) => (k) => vars[k] || '';

function fakeExec() {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env });
    if (cmd === 'git') return { status: 1, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}
const io = () => { const lines = []; return { out: (s) => lines.push(s), c: (_n, s) => s, fail: (m) => lines.push(`FAIL ${m}`), lines }; };
async function containerDir(envBody = '') {
  const dir = mkdtempSync(join(tmpdir(), 'worca-container-'));
  await initDir(dir, { projects: '/Users/me/dev', exec: fakeExec().exec });
  if (envBody) writeFileSync(join(dir, '.env'), `${readFileSync(join(dir, '.env'), 'utf8')}\n${envBody}\n`);
  return dir;
}

test('isLoopbackProxy: loopback names and addresses only', () => {
  for (const v of [LOCAL, 'http://localhost:3128', 'http://[::1]:8080', '127.0.0.1:3128', 'http://0.0.0.0:1']) assert.equal(isLoopbackProxy(v), true, v);
  for (const v of ['', undefined, 'http://proxy.corp:3128', 'http://10.0.0.1:8080', 'http://host.docker.internal:3128', 'not a url']) assert.equal(isLoopbackProxy(v), false, String(v));
});

test('boxProxyEnv: a shell without a loopback proxy is passed through untouched', () => {
  const r = boxProxyEnv({ env: { HTTPS_PROXY: 'http://proxy.corp:3128' }, settings: () => ({}), login: noLogin });
  assert.deepEqual(r, { set: {}, notice: '' });
  assert.deepEqual(boxProxyEnv({ env: {}, settings: () => ({}), login: noLogin }), { set: {}, notice: '' });
});

test('boxProxyEnv: Worca\'s local proxy is replaced by the settings upstream when it needs no login', () => {
  const settings = () => ({ networkProxy: { enabled: true, upstream: 'http://proxy.corp:3128', noProxy: ['.corp.example'] } });
  const r = boxProxyEnv({ env: worcaShell, settings, login: noLogin });
  assert.equal(r.set.HTTPS_PROXY, 'http://proxy.corp:3128');
  assert.equal(r.set.HTTP_PROXY, 'http://proxy.corp:3128');
  assert.equal(r.set.NO_PROXY, '127.0.0.1,localhost,.corp.example', 'the settings direct list, never the local proxy\'s');
  assert.match(r.notice, /uses the corporate proxy proxy\.corp:3128/);
});

test('boxProxyEnv: a user name in networkProxy.upstream is never passed into the box', () => {
  const settings = () => ({ networkProxy: { upstream: 'http://ACME%5Cjdoe:secret@proxy.corp:8080' } });
  const r = boxProxyEnv({ env: worcaShell, settings, login: noLogin });
  assert.equal(r.set.HTTPS_PROXY, 'http://proxy.corp:8080');
  assert.doesNotMatch(JSON.stringify(r), /jdoe|secret/);
});

test('boxProxyEnv: an upstream that needs a login, or none configured, leaves the box without a proxy and says why', () => {
  for (const [name, settings, login, why] of [
    ['saved NTLM login', () => ({ networkProxy: { upstream: 'http://proxy.corp:3128' } }), savedLogin, /proxy\.corp:3128 needs a login/],
    ['auth set without a login', () => ({ networkProxy: { upstream: 'http://proxy.corp:3128', auth: 'ntlm' } }), noLogin, /needs a login/],
    ['no upstream (it came from the pre-swap env)', () => ({ networkProxy: { enabled: true } }), noLogin, /no corporate proxy is configured/],
    ['settings unreadable', () => { throw new Error('boom'); }, () => { throw new Error('boom'); }, /no corporate proxy is configured/],
  ]) {
    const r = boxProxyEnv({ env: worcaShell, settings, login });
    assert.equal(r.set.HTTPS_PROXY, '', name);
    assert.equal(r.set.HTTP_PROXY, '', name);
    assert.equal(r.set.NO_PROXY, '127.0.0.1,localhost', `${name}: compose.yml's default, not the local proxy's list`);
    assert.match(r.notice, why, name);
    assert.match(r.notice, /worca container run -- proxy login/, name);
  }
});

test('boxProxyEnv: a proxy in .env wins over the shell\'s loopback one: the shell\'s is unset, compose reads .env', () => {
  const r = boxProxyEnv({ env: worcaShell, envFile: fileOf({ HTTPS_PROXY: 'http://proxy.corp:3128' }),
    settings: () => ({ networkProxy: { upstream: 'http://other.corp:1' } }), login: noLogin });
  assert.deepEqual(r.set, { HTTPS_PROXY: undefined, HTTP_PROXY: undefined, NO_PROXY: '127.0.0.1,localhost' });
  assert.equal(r.notice, '');
  const withList = boxProxyEnv({ env: worcaShell, envFile: fileOf({ HTTPS_PROXY: 'http://p:1', NO_PROXY: 'a.corp' }), settings: () => ({}), login: noLogin });
  assert.ok('NO_PROXY' in withList.set && withList.set.NO_PROXY === undefined, '.env\'s NO_PROXY, read by compose');
});

test('boxProxyEnv: networkProxy.enabled false never passes the configured upstream in', () => {
  const r = boxProxyEnv({ env: worcaShell, settings: () => ({ networkProxy: { enabled: false, upstream: 'http://proxy.corp:3128' } }), login: noLogin });
  assert.equal(r.set.HTTPS_PROXY, '');
  assert.equal(r.set.HTTP_PROXY, '');
  assert.match(r.notice, /the network proxy is off in settings\.json/);
});

test('dotenvValue reads a .env value the way compose does, for the checks', () => {
  assert.equal(dotenvValue('http://proxy.corp:3128 # office'), 'http://proxy.corp:3128');
  assert.equal(dotenvValue('  http://p:1  '), 'http://p:1');
  assert.equal(dotenvValue('"http://p:1#x" # c'), 'http://p:1#x');
  assert.equal(dotenvValue("'/a b/ca.pem'"), '/a b/ca.pem');
  assert.equal(dotenvValue('a#b'), 'a#b', 'a # with no space before it is part of the value');
});

test('scrubbed agent and plugin spawns keep every CA name the box sets', () => {
  for (const k of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE']) assert.ok(SPAWN_ENV_BASE.includes(k), k);
});

test('boxProxyEnv: a loopback proxy written in .env is named', () => {
  const r = boxProxyEnv({ env: {}, envFile: fileOf({ HTTPS_PROXY: 'http://127.0.0.1:3128' }), settings: () => ({}), login: noLogin });
  assert.deepEqual(r.set, {});
  assert.match(r.notice, /\.env sets HTTPS_PROXY to a loopback address/);
});

test('boxCaCert: WORCA_CA_CERT in .env, then the shell, then NODE_EXTRA_CA_CERTS, then SSL_CERT_FILE', () => {
  const exists = (f) => !f.includes('gone');
  assert.equal(boxCaCert({ env: {}, exists }), null);
  assert.deepEqual(boxCaCert({ env: { NODE_EXTRA_CA_CERTS: '/a/node.pem', SSL_CERT_FILE: '/a/ssl.pem' }, envFile: fileOf({ WORCA_CA_CERT: '/a/env.pem' }), exists }),
    { file: '/a/env.pem', source: '.env WORCA_CA_CERT' });
  assert.deepEqual(boxCaCert({ env: { WORCA_CA_CERT: '/a/shell.pem', NODE_EXTRA_CA_CERTS: '/a/node.pem' }, exists }), { file: '/a/shell.pem', source: 'WORCA_CA_CERT' });
  assert.deepEqual(boxCaCert({ env: { NODE_EXTRA_CA_CERTS: '/a/node.pem', SSL_CERT_FILE: '/a/ssl.pem' }, exists }), { file: '/a/node.pem', source: 'NODE_EXTRA_CA_CERTS' });
  assert.deepEqual(boxCaCert({ env: { SSL_CERT_FILE: '/a/ssl.pem' }, exists }), { file: '/a/ssl.pem', source: 'SSL_CERT_FILE' });
  assert.deepEqual(boxCaCert({ env: { NODE_EXTRA_CA_CERTS: '/a/gone.pem' }, exists }), { missing: '/a/gone.pem', source: 'NODE_EXTRA_CA_CERTS' });
});

test('up from a Worca terminal: the compose call gets the upstream, not the local proxy, and the CA overlay', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'worca-ca-'));
  const ca = join(scratch, 'corp.pem');
  writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const dir = await containerDir();
  try {
    const { exec, calls } = fakeExec();
    const o = io();
    const env = { ...worcaShell, NODE_EXTRA_CA_CERTS: ca };
    const settings = () => ({ networkProxy: { enabled: true, upstream: 'http://proxy.corp:3128' } });
    assert.equal(await cmdContainer(['up', '--with', 'ssh'], { ...o, exec, dir, env, settings, login: noLogin }), 0);
    const up = calls.find((k) => k.args.includes('up'));
    assert.deepEqual(up.args, ['compose', '-f', 'compose.yml', '-f', 'compose.ssh.yml', '-f', 'compose.ca.yml', 'up', '-d']);
    assert.equal(up.env.HTTPS_PROXY, 'http://proxy.corp:3128');
    assert.equal(up.env.HTTP_PROXY, 'http://proxy.corp:3128');
    assert.equal(up.env.WORCA_CA_CERT, ca);
    assert.equal(up.env.PATH, '/usr/bin', 'the rest of the shell env stays');
    assert.ok(o.lines.some((l) => /overlays: ssh, ca/.test(l)));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).with, ['ssh'], 'ca is not remembered: it follows the CA');

    // login / run / shell interpolate the same way; down needs neither.
    for (const verb of [['login'], ['shell'], ['run', '--', 'runs']]) {
      calls.length = 0;
      assert.equal(await cmdContainer(verb, { ...o, exec, dir, env, settings, login: noLogin }), 0);
      assert.equal(calls.at(-1).env.HTTPS_PROXY, 'http://proxy.corp:3128', verb[0]);
      assert.ok(calls.at(-1).args.includes('compose.ca.yml'), verb[0]);
    }
    calls.length = 0;
    assert.equal(await cmdContainer(['down'], { ...o, exec, dir, env, settings, login: noLogin }), 0);
    assert.equal(calls.at(-1).env, undefined, 'down inherits the shell');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('up with a login-only corporate proxy: no proxy in the box, one line saying how to set it up', async () => {
  const dir = await containerDir();
  try {
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir, env: worcaShell,
      settings: () => ({ networkProxy: { upstream: 'http://proxy.corp:3128' } }), login: savedLogin }), 0);
    const up = calls.find((k) => k.args.includes('up'));
    assert.equal(up.env.HTTPS_PROXY, '');
    assert.equal(up.env.HTTP_PROXY, '');
    assert.equal(up.env.WORCA_CA_CERT, undefined);
    assert.ok(!up.args.includes('compose.ca.yml'));
    assert.equal(o.lines.filter((l) => l.startsWith('proxy')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('up with a commented proxy and a relative CA in .env: compose reads .env itself, the shell values are unset', async () => {
  const dir = await containerDir('HTTPS_PROXY=http://proxy.corp:3128 # office\nWORCA_CA_CERT=certs/corp.pem # IT');
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'certs'));
    writeFileSync(join(dir, 'certs', 'corp.pem'), '-----BEGIN CERTIFICATE-----\n');
    const { exec, calls } = fakeExec();
    const o = io();
    const env = { ...worcaShell, WORCA_CA_CERT: '/elsewhere/old.pem' };
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir, env, settings: () => ({}), login: noLogin }), 0);
    const up = calls.find((k) => k.args.includes('up'));
    assert.ok(up.args.includes('compose.ca.yml'), 'the relative path resolves against the container dir, as compose does');
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'WORCA_CA_CERT']) assert.equal(k in up.env, false, `${k} unset, not re-parsed`);
    assert.equal(up.env.https_proxy, LOCAL, 'compose interpolates the upper-case names only; the rest of the shell stays');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('up: a CA path that does not exist is named and not mounted', async () => {
  const dir = await containerDir('WORCA_CA_CERT=/nonexistent/corp.pem');
  try {
    const { exec, calls } = fakeExec();
    const o = io();
    assert.equal(await cmdContainer(['up'], { ...o, exec, dir, env: {}, settings: () => ({}), login: noLogin }), 0);
    assert.ok(!calls.find((k) => k.args.includes('up')).args.includes('compose.ca.yml'));
    assert.ok(o.lines.some((l) => /\.env WORCA_CA_CERT names \/nonexistent\/corp\.pem, which does not exist/.test(l)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
