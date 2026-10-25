// test/system-proxy.test.mjs — Auto-detect: the proxy this machine's settings pick for api.anthropic.com
// (src/core/system-proxy.mjs), and the sandboxed PAC evaluator (src/core/pac-eval.mjs). System output is
// recorded text; the PAC scripts run in the real worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectSystemProxy, parseScutil, parseWinProxyServer, readWindowsAnswer, usableBypass, hostPort, fetchPac } from '../src/core/system-proxy.mjs';
import { evaluatePac, parsePacResult } from '../src/core/pac-eval.mjs';

const PAC = `function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || shExpMatch(host, "*.corp.example.com")) return "DIRECT";
  if (isInNet(dnsResolve(host), "10.0.0.0", "255.0.0.0")) return "DIRECT";
  return "PROXY proxy.example.com:8080; PROXY backup.example.com:3128; DIRECT";
}`;
const dnsLookup = async (h) => (h === 'api.anthropic.com' ? '160.79.104.10' : null);
const evaluate = (script, url) => evaluatePac(script, url, { dnsLookup });

const SCUTIL_PAC = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://wpad.example.com/proxy.pac
}`;
const SCUTIL_MANUAL = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
    2 : intranet.example.com
  }
  HTTPEnable : 1
  HTTPPort : 3128
  HTTPProxy : http.example.com
  HTTPSEnable : 1
  HTTPSPort : 8080
  HTTPSProxy : proxy.example.com
}`;
const SCUTIL_NONE = '<dictionary> {\n  ExceptionsList : <array> {\n    0 : *.local\n  }\n  FTPPassive : 1\n}';

test('parsers: scutil keys and lists, Windows ProxyServer forms, host:port, usable bypass entries', () => {
  const s = parseScutil(SCUTIL_MANUAL);
  assert.deepEqual([s.HTTPSProxy, s.HTTPSPort, s.ExceptionsList], ['proxy.example.com', '8080', ['*.local', '169.254/16', 'intranet.example.com']]);
  assert.deepEqual(parseWinProxyServer('proxy.example.com:8080'), { host: 'proxy.example.com', port: 8080 });
  assert.deepEqual(parseWinProxyServer('http=a.example.com:80;https=b.example.com:443'), { host: 'b.example.com', port: 443 });
  assert.deepEqual(hostPort('http://jdoe:secret@proxy.example.com:8080/'), { host: 'proxy.example.com', port: 8080 }, 'a login is never kept');
  assert.deepEqual(usableBypass(['*.local', '169.254/16', '<local>', '10.1.2.3', 'intranet.example.com', '*.local']), ['*.local', 'intranet.example.com']);
  assert.deepEqual(parsePacResult('PROXY a.example.com:1; SOCKS s:2; HTTPS b.example.com; DIRECT'),
    [{ type: 'proxy', host: 'a.example.com', port: 1 }, { type: 'other', value: 'SOCKS s:2' }, { type: 'proxy', host: 'b.example.com', port: 443 }, { type: 'direct' }]);
});

test('macOS: a PAC URL is fetched and evaluated; the first proxy fills in, the others are listed', async () => {
  const fetched = [];
  const r = await detectSystemProxy({ platform: 'darwin', runImpl: async () => SCUTIL_PAC, fetchPacImpl: async (u) => { fetched.push(u); return PAC; }, evaluate });
  assert.deepEqual(fetched, ['http://wpad.example.com/proxy.pac']);
  assert.equal(r.found, true);
  assert.deepEqual([r.source, r.host, r.port, r.also, r.noProxy], ['pac', 'proxy.example.com', 8080, ['backup.example.com:3128'], []]);
  assert.equal(r.line, "From your system's PAC file (wpad.example.com). It also lists backup.example.com:3128.");
});

test('macOS: a manual HTTPS proxy wins over HTTP and brings its usable exceptions', async () => {
  const r = await detectSystemProxy({ platform: 'darwin', runImpl: async () => SCUTIL_MANUAL });
  assert.deepEqual([r.found, r.source, r.host, r.port, r.noProxy], [true, 'manual', 'proxy.example.com', 8080, ['*.local', 'intranet.example.com']]);
  assert.equal(r.line, 'From your macOS proxy settings.');
});

test('macOS: nothing set, a PAC that goes direct, an unreadable PAC', async () => {
  assert.deepEqual(await detectSystemProxy({ platform: 'darwin', runImpl: async () => SCUTIL_NONE }), { found: false, source: 'none', line: 'No proxy is set in your macOS settings.' });
  const direct = await detectSystemProxy({ platform: 'darwin', runImpl: async () => SCUTIL_PAC, fetchPacImpl: async () => 'function FindProxyForURL(){ return "DIRECT"; }', evaluate });
  assert.deepEqual([direct.found, direct.direct, direct.line], [false, true, 'Your PAC file sends api.anthropic.com direct: no proxy is needed.']);
  const down = await detectSystemProxy({ platform: 'darwin', runImpl: async () => SCUTIL_PAC, fetchPacImpl: async () => { throw new Error('the PAC file at wpad.example.com did not answer'); } });
  assert.equal(down.line, "Couldn't read your system's PAC file: the PAC file at wpad.example.com did not answer.");
});

test('Windows: the system resolver answers; the registry says PAC, manual (with its bypass list) or WPAD', () => {
  const pac = readWindowsAnswer(JSON.stringify({ enable: 0, pac: 'http://wpad.example.com/proxy.pac', resolved: 'http://proxy.example.com:8080/', bypassed: false }));
  assert.deepEqual([pac.found, pac.source, pac.host, pac.port], [true, 'pac', 'proxy.example.com', 8080]);
  const man = readWindowsAnswer(JSON.stringify({ enable: 1, server: 'proxy.example.com:8080', override: '<local>;*.corp.example.com', resolved: 'http://proxy.example.com:8080/', bypassed: false }));
  assert.deepEqual([man.source, man.noProxy], ['manual', ['*.corp.example.com']]);
  const wpad = readWindowsAnswer(JSON.stringify({ enable: 0, resolved: 'http://proxy.example.com:3128/', bypassed: false }));
  assert.deepEqual([wpad.source, wpad.port], ['wpad', 3128]);
  const none = readWindowsAnswer(JSON.stringify({ enable: 0, resolved: 'https://api.anthropic.com/', bypassed: true }));
  assert.deepEqual([none.found, none.line], [false, 'No proxy is set in your Windows settings.']);
});

test('Linux (GNOME): manual with ignore-hosts; auto with a PAC URL; no gsettings', async () => {
  const answers = (map) => async (cmd, args) => map[args.slice(1).join(' ')] ?? null;
  const manual = await detectSystemProxy({ platform: 'linux', runImpl: answers({
    'org.gnome.system.proxy mode': "'manual'", 'org.gnome.system.proxy ignore-hosts': "['localhost', '127.0.0.0/8', '.corp.example.com']",
    'org.gnome.system.proxy.https host': "'proxy.example.com'", 'org.gnome.system.proxy.https port': '8080' }) });
  assert.deepEqual([manual.found, manual.host, manual.port, manual.noProxy], [true, 'proxy.example.com', 8080, ['localhost', '.corp.example.com']]);
  const auto = await detectSystemProxy({ platform: 'linux', runImpl: answers({ 'org.gnome.system.proxy mode': "'auto'", 'org.gnome.system.proxy autoconfig-url': "'http://wpad.example.com/proxy.pac'" }),
    fetchPacImpl: async () => PAC, evaluate });
  assert.deepEqual([auto.found, auto.source, auto.host], [true, 'pac', 'proxy.example.com']);
  const missing = await detectSystemProxy({ platform: 'linux', runImpl: async () => null });
  assert.equal(missing.found, false);
});

test('a PAC address with a login is fetched with it and answered without it', async () => {
  const withLogin = SCUTIL_PAC.replace('http://wpad.example.com/proxy.pac', 'http://jdoe:secret@wpad.example.com/proxy.pac');
  const fetched = [];
  const r = await detectSystemProxy({ platform: 'darwin', runImpl: async () => withLogin, fetchPacImpl: async (u) => { fetched.push(u); return PAC; }, evaluate });
  assert.deepEqual(fetched, ['http://jdoe:secret@wpad.example.com/proxy.pac']);
  assert.equal(r.pacUrl, 'http://wpad.example.com/proxy.pac');
  assert.doesNotMatch(JSON.stringify(r), /secret|jdoe/);
  const win = readWindowsAnswer(JSON.stringify({ enable: 0, pac: 'http://jdoe:secret@wpad.example.com/p.pac', resolved: 'http://proxy.example.com:8080/', bypassed: false }));
  assert.doesNotMatch(JSON.stringify(win), /secret|jdoe/);
});

test('fetchPac: only http(s) and file addresses; a size cap', async () => {
  await assert.rejects(fetchPac('ftp://wpad.example.com/proxy.pac'), /a ftp: PAC address is not supported/);
  await assert.rejects(fetchPac('http://wpad.example.com/x', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /answered 404/);
  await assert.rejects(fetchPac('http://wpad.example.com/x', { fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(1024 * 1024 + 1) }) }), /larger than 1 MB/);
  assert.equal(await fetchPac('file:///etc/proxy.pac', { readImpl: async () => PAC }), PAC);
});

test('PAC sandbox: no file access, no processes, a time limit, and DNS answered by the parent', async () => {
  const esc = (body) => `function FindProxyForURL(){ try { const P = this.constructor.constructor("return process")(); ${body} } catch (e) { return "BLOCKED " + (e && e.message); } }`;
  const marker = join(tmpdir(), `worca-pac-${process.pid}`);
  // The context has no object from the worker's realm, so the classic climb to `process` is refused outright.
  for (const body of [
    'return "READ " + P.getBuiltinModule("fs").readFileSync("/etc/hosts", "utf8");',
    `P.getBuiltinModule("fs").writeFileSync(${JSON.stringify(marker)}, "x"); return "WROTE";`,
    'return "RAN " + P.getBuiltinModule("child_process").execSync("id");',
  ]) assert.match((await evaluatePac(esc(body), 'https://api.anthropic.com/')).raw, /^BLOCKED /, body);
  const globals = await evaluatePac('function FindProxyForURL(){ return [typeof process, typeof require, typeof fetch, typeof WebSocket].join(","); }', 'https://api.anthropic.com/');
  assert.equal(globals.raw, 'undefined,undefined,undefined,undefined');
  assert.equal(existsSync(marker), false); rmSync(marker, { force: true });
  assert.deepEqual(await evaluatePac('while (true) {}', 'https://api.anthropic.com/'), { error: 'the PAC file took too long' });
  assert.deepEqual(await evaluatePac('var x = 1;', 'https://api.anthropic.com/'), { error: 'the PAC file has no FindProxyForURL function' });
  const asked = [];
  const r = await evaluatePac(PAC, 'https://api.anthropic.com/', { dnsLookup: async (h) => { asked.push(h); return '10.1.2.3'; } });
  assert.deepEqual([asked, r.raw], [['api.anthropic.com'], 'DIRECT'], 'an address in 10/8 goes direct');
});
