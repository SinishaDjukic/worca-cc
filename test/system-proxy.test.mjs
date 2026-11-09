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

// Linux probes: no WSL and no proxy variables unless a test says so, so the host running the tests never leaks in.
const linux = (o) => detectSystemProxy({ platform: 'linux', env: {}, readImpl: async () => 'Linux version 6.8.0-generic',
  accessImpl: async () => { throw new Error('ENOENT'); }, ...o });
const kde = (keys, bin = 'kreadconfig6') => async (cmd, args) => (cmd === bin ? (keys[args[args.length - 1]] ?? '') : null);

test('Linux (GNOME): manual with ignore-hosts; auto with a PAC URL; no gsettings', async () => {
  const answers = (map) => async (cmd, args) => map[args.slice(1).join(' ')] ?? null;
  const manual = await linux({ runImpl: answers({
    'org.gnome.system.proxy mode': "'manual'", 'org.gnome.system.proxy ignore-hosts': "['localhost', '127.0.0.0/8', '.corp.example.com']",
    'org.gnome.system.proxy.https host': "'proxy.example.com'", 'org.gnome.system.proxy.https port': '8080' }) });
  assert.deepEqual([manual.found, manual.host, manual.port, manual.noProxy], [true, 'proxy.example.com', 8080, ['localhost', '.corp.example.com']]);
  const auto = await linux({ runImpl: answers({ 'org.gnome.system.proxy mode': "'auto'", 'org.gnome.system.proxy autoconfig-url': "'http://wpad.example.com/proxy.pac'" }),
    fetchPacImpl: async () => PAC, evaluate });
  assert.deepEqual([auto.found, auto.source, auto.host], [true, 'pac', 'proxy.example.com']);
  const missing = await linux({ runImpl: async () => null });
  assert.equal(missing.found, false);
});

test('Linux (KDE): manual with NoProxyFor, both value forms; a PAC URL or path; WPAD', async () => {
  const man = await linux({ runImpl: kde({ ProxyType: '1', httpsProxy: 'http://proxy.example.com 8080', httpProxy: 'http://http.example.com:3128',
    NoProxyFor: 'localhost, 127.0.0.1 .corp.example.com' }) });
  assert.deepEqual([man.found, man.source, man.host, man.port, man.noProxy, man.line],
    [true, 'manual', 'proxy.example.com', 8080, ['localhost', '.corp.example.com'], 'From your KDE proxy settings.']);
  const old = await linux({ runImpl: kde({ ProxyType: '1', httpProxy: 'http://jdoe:secret@http.example.com:3128' }, 'kreadconfig5') });
  assert.deepEqual([old.host, old.port], ['http.example.com', 3128], 'kreadconfig5 is asked when 6 is missing');
  assert.doesNotMatch(JSON.stringify(old), /secret|jdoe/);
  const fetched = [];
  const pac = await linux({ runImpl: kde({ ProxyType: '2', 'Proxy Config Script': 'http://wpad.example.com/proxy.pac' }), fetchPacImpl: async (u) => { fetched.push(u); return PAC; }, evaluate });
  assert.deepEqual([pac.source, pac.host, fetched], ['pac', 'proxy.example.com', ['http://wpad.example.com/proxy.pac']]);
  const wpad = await linux({ runImpl: kde({ ProxyType: '3' }), fetchPacImpl: async (u) => { fetched.push(u); return PAC; }, evaluate });
  assert.deepEqual([wpad.source, fetched.at(-1)], ['wpad', 'http://wpad/wpad.dat']);
  await linux({ runImpl: kde({ ProxyType: '2', 'Proxy Config Script': '/home/u/proxy.pac' }), fetchPacImpl: async (u) => { fetched.push(u); return PAC; }, evaluate });
  assert.equal(fetched.at(-1), 'file:///home/u/proxy.pac', 'a bare path is a local file');
});

test('Linux (KDE): ReversedException proxies only the hosts listed; SOCKS is never offered', async () => {
  const only = (list) => kde({ ProxyType: '1', httpsProxy: 'http://proxy.example.com:8080', NoProxyFor: list, ReversedException: 'true' });
  const direct = await linux({ runImpl: only('.corp.example.com,intranet') });
  assert.deepEqual(direct, { found: false, source: 'manual', direct: true, line: 'Your KDE settings send api.anthropic.com direct: no proxy is needed.' });
  const listed = await linux({ runImpl: only('*.anthropic.com') });
  assert.deepEqual([listed.found, listed.host, listed.noProxy], [true, 'proxy.example.com', []]);
  const socks = await linux({ runImpl: kde({ ProxyType: '1', httpsProxy: 'socks5://socks.example.com 1080', httpProxy: 'http://proxy.example.com:3128' }) });
  assert.deepEqual([socks.host, socks.port], ['proxy.example.com', 3128]);
});

test('Linux (KDE): "use the environment" reads the variables it names', async () => {
  const r = await linux({ env: { CORP_PROXY: 'http://proxy.example.com:8080', HTTPS_PROXY: 'http://other.example.com:1' },
    runImpl: kde({ ProxyType: '4', httpsProxy: 'CORP_PROXY' }) });
  assert.deepEqual([r.source, r.host, r.port, r.line], ['env', 'proxy.example.com', 8080, 'From the CORP_PROXY Worca started with.']);
});

test('Linux: GNOME answers before KDE; GNOME mode none falls through to KDE', async () => {
  const both = async (cmd, args) => (cmd === 'gsettings' ? { mode: "'manual'", host: "'gnome.example.com'", port: '3128' }[args[2]] ?? "''" : kde({ ProxyType: '1', httpsProxy: 'http://kde.example.com:8080' })(cmd, args));
  assert.equal((await linux({ runImpl: both })).host, 'gnome.example.com');
  const off = async (cmd, args) => (cmd === 'gsettings' ? "'none'" : kde({ ProxyType: '1', httpsProxy: 'http://kde.example.com:8080' })(cmd, args));
  assert.equal((await linux({ runImpl: off })).host, 'kde.example.com');
});

test('Linux: the proxy variables Worca started with are the last resort; never its own local proxy', async () => {
  const env = { HTTPS_PROXY: 'http://jdoe:secret@proxy.example.com:8080', NO_PROXY: 'localhost,10.0.0.0/8,.corp.example.com' };
  const r = await linux({ env, runImpl: async () => null });
  assert.deepEqual([r.found, r.source, r.host, r.port, r.noProxy, r.line],
    [true, 'env', 'proxy.example.com', 8080, ['localhost', '.corp.example.com'], 'From the HTTPS_PROXY Worca started with.']);
  assert.doesNotMatch(JSON.stringify(r), /secret|jdoe/);
  const socks = await linux({ env: { https_proxy: 'socks5h://127.0.0.1:1080' }, runImpl: async () => null });
  assert.equal(socks.found, false, 'a SOCKS URL is not an HTTP proxy');
  const local = await linux({ env: { HTTPS_PROXY: 'http://127.0.0.1:41234', WORCA_EGRESS_PROXY_URL: 'http://127.0.0.1:41234' }, runImpl: async () => null });
  assert.deepEqual(local, { found: false, source: 'none', line: 'Found no proxy in the GNOME or KDE settings, nor in HTTPS_PROXY / HTTP_PROXY.' });
  const pacDown = await linux({ env, runImpl: async (cmd, args) => (cmd === 'gsettings' ? { mode: "'auto'", 'autoconfig-url': "'http://wpad.example.com/p.pac'" }[args[2]] : null),
    fetchPacImpl: async () => { throw new Error('the PAC file at wpad.example.com did not answer'); } });
  assert.equal(pacDown.source, 'env', 'an unreadable PAC still lets the variables answer');
});

test('WSL: Windows is asked through powershell.exe, with a timeout, before the desktop settings', async () => {
  const calls = [];
  const win = JSON.stringify({ enable: 1, server: 'proxy.example.com:8080', override: '<local>;*.corp.example.com', resolved: 'http://proxy.example.com:8080/', bypassed: false });
  const runImpl = async (cmd, args, opts) => { calls.push([cmd, opts?.timeoutMs]); return cmd.endsWith('powershell.exe') ? win : null; };
  const r = await linux({ readImpl: async () => 'Linux version 5.15.167.4-microsoft-standard-WSL2', accessImpl: async () => {}, runImpl });
  assert.deepEqual([r.source, r.host, r.noProxy, r.line], ['manual', 'proxy.example.com', ['*.corp.example.com'], 'From your Windows proxy settings.']);
  assert.deepEqual(calls[0], ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 15000]);
  const timedOut = []; await linux({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, runImpl: async (cmd) => { timedOut.push(cmd); return null; } });
  assert.deepEqual(timedOut.filter((c) => c.endsWith('powershell.exe')), ['powershell.exe'], 'one run: the PATH one when C: is not mounted, never retried');
  const byEnv = await linux({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, readImpl: async () => { throw new Error('no /proc'); },
    runImpl: async (cmd) => (cmd === 'powershell.exe' ? JSON.stringify({ enable: 0, resolved: 'https://api.anthropic.com/', bypassed: true }) : null) });
  assert.deepEqual(byEnv, { found: false, source: 'none', line: 'Found no proxy in the Windows, GNOME or KDE settings, nor in HTTPS_PROXY / HTTP_PROXY.' });
  const loop = (env) => linux({ env: { WSL_DISTRO_NAME: 'Ubuntu', ...env },
    runImpl: async (cmd) => (cmd === 'powershell.exe' ? JSON.stringify({ enable: 1, server: '127.0.0.1:3128', resolved: 'http://127.0.0.1:3128/', bypassed: false }) : null) });
  const alone = await loop({});
  assert.deepEqual([alone.found, alone.host, alone.line], [true, '127.0.0.1',
    'From your Windows proxy settings. It is 127.0.0.1:3128 on Windows, which WSL reaches only in mirrored networking mode.']);
  assert.equal('loopback' in alone, false);
  assert.equal((await loop({ HTTPS_PROXY: 'http://proxy.example.com:8080' })).host, 'proxy.example.com', 'a Linux source answers first');
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
