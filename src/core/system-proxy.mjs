// src/core/system-proxy.mjs — GET /api/proxy/detect: the proxy this machine's own settings pick for
// api.anthropic.com, so the setup assistant and the Network proxy card can fill in host and port.
// Worca still chains to that one fixed proxy (docs/network-proxy.md): detection only reads.
//   macOS    `scutil --proxy`: a PAC URL, auto-discovery (WPAD) or a manual HTTPS/HTTP proxy.
//   Windows  Windows PowerShell asks the system itself (GetSystemWebProxy evaluates PAC and WPAD);
//            the registry says which kind it was and holds the manual bypass list.
//   Linux    under WSL, Windows itself first (the same PowerShell question, through interop); then GNOME
//            `gsettings org.gnome.system.proxy` (auto: a PAC URL or WPAD; manual), then KDE's kioslaverc
//            through kreadconfig6/5 (manual, PAC URL, WPAD, or "use the environment"); last, the
//            HTTPS_PROXY / HTTP_PROXY / NO_PROXY Worca started with (before its own local proxy took them).
// A PAC script is evaluated by pac-eval.mjs, never in this process. Probes are injected for tests.
import { execFile } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluatePac } from './pac-eval.mjs';
import { loadUndici } from './env-proxy.mjs';
import { upstreamEnv } from './proxy-credentials.mjs';

export const DETECT_TARGET = 'https://api.anthropic.com/';
const WPAD_URL = 'http://wpad/wpad.dat';
const PAC_MAX_BYTES = 1024 * 1024;

const run = (cmd, args, { timeoutMs = 5000 } = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout)));
});

/** One direct (no proxy) Agent: the server's global dispatcher may itself route through the local proxy. */
let directAgent;
function directFetch(url, opts = {}) {
  const undici = loadUndici();
  if (!undici) return fetch(url, opts);
  directAgent ??= new undici.Agent();
  return fetch(url, { ...opts, dispatcher: directAgent });
}

/** A PAC file's text from an http(s) or file URL, at most 1 MB, in 4 s. Throws a plain-words Error. */
export async function fetchPac(url, { fetchImpl = directFetch, readImpl = readFile } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`the PAC address is not a URL (${String(url).slice(0, 80)})`); }
  if (u.protocol === 'file:') {
    const text = await readImpl(fileURLToPath(u), 'utf8').catch(() => { throw new Error(`the PAC file ${u.pathname} could not be read`); });
    if (text.length > PAC_MAX_BYTES) throw new Error('the PAC file is larger than 1 MB');
    return text;
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`a ${u.protocol} PAC address is not supported`);
  let res;
  try { res = await fetchImpl(u.href, { signal: AbortSignal.timeout(4000), redirect: 'follow' }); }
  catch { throw new Error(`the PAC file at ${u.host} did not answer`); }
  if (!res.ok) throw new Error(`the PAC file at ${u.host} answered ${res.status}`);
  const text = await res.text();
  if (text.length > PAC_MAX_BYTES) throw new Error('the PAC file is larger than 1 MB');
  return text;
}

/** A PAC address as it may be shown: any user:password@ dropped (an intranet PAC URL can carry a login). */
export function safePacUrl(raw) {
  try { const u = new URL(raw); u.username = ''; u.password = ''; return u.href; } catch { return String(raw || '').replace(/\/\/[^@/]*@/, '//'); }
}

/** No-proxy entries Worca can use: CIDR ranges never match in Worca and `<local>` has no equivalent, so they are dropped. */
export function usableBypass(list) {
  return [...new Set((list || []).map((s) => String(s).trim()).filter((s) => s && !s.includes('/') && s !== '<local>' && !/^[\d.:]+$/.test(s)))];
}

/** host[:port] with any scheme and login stripped; null when it is not one. */
export function hostPort(raw, defaultPort = 8080) {
  const s = String(raw || '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').replace(/\/.*$/, '');
  const m = /^\[?([^\]\s:]+)\]?(?::(\d{1,5}))?$/.exec(s);
  return m ? { host: m[1], port: m[2] ? Number(m[2]) : defaultPort } : null;
}

/** `scutil --proxy` → its top-level keys, ExceptionsList as an array. */
export function parseScutil(text) {
  const out = {}; let list = null;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (list) { if (t === '}') { list = null; continue; } const m = /^\d+ : (.+)$/.exec(t); if (m) list.push(m[1]); continue; }
    const arr = /^(\w+) : <array> \{$/.exec(t);
    if (arr) { out[arr[1]] = list = []; continue; }
    const kv = /^(\w+) : (.+)$/.exec(t);
    if (kv && line.startsWith('  ') && !line.startsWith('    ')) out[kv[1]] = kv[2];
  }
  return out;
}

/** Windows `ProxyServer`: "host:port" or "http=a:1;https=b:2". The https entry wins, then http, then the bare one. */
export function parseWinProxyServer(raw) {
  const parts = String(raw || '').split(';').map((s) => s.trim()).filter(Boolean);
  const named = Object.fromEntries(parts.filter((p) => p.includes('=')).map((p) => { const [k, v] = p.split('='); return [k.toLowerCase(), v]; }));
  return hostPort(named.https || named.http || parts.find((p) => !p.includes('=')) || '');
}

/** gsettings prints strings as 'x' and lists as ['a', 'b']. */
const gstr = (s) => String(s || '').trim().replace(/^'(.*)'$/, '$1');
const glist = (s) => [...String(s || '').matchAll(/'([^']*)'/g)].map((m) => m[1]);

/** What a PAC script picks for the target, as a detect answer. */
async function fromPac(fetchUrl, source, { fetchPacImpl, evaluate, target }) {
  const pacUrl = safePacUrl(fetchUrl);   // fetched with its login, answered without it
  let script;
  try { script = await fetchPacImpl(fetchUrl); } catch (err) { return { found: false, source, pacUrl, line: `Couldn't read your system's PAC file: ${err.message}.` }; }
  const r = await evaluate(script, target);
  if (r.error) return { found: false, source, pacUrl, line: `Couldn't use your system's PAC file: ${r.error}.` };
  const proxies = r.entries.filter((e) => e.type === 'proxy');
  if (!proxies.length) {
    return { found: false, source, pacUrl, direct: r.entries.some((e) => e.type === 'direct'),
      line: r.entries.some((e) => e.type === 'direct') ? 'Your PAC file sends api.anthropic.com direct: no proxy is needed.' : `Your PAC file picks no proxy Worca can use (${r.raw || 'empty answer'}).` };
  }
  const [first, ...rest] = proxies;
  const label = source === 'wpad' ? 'auto-discovery (WPAD)' : 'PAC file';
  return { found: true, source, pacUrl, host: first.host, port: first.port, noProxy: [], also: rest.map((p) => `${p.host}:${p.port}`),
    line: `From your system's ${label} (${new URL(pacUrl).host || pacUrl}).${rest.length ? ` It also lists ${rest.map((p) => `${p.host}:${p.port}`).join(', ')}.` : ''}` };
}

const manual = (hp, bypass, where) => ({ found: true, source: 'manual', host: hp.host, port: hp.port, noProxy: usableBypass(bypass), also: [],
  line: `From your ${where} proxy settings.` });
const NONE = (where) => ({ found: false, source: 'none', line: `No proxy is set in your ${where} settings.` });

async function detectMac({ runImpl, ...pac }) {
  const out = await runImpl('/usr/sbin/scutil', ['--proxy']);   // absolute: a service's PATH may lack /usr/sbin
  if (out == null) return { found: false, source: 'error', line: "Couldn't read the macOS proxy settings." };
  const s = parseScutil(out);
  if (s.ProxyAutoConfigEnable === '1' && s.ProxyAutoConfigURLString) return fromPac(s.ProxyAutoConfigURLString, 'pac', pac);
  if (s.ProxyAutoDiscoveryEnable === '1') { const r = await fromPac(WPAD_URL, 'wpad', pac); if (r.found || r.direct) return r; }
  for (const k of ['HTTPS', 'HTTP']) {
    if (s[`${k}Enable`] === '1' && s[`${k}Proxy`]) return manual({ host: s[`${k}Proxy`], port: Number(s[`${k}Port`]) || 8080 }, s.ExceptionsList, 'macOS');
  }
  return NONE('macOS');
}

// Windows PowerShell 5.1 ships with every Windows; its GetSystemWebProxy is the system's own resolver (PAC, WPAD, manual).
const WIN_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$k=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'",
  `$u=[Uri]'${DETECT_TARGET}'`,
  '$p=[System.Net.WebRequest]::GetSystemWebProxy()',
  '@{enable=$k.ProxyEnable;server=$k.ProxyServer;override=$k.ProxyOverride;pac=$k.AutoConfigURL;resolved=$p.GetProxy($u).AbsoluteUri;bypassed=$p.IsBypassed($u)}|ConvertTo-Json -Compress',
].join(';');

export function readWindowsAnswer(json, target = DETECT_TARGET) {
  let w; try { w = JSON.parse(json); } catch { return { found: false, source: 'error', line: "Couldn't read the Windows proxy settings." }; }
  const resolved = w.resolved && !w.bypassed && w.resolved !== target ? hostPort(w.resolved, 80) : null;
  if (!resolved) return w.pac || w.enable === 1 ? { found: false, source: w.pac ? 'pac' : 'manual', direct: true, line: 'Your Windows settings send api.anthropic.com direct: no proxy is needed.' } : NONE('Windows');
  if (w.pac) return { found: true, source: 'pac', pacUrl: safePacUrl(w.pac), ...resolved, noProxy: [], also: [], line: `From your system's PAC file (${(() => { try { return new URL(w.pac).host; } catch { return w.pac; } })()}).` };
  if (w.enable === 1 && w.server) return manual(resolved, String(w.override || '').split(';'), 'Windows');
  return { found: true, source: 'wpad', ...resolved, noProxy: [], also: [], line: 'From your system\'s auto-discovery (WPAD).' };
}

const WIN_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT];
const WIN_ERROR = { found: false, source: 'error', line: "Couldn't read the Windows proxy settings." };

async function detectWindows({ runImpl, target }) {
  // Windows PowerShell 5.1 by its full path (a service's PATH may lack it); WPAD discovery can take a few seconds.
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const out = await runImpl(`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, WIN_ARGS, { timeoutMs: 15_000 });
  return out == null ? WIN_ERROR : readWindowsAnswer(out, target);
}

/** WSL: WSL_DISTRO_NAME (set by every WSL shell), else a Microsoft kernel in /proc/version (a service's env may lack it). */
async function isWsl(env, readImpl) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  const v = await readImpl('/proc/version', 'utf8').catch(() => '');
  return /microsoft|wsl/i.test(String(v));
}

const WSL_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const isLoopback = (h) => /^(localhost|127\.[\d.]+|::1)$/i.test(h);

/**
 * WSL asks Windows through interop, once: the usual C: mount, else powershell.exe on the Windows PATH WSL appends
 * (a timed-out run is not retried: WPAD discovery alone can take that long). A proxy on Windows' own loopback is
 * reachable only in mirrored networking, so that answer says so and is used only when no Linux source answers.
 */
async function detectWsl({ runImpl, accessImpl, target }) {
  const exe = await accessImpl(WSL_POWERSHELL).then(() => WSL_POWERSHELL, () => 'powershell.exe');
  const out = await runImpl(exe, WIN_ARGS, { timeoutMs: 15_000 });
  if (out == null) return null;
  const r = readWindowsAnswer(out, target);
  if (!r.found || !isLoopback(r.host)) return r;
  return { ...r, loopback: true,
    line: `${r.line} It is ${r.host}:${r.port} on Windows, which WSL reaches only in mirrored networking mode.` };
}

/** host:port from an http:// (or scheme-less) proxy URL; null for another scheme: Worca chains to an HTTP proxy only. */
function httpHostPort(raw) {
  const v = String(raw || '').trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^http:\/\//i.test(v) ? null : hostPort(v);
}

/** KDE's proxy value: "http://host:port" or, in newer Plasma, "http://host port". */
const kdeHostPort = (raw) => httpHostPort(String(raw || '').trim().replace(/\s+(\d{1,5})$/, ':$1'));

/** A KDE NoProxyFor entry (host, .domain or *.domain) matching `host`. */
const kdeMatches = (entry, host) => {
  const e = entry.toLowerCase().replace(/^\*/, '');
  return e.startsWith('.') ? host === e.slice(1) || host.endsWith(e) : host === e || host.endsWith(`.${e}`);
};
const kdeList = (raw) => String(raw || '').split(/[\s,]+/).filter(Boolean);
const STANDARD_VARS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'];

/** The proxy variables as an answer: HTTPS first, like Worca itself reads them (upstream-proxy.mjs). */
function fromEnv(env, names = {}) {
  // A name KDE gives (type 4) is read from Worca's own environment too: the pre-swap snapshot holds only the
  // standard variables, and Worca's local proxy only ever takes those.
  const value = (k) => env[k] ?? (STANDARD_VARS.includes(k) ? undefined : process.env[k]);
  const pick = (...ks) => ks.map((k) => [k, value(k)]).find(([, v]) => v);
  const [name, raw] = pick(...[names.https, names.http].filter(Boolean), ...STANDARD_VARS) || [];
  const hp = raw ? httpHostPort(raw) : null;
  if (!hp) return null;
  const bypass = String(env.no_proxy || env.NO_PROXY || '').split(',');
  return { found: true, source: 'env', host: hp.host, port: hp.port, noProxy: usableBypass(bypass), also: [],
    line: `From the ${name.toUpperCase()} Worca started with.` };
}

async function detectKde({ runImpl, env, ...pac }) {
  for (const bin of ['kreadconfig6', 'kreadconfig5']) {
    const get = async (key) => {
      const v = await runImpl(bin, ['--file', 'kioslaverc', '--group', 'Proxy Settings', '--key', key], { timeoutMs: 2000 });
      return v == null ? null : v.trim();
    };
    const type = await get('ProxyType');
    if (type == null) continue;                          // this kreadconfig is not installed
    if (type === '1') {
      const list = kdeList(await get('NoProxyFor'));
      // ReversedException: the list names the only hosts that use the proxy; everything else goes direct.
      if ((await get('ReversedException')) === 'true') {
        const host = new URL(pac.target).hostname;
        if (!list.some((e) => kdeMatches(e, host))) return { found: false, source: 'manual', direct: true, line: 'Your KDE settings send api.anthropic.com direct: no proxy is needed.' };
        list.length = 0;
      }
      for (const k of ['httpsProxy', 'httpProxy']) {
        const hp = kdeHostPort(await get(k));
        if (hp) return manual(hp, list, 'KDE');
      }
    }
    if (type === '2') {
      const url = await get('Proxy Config Script');   // a URL, or a bare path to a local file
      if (url) return fromPac(url.startsWith('/') ? `file://${url}` : url, 'pac', pac);
    }
    if (type === '3') return fromPac(WPAD_URL, 'wpad', pac);
    if (type === '4') return fromEnv(env, { https: await get('httpsProxy'), http: await get('httpProxy') });   // the variable names
    return null;
  }
  return null;
}

async function detectGnome({ runImpl, ...pac }) {
  // 2 s each: without a desktop session gsettings can wait for D-Bus until it times out.
  const get = (schema, key) => runImpl('gsettings', ['get', schema, key], { timeoutMs: 2000 });
  const mode = await get('org.gnome.system.proxy', 'mode');
  if (mode == null) return null;
  const m = gstr(mode);
  if (m === 'auto') { const url = gstr(await get('org.gnome.system.proxy', 'autoconfig-url')); return fromPac(url || WPAD_URL, url ? 'pac' : 'wpad', pac); }
  if (m === 'manual') {
    const ignore = glist(await get('org.gnome.system.proxy', 'ignore-hosts'));
    for (const k of ['https', 'http']) {
      const host = gstr(await get(`org.gnome.system.proxy.${k}`, 'host'));
      const port = Number(gstr(await get(`org.gnome.system.proxy.${k}`, 'port'))) || 8080;
      if (host) return manual({ host, port }, ignore, 'desktop');
    }
  }
  return null;
}

async function detectLinux({ env, readImpl, ...deps }) {
  // A source that found a proxy, or a PAC that says go direct, answers; otherwise the next one is asked.
  const settled = (r) => r && (r.found || r.direct) && !r.loopback;
  const wsl = await isWsl(env, readImpl);
  const tried = [];
  let first = null;                                       // the first unsettled answer, kept for its line
  for (const [name, probe] of [...(wsl ? [['Windows', detectWsl]] : []), ['GNOME', detectGnome], ['KDE', detectKde]]) {
    const r = await probe({ ...deps, env });
    if (settled(r)) return r;
    tried.push(name);
    if (r && r.source !== 'none') first ??= r;
  }
  const fromVars = fromEnv(env);
  if (fromVars) return fromVars;
  if (first) { const { loopback, ...r } = first; return r; }
  return { found: false, source: 'none',
    line: `Found no proxy in the ${tried.join(', ').replace(/, (?=[^,]*$)/, ' or ')} settings, nor in HTTPS_PROXY / HTTP_PROXY.` };
}

/**
 * @returns {Promise<{found: boolean, source: 'pac'|'wpad'|'manual'|'env'|'none'|'error', host?: string, port?: number,
 *   noProxy?: string[], also?: string[], pacUrl?: string, direct?: boolean, line: string}>}
 */
export async function detectSystemProxy({ platform = process.platform, runImpl = run, fetchPacImpl = fetchPac, evaluate = evaluatePac, target = DETECT_TARGET,
  env = process.env, readImpl = readFile, accessImpl = access } = {}) {
  // `env`: the proxy variables Worca started with (the server passes its pre-swap sourceEnv); upstreamEnv drops a
  // parent Worca's local proxy, so its own 127.0.0.1 URL is never offered back.
  const deps = { runImpl, fetchPacImpl, evaluate, target, env: upstreamEnv(env), readImpl, accessImpl };
  try {
    if (platform === 'darwin') return await detectMac(deps);
    if (platform === 'win32') return await detectWindows(deps);
    return await detectLinux(deps);
  } catch {
    return { found: false, source: 'error', line: "Couldn't read this machine's proxy settings." };   // never echo err: a URL may carry a login
  }
}
