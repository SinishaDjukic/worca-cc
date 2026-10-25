// test/cli-proxy.test.mjs — `worca proxy status|login|logout|test` (src/cli/proxy.mjs), in process
// against the fake NTLM upstream, plus two spawned checks of the worca-cc.mjs wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdProxy } from '../src/cli/proxy.mjs';
import { readProxyLogin, markLoginRejected, proxyLoginReads, PROXY_LOGIN_FILE } from '../src/core/proxy-credentials.mjs';
import { startEgressPolicy } from '../src/core/egress-policy.mjs';
import { ntHash } from '../src/core/ntlm.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const SECRETS = ['S3cret!', 'wrong', ntHash('S3cret!').toString('hex'), ntHash('wrong').toString('hex')];

function echoOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d) => c.write(`echo:${d}`)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

function stdin(text) {
  const s = new PassThrough();
  s.end(text);
  return s;
}

/** CONNECT through the local proxy; resolves with the status line. */
function connectStatus(url) {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(port), '127.0.0.1', () => s.write('CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n'));
    let buf = '';
    s.on('data', (d) => { buf += d; const i = buf.indexOf('\r\n'); if (i >= 0) { s.destroy(); resolve(buf.slice(0, i)); } });
    s.on('error', reject);
    s.on('close', () => resolve(buf.split('\r\n')[0]));
  });
}

/** A temp home, a fake NTLM upstream for ACME\jdoe / S3cret! and the cmdProxy seams; every line any
 *  stream receives is kept in `seen` for the secret check. */
async function rig(t) {
  const home = mkdtempSync(join(tmpdir(), 'worca-cli-proxy-'));
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port });
  t.after(async () => { await fake.close(); origin.server.close(); rmSync(home, { recursive: true, force: true }); });
  const lines = [];
  const errs = [];
  const fails = [];
  const settings = () => ({ networkProxy: { enabled: true, upstream: fake.url() } });
  const run = (argv, extra = {}) => cmdProxy(argv, {
    out: (s) => lines.push(s), err: (s) => errs.push(s), fail: (s) => fails.push(s), env: {}, home,
    settings, ...extra,
  });
  const seen = () => [...lines, ...errs, ...fails].join('\n');
  return { home, fake, lines, errs, fails, settings, run, seen };
}

const assertNoSecrets = (text) => { for (const s of SECRETS) assert.ok(!text.includes(s), `secret ${s} in: ${text}`); };

test('status: needs login (exit 3) once the running breaker tripped; a stdin login makes it ready and resets the gate', async (t) => {
  const r = await rig(t);
  assert.equal(await r.run(['login'], { input: stdin('ACME\\jdoe\nwrong\n') }), 0);
  assert.ok(r.lines.some((l) => l.includes('ACME\\jdoe')));
  const policy = await startEgressPolicy({
    env: {}, proxyOn: () => true, settings: r.settings, login: () => readProxyLogin({ home: r.home }),
    watchLogin: () => () => {}, markRejected: (id, o) => markLoginRejected(id, { ...o, home: r.home }),
  });
  t.after(() => policy.close());
  assert.match(await connectStatus(policy.url), /^HTTP\/1\.1 407/);
  assert.ok(readProxyLogin({ home: r.home }).rejected, 'the trip marked the file');
  r.lines.length = 0;
  assert.equal(await r.run(['status']), 3);
  assert.ok(r.lines.some((l) => l.startsWith('State: needs login')), r.lines.join('\n'));

  assert.equal(await r.run(['login'], { input: stdin('ACME\\jdoe\nS3cret!\n') }), 0);
  assert.equal(readProxyLogin({ home: r.home }).rejected, null);
  r.lines.length = 0;
  assert.equal(await r.run(['status']), 0);
  assert.ok(r.lines.some((l) => l.startsWith('State: ready')), r.lines.join('\n'));
  assert.equal(policy.reloadLogin(), true);
  assert.equal(policy.connector.status().state, 'unverified');
  assert.match(await connectStatus(policy.url), /^HTTP\/1\.1 200/);
  assertNoSecrets(r.seen());
});

test('test: OK for both hosts with the right login', async (t) => {
  const r = await rig(t);
  await r.run(['login'], { input: stdin('ACME\\jdoe\nS3cret!\n') });
  r.lines.length = 0;
  assert.equal(await r.run(['test']), 0);
  assert.ok(r.lines.some((l) => /^github\.com\s+OK\s+via 127\.0\.0\.1:\d+/.test(l)), r.lines.join('\n'));
  assert.ok(r.lines.some((l) => /^api\.anthropic\.com\s+OK/.test(l)), r.lines.join('\n'));
});

test('test: a wrong login FAILs both hosts for one Type 3, and marks the file', async (t) => {
  const r = await rig(t);
  await r.run(['login'], { input: stdin('ACME\\jdoe\nwrong\n') });
  r.lines.length = 0;
  const before = r.fake.stats.type3;
  assert.equal(await r.run(['test']), 1);
  assert.equal(r.lines.filter((l) => /\sFAIL\s/.test(l)).length, 2, r.lines.join('\n'));
  assert.equal(r.fake.stats.type3 - before, 1);
  assert.ok(readProxyLogin({ home: r.home }).rejected);
  // The marker holds: a second test sends no Type 3 at all.
  assert.equal(await r.run(['test']), 1);
  assert.equal(r.fake.stats.type3 - before, 1);
  assertNoSecrets(r.seen());
});

test('login --password is a usage error and writes nothing', async (t) => {
  const r = await rig(t);
  assert.equal(await r.run(['login', '--password', 'x']), 2);
  assert.match(r.fails[0], /never takes a password/);
  assert.equal(await r.run(['login', '--pass=x']), 2);
  assert.equal(existsSync(join(r.home, PROXY_LOGIN_FILE)), false);
});

test('worca proxy status works with the proxy off and says so', async () => {
  const lines = [];
  const code = await cmdProxy(['status'], { out: (s) => lines.push(s), fail: () => {}, env: {}, settings: () => ({ networkProxy: { upstream: 'http://proxy.acme.example:8080' } }) });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /State: off: Worca connects directly/);
  assert.equal(lines[0], 'Corporate proxy: proxy.acme.example:8080 (no login, from settings)');
  assert.doesNotMatch(lines.join('\n'), /undefined/);
});

test('login and test work with the proxy off', async (t) => {
  const r = await rig(t);
  const off = () => ({ networkProxy: { enabled: false, upstream: r.fake.url() } });
  assert.equal(await r.run(['login'], { input: stdin('ACME\\jdoe\nS3cret!\n'), settings: off }), 0);
  assert.equal(readProxyLogin({ home: r.home }).user, 'jdoe');
  assert.equal(await r.run(['test'], { settings: off }), 0);
});

test('AC-2.6 wiring: worca main() migrates the flag and starts the live egress before any command', () => {
  const src = readFileSync(new URL('../src/cli/worca-cc.mjs', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('async function main('));
  const mig = main.indexOf('migrateCorporateProxyFlag()');
  const live = main.indexOf('startLiveEgress(');
  assert.ok(mig > 0 && live > mig, 'migration first, then startLiveEgress');
  assert.equal(/startEgressPolicy\(/.test(main), false, 'no static start left in main()');
});

test('login with auth basic exits 1; logout deletes the login', async (t) => {
  const r = await rig(t);
  assert.equal(await r.run(['login'], { input: stdin('ACME\\jdoe\nS3cret!\n'), settings: () => ({ networkProxy: { upstream: r.fake.url(), auth: 'basic' } }) }), 1);
  assert.match(r.errs.join('\n'), /basic/);
  assert.equal(existsSync(join(r.home, PROXY_LOGIN_FILE)), false);
  await r.run(['login', '--user', 'ACME\\jdoe'], { input: stdin('S3cret!\n') });
  assert.equal(readProxyLogin({ home: r.home }).user, 'jdoe');
  assert.equal(await r.run(['logout']), 0);
  assert.equal(existsSync(join(r.home, PROXY_LOGIN_FILE)), false);
  assert.equal(await r.run(['nope']), 2);
});

test('a TTY login prompts for the user, then reads the password hidden', async (t) => {
  const r = await rig(t);
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (on) => { input.isRaw = on; return input; };
  let prompted = '';
  const prompt = new Writable({ write(chunk, _enc, cb) { prompted += chunk; cb(); } });
  const done = r.run(['login'], { input, prompt });
  const waitFor = async (text) => { const t0 = Date.now(); while (!prompted.includes(text)) { if (Date.now() - t0 > 3000) throw new Error(`no prompt ${text}: ${prompted}`); await new Promise((res) => setTimeout(res, 5)); } };
  await waitFor('User (DOMAIN\\user): ');
  input.write('jdoe\r');
  await waitFor('Password for jdoe: ');
  input.write('S3cret!\r');
  assert.equal(await done, 0);
  assert.equal(input.isRaw, false, 'raw mode restored');
  const saved = JSON.parse(readFileSync(join(r.home, PROXY_LOGIN_FILE), 'utf8'));
  assert.equal(saved.user, 'jdoe');
  assert.equal(saved.ntHash, ntHash('S3cret!').toString('hex'));
  assert.ok(!prompted.includes('S3cret!'));
  assertNoSecrets(prompted + r.seen());
});

test('spawned: `worca proxy help` is wired, and `worca proxy status` starts no local proxy', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'worca-cli-proxy-spawn-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home };
  delete env.WORCA_HOST_PID;
  delete env.NODE_TEST_CONTEXT;
  const help = spawnSync(process.execPath, [CLI, 'proxy', 'help'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes('worca proxy <command>'), help.stdout);
  const status = spawnSync(process.execPath, [CLI, 'proxy', 'status'], { env: { ...env, HTTPS_PROXY: 'http://127.0.0.1:9' }, encoding: 'utf8', timeout: 30_000 });
  assert.ok(status.stdout.includes('State: '), status.stdout + status.stderr);
  assert.doesNotMatch(status.stderr, /worca: Corporate proxy: via/);
});

test('status: prints the fixed local proxy URL, or says a free port is picked', async (t) => {
  const r = await rig(t);
  await r.run(['status'], { settings: () => ({ networkProxy: { upstream: r.fake.url(), fixedPort: 3128 } }) });
  assert.ok(r.lines.includes('Local proxy: http://127.0.0.1:3128'), r.lines.join('\n'));
  r.lines.length = 0;
  await r.run(['status']);
  assert.ok(r.lines.includes('Local proxy: a free port picked when Worca starts (set networkProxy.fixedPort to pin one)'), r.lines.join('\n'));
  assertNoSecrets(r.seen());
});

test('login with auth digest exits 1: a saved login keeps only the NT hash', async (t) => {
  const r = await rig(t);
  assert.equal(await r.run(['login'], { input: stdin('ACME\\jdoe\nS3cret!\n'),
    settings: () => ({ networkProxy: { upstream: r.fake.url(), auth: 'digest' } }) }), 1);
  assert.match(r.errs.join('\n'), /networkProxy\.auth is digest/);
  assert.equal(existsSync(join(r.home, PROXY_LOGIN_FILE)), false, 'nothing was saved');
  assertNoSecrets(r.seen());
});
