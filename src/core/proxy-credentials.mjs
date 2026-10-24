// src/core/proxy-credentials.mjs — the saved corporate-proxy login (docs/network-proxy.md).
//
// One file, <worcaHome>/proxy-login.json: { v, id, domain, user, ntHash, savedAt, rejected }.
// Never the password: it is hashed (MD4 of UTF-16LE, the NT hash) the moment it arrives and the
// string goes out of scope. The NT hash is still a password equivalent for NTLM, so the file is
// guarded like an ssh key: 0600 on POSIX (refused when group/other can read it) and an
// owner-only ACL through icacls on Windows, set on the tmp file before the rename.
// `rejected` is the lockout breaker's memory across processes and restarts.
import { readFileSync, lstatSync, openSync, fstatSync, closeSync, rmSync, watchFile, unwatchFile, constants as fsc } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeJsonAtomic } from './json-atomic.mjs';
import { worcaHome } from './projects.mjs';
import { ntHash } from './ntlm.mjs';
import { resolveUpstream, upstreamLabel, AUTH_LABELS } from './upstream-proxy.mjs';

export const PROXY_LOGIN_FILE = 'proxy-login.json';
/** Same value as egress-policy.mjs EGRESS_PROXY_VAR (that module imports this one; a test pins it). */
const LOCAL_PROXY_VAR = 'WORCA_EGRESS_PROXY_URL';
const PROXY_VARS = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy'];
const MAX_NAME = 256;
const MAX_PASSWORD = 256;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class ProxyLoginError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}

let reads = 0;
/** How many times the login file was read (the flag-off route test asserts it stays put). */
export const proxyLoginReads = () => reads;

/** The default home, or null when it cannot be resolved (node:test without WORCA_HOME). */
function defaultHome() { try { return worcaHome(); } catch { return null; } }
export const proxyLoginFile = (home = defaultHome()) => (home ? join(home, PROXY_LOGIN_FILE) : null);

/** "ACME\\jdoe" | "ACME/jdoe" -> { domain, user }; "jdoe" or "jdoe@acme.example" -> { domain: '', user }. */
export function parseAccount(raw) {
  const s = String(raw ?? '').trim();
  const i = s.search(/[\\/]/);
  return i >= 0 ? { domain: s.slice(0, i).trim(), user: s.slice(i + 1).trim() } : { domain: '', user: s };
}

/** The Windows account icacls grants: USERDOMAIN\username (just username off a domain). */
export function windowsAccount(env = process.env, name = userInfo().username) {
  return env.USERDOMAIN ? `${env.USERDOMAIN}\\${name}` : name;
}

/** icacls argv: drop inherited ACEs and grant full control to `account` alone. */
export const ownerAclArgs = (file, account) => [file, '/inheritance:r', '/grant:r', `${account}:F`];

const icaclsPath = (env) => join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'icacls.exe');

/** Write the record: 0600, and on win32 the owner-only ACL on the EMPTY tmp file before the hash
 *  goes in (D2). `beforeRename` is the last check (markLoginRejected's id guard). */
function writeRecord(file, record, { platform, exec, env, beforeRename }) {
  writeJsonAtomic(file, record, {
    mode: 0o600,
    prepareTmp: platform === 'win32'
      ? (tmp) => exec(icaclsPath(env), ownerAclArgs(tmp, windowsAccount(env)), { stdio: 'ignore', windowsHide: true })
      : undefined,
    beforeRename,
  });
}

function checkAccount({ domain = '', user }) {
  const d = String(domain ?? '').trim();
  const u = String(user ?? '').trim();
  if (!u) throw new ProxyLoginError('user', 'enter the user name');
  if (u.length > MAX_NAME || CONTROL.test(u) || /[\\/]/.test(u)) throw new ProxyLoginError('user', 'the user name is not valid');
  if (d.length > MAX_NAME || CONTROL.test(d) || /[\\/]/.test(d)) throw new ProxyLoginError('domain', 'the domain is not valid');
  return { domain: d, user: u };
}

/**
 * Hash `password` and save the login. Returns the public view (never the hash).
 * @throws {ProxyLoginError} on a bad field; any fs/icacls error as is (no file left behind)
 */
export function saveProxyLogin({ domain = '', user, password }, {
  home = defaultHome(), platform = process.platform, exec = execFileSync, env = process.env, now = Date.now,
} = {}) {
  const account = checkAccount({ domain, user });
  if (typeof password !== 'string' || !password) throw new ProxyLoginError('password', 'enter the password');
  if (password.length > MAX_PASSWORD) throw new ProxyLoginError('password', `the password is longer than ${MAX_PASSWORD} characters`);
  const file = proxyLoginFile(home);
  if (!file) throw new ProxyLoginError('home', 'Worca has no home folder to save the login in');
  const record = { v: 1, id: randomBytes(8).toString('hex'), ...account,
    ntHash: ntHash(password).toString('hex'), savedAt: new Date(now()).toISOString(), rejected: null };
  writeRecord(file, record, { platform, exec, env });
  return loginView(record);
}

/**
 * The saved login: null (none, or no home), { error } (unusable), or
 * { id, domain, user, ntHash: Buffer, savedAt, rejected }.
 */
export function readProxyLogin({ home = defaultHome(), platform = process.platform, uid = process.getuid?.() } = {}) {
  const file = proxyLoginFile(home);
  if (!file) return null;
  reads += 1;
  const notPlain = { error: `${PROXY_LOGIN_FILE} is not a plain file; run worca proxy login again` };
  const cannot = (err) => (err && err.code === 'ENOENT' ? null
    : { error: `${PROXY_LOGIN_FILE} cannot be read (${err && err.code ? err.code : 'error'})` });
  // D4: open once, check and read through the SAME fd, so nothing can be swapped in between.
  // O_NOFOLLOW refuses a link at the file's own name (ELOOP); win32 has none, so lstat stands in there.
  if (platform === 'win32') {
    try { if (lstatSync(file).isSymbolicLink()) return notPlain; } catch (err) { return cannot(err); }
  }
  let fd;
  try { fd = openSync(file, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0)); } catch (err) {
    return err && (err.code === 'ELOOP' || err.code === 'EMLINK') ? notPlain : cannot(err);
  }
  let text;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return notPlain;
    if (platform !== 'win32') {
      // Like ssh: our own file, no group/other bits.
      if (uid !== undefined && st.uid !== uid) return { error: `${PROXY_LOGIN_FILE} belongs to another user; run worca proxy login again` };
      const mode = st.mode & 0o777;
      if (mode & 0o077) return { error: `${PROXY_LOGIN_FILE} can be read by other users (mode ${mode.toString(8)}); run worca proxy login again` };
    }
    text = readFileSync(fd, 'utf8');
  } catch (err) {
    return cannot(err);
  } finally {
    closeSync(fd);
  }
  let r;
  try { r = JSON.parse(text); } catch { return { error: `${PROXY_LOGIN_FILE} is not valid JSON; run worca proxy login again` }; }
  if (!r || r.v !== 1 || typeof r.user !== 'string' || !r.user || typeof r.ntHash !== 'string' || !/^[0-9a-f]{32}$/.test(r.ntHash)) {
    return { error: `${PROXY_LOGIN_FILE} is not a Worca proxy login; run worca proxy login again` };
  }
  const rejected = r.rejected && typeof r.rejected === 'object' ? { at: String(r.rejected.at || ''), upstream: String(r.rejected.upstream || '') } : null;
  return { id: String(r.id || ''), domain: String(r.domain || ''), user: r.user, ntHash: Buffer.from(r.ntHash, 'hex'),
    savedAt: String(r.savedAt || ''), rejected };
}

/** Delete the saved login. @returns {boolean} true when one was there */
export function clearProxyLogin({ home = defaultHome() } = {}) {
  const file = proxyLoginFile(home);
  if (!file) return false;
  try { lstatSync(file); } catch { return false; }
  rmSync(file, { force: true });
  return true;
}

const STALE = Symbol('stale login');

/**
 * Record that the corporate proxy rejected login `id`; a no-op when the file now holds another login.
 * The id is checked twice: on the first read, and again right before the rename, so a `worca proxy
 * login` that lands in between is not overwritten. The window left (a save between that second read
 * and the rename) is microseconds; a later login clears any marker it leaves.
 */
export function markLoginRejected(id, { upstream = '', home = defaultHome(), platform = process.platform, exec = execFileSync,
  env = process.env, now = Date.now } = {}) {
  const cur = readProxyLogin({ home, platform });
  if (!cur || cur.error || !id || cur.id !== id || cur.rejected) return false;
  const stillOurs = () => { const again = readProxyLogin({ home, platform }); if (!again || again.error || again.id !== id) throw STALE; };
  try {
    writeRecord(proxyLoginFile(home), { v: 1, id: cur.id, domain: cur.domain, user: cur.user, ntHash: cur.ntHash.toString('hex'),
      savedAt: cur.savedAt, rejected: { at: new Date(now()).toISOString(), upstream } }, { platform, exec, env, beforeRename: stillOurs });
  } catch (err) {
    if (err === STALE) return false;
    throw err;
  }
  return true;
}

/** What may be shown: never the hash. */
export function loginView(r) {
  return { id: r.id, domain: r.domain, user: r.user, label: r.domain ? `${r.domain}\\${r.user}` : r.user,
    savedAt: r.savedAt, rejected: r.rejected || null };
}

/** Call `onChange()` when the login file changes (polled; never keeps the process alive). Returns stop(). */
export function watchProxyLogin(onChange, { home = defaultHome(), intervalMs = 1000 } = {}) {
  const file = proxyLoginFile(home);
  if (!file) return () => {};
  const listener = (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs || cur.ino !== prev.ino) { try { onChange(); } catch { /* ignore */ } } };
  watchFile(file, { interval: intervalMs, persistent: false }, listener);
  return () => unwatchFile(file, listener);
}

/** Mask anything credential-shaped in a proxy log line. */
export function redactProxyLine(text) {
  return String(text)
    .replace(/(proxy-authorization:\s*)[^\r\n]*/gi, '$1[redacted]')
    .replace(/\b(NTLM|Basic|Negotiate)\s+[A-Za-z0-9+/=]{16,}/g, '$1 [redacted]')
    .replace(/\b[0-9a-f]{32}\b/gi, '[redacted]')
    .replace(/(\/\/[^:/@\s]+:)[^@\s]+@/g, '$1[redacted]@');
}

/** `env` without the proxy variables a parent Worca pointed at its local proxy. */
export function upstreamEnv(env = process.env) {
  if (!env[LOCAL_PROXY_VAR]) return env;
  const out = { ...env };
  for (const k of [...PROXY_VARS, LOCAL_PROXY_VAR]) delete out[k];
  return out;
}

export const STATE_TEXT = Object.freeze({
  ready: 'ready', 'no-login': 'no login saved', 'needs-login': 'needs login', 'not-configured': 'not set up', error: 'cannot be used',
});

const when = (iso) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'at an unknown time');

/**
 * The one human sentence for a state, shared by `worca proxy status` ("State: <line>") and the
 * card (the route returns it as `line`), so no surface keeps its own wording (D12).
 */
export function stateLine(st) {
  const who = st.login ? ` as ${st.login.label}` : '';
  const via = st.upstream ? ` via ${st.upstream} (${st.authLabel})` : '';
  const restart = st.restartNeeded ? ' Restart Worca to start the proxy.' : '';
  switch (st.state) {
    case 'ready': return `${STATE_TEXT.ready}:${via}${who}.${restart}`;
    case 'no-login': return `${STATE_TEXT['no-login']}:${via}. Log in with your domain, user name and password.${restart}`;
    case 'needs-login': return `${STATE_TEXT['needs-login']}: the corporate proxy rejected the saved login${st.login ? ` for ${st.login.label}` : ''} ${when(st.login && st.login.rejected && st.login.rejected.at)}, so Worca sends no credentials. Log in again (worca proxy login).`;
    case 'error': return `${STATE_TEXT.error}: ${st.error}`;
    default: return `${STATE_TEXT['not-configured']}: enter the corporate proxy host and port and Save (or set HTTPS_PROXY), then restart Worca.`;
  }
}

/**
 * One status for the CLI, the route and the card. `live` = a running connector's status(), or
 * null. `running` false with the flag on means the proxy did not start at boot (the flag was turned
 * on later): `restartNeeded` is then true for a configured upstream.
 * @returns {{state: keyof STATE_TEXT, text: string, line: string, upstream?: string, source?: string, auth?: string,
 *   authLabel?: string, login: object|null, loginError: string|null, running: boolean, restartNeeded: boolean,
 *   warnings: string[], error?: string}}
 */
export function proxyState({ env = process.env, networkProxy, login = readProxyLogin(), live = null, expectRunning = false } = {}) {
  const saved = login && !login.error ? login : null;
  const base = { login: saved ? loginView(saved) : null, loginError: login && login.error ? login.error : null,
    running: !!live, restartNeeded: false, warnings: [] };
  const done = (st) => ({ ...st, line: stateLine(st) });
  const up = resolveUpstream({ env, settings: networkProxy, login: saved });
  if (!up) return done({ ...base, state: 'not-configured', text: STATE_TEXT['not-configured'] });
  if (up.error) return done({ ...base, state: 'error', text: STATE_TEXT.error, source: up.source, error: up.error });
  const tripped = live ? live.state === 'tripped' : !!(up.login && up.login.rejected);
  const state = tripped ? 'needs-login' : up.auth === 'none' ? 'no-login' : 'ready';
  return done({ ...base, state, text: STATE_TEXT[state], upstream: upstreamLabel(up.host, up.port), source: up.source,
    auth: up.auth, authLabel: AUTH_LABELS[up.auth], warnings: up.warnings, restartNeeded: expectRunning && !live });
}
