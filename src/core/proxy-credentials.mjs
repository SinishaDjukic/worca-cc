// src/core/proxy-credentials.mjs — the saved corporate-proxy login (docs/network-proxy.md).
//
// One file, <worcaHome>/proxy-login.json: { v, id, domain, user, ntHash, savedAt, rejected }.
// Never the password: it is hashed (MD4 of UTF-16LE, the NT hash) the moment it arrives and the
// string goes out of scope. The NT hash is still a password equivalent for NTLM, so the file is
// guarded like an ssh key: 0600 on POSIX (refused when group/other can read it) and an
// owner-only ACL through icacls on Windows, set on the tmp file before the rename.
// `rejected` is the lockout breaker's memory across processes and restarts.
// With the secretVault flag on, `ntHash` holds a Worca vault reference (owner `login.ntHash`) instead of the hex hash,
// resolved when the login is read; saveProxyLogin and clearProxyLogin are async for that.
import { readFileSync, lstatSync, openSync, fstatSync, closeSync, rmSync, statSync, constants as fsc } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { writeJsonAtomic } from './json-atomic.mjs';
import { worcaHome } from './projects.mjs';
import { ntHash } from './ntlm.mjs';
import { resolveUpstream, upstreamLabel, AUTH_LABELS } from './upstream-proxy.mjs';
import { VAULT_MESSAGES, isVaultRef, vaultActionLine } from './secrets/refs.mjs';
import { resolveVaultRefSync, settingsVaultState } from './secrets/settings-resolver.mjs';
import { vaultUnavailableHere } from './secrets/place.mjs';

export const PROXY_LOGIN_FILE = 'proxy-login.json';
/** Same value as egress-policy.mjs EGRESS_PROXY_VAR (that module imports this one; a test pins it). */
const LOCAL_PROXY_VAR = 'WORCA_EGRESS_PROXY_URL';
/** Set with the flag on, next to the proxy variables: the marker browser launches read (D14). The one
 *  declaration: egress-policy.mjs imports it; spawn.mjs and promo-kit cdp.mjs repeat the literal (pinned). */
export const CORPORATE_PROXY_VAR = 'WORCA_CORPORATE_PROXY_URL';
const PROXY_VARS = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy'];
const MAX_NAME = 256;
const MAX_PASSWORD = 256;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class ProxyLoginError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}

/** The vault owner field of the saved login's NT hash. */
export const NT_HASH_FIELD = 'login.ntHash';

// The store-vault module while the vault is in use (flag on, or a vault file a migration left), else null (nothing but
// flag.mjs loads). `sealing` is the flag itself: with it off a vault left in use still releases, but new values stay plain.
// In a container (place.mjs) the egress sidecar holds the login: never the vault, so null without loading anything.
async function storeVault(env = process.env) {
  if (vaultUnavailableHere(env)) return null;
  const { secretVaultEnabled, vaultInUse } = await import('./secrets/flag.mjs');
  if (!vaultInUse()) return null;
  const m = await import('./secrets/store-vault.mjs');
  return { ...m, sealing: secretVaultEnabled() };
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

/** saveProxyLogin's field checks without writing (setup apply validates before its one write). @throws {ProxyLoginError} */
export function assertProxyLoginInput({ domain = '', user, password }) {
  const account = checkAccount({ domain, user });
  if (typeof password !== 'string' || !password) throw new ProxyLoginError('password', 'enter the password');
  if (password.length > MAX_PASSWORD) throw new ProxyLoginError('password', `the password is longer than ${MAX_PASSWORD} characters`);
  return account;
}

/** Basic and Digest send the password itself, and a saved login keeps only the NT hash. Null = a login can be saved. */
export function savedLoginRefusal(auth) {
  if (auth !== 'basic' && auth !== 'digest') return null;
  const mode = auth === 'digest' ? 'Digest' : 'Basic';
  return `“Login” is ${mode}, and a saved login keeps only the NT hash, which ${mode} cannot use. Choose NTLMv2 and Save first.`;
}

/**
 * Hash `password` and save the login under a new `id`. Returns the public view (never the hash). With the secretVault
 * flag on the NT hash is sealed into a fresh vault entry first, and the previous login's entry is released after the
 * write. `newId` makes the id (tests compare bytes across runs).
 * @throws {ProxyLoginError} on a bad field; SettingsVaultError when the vault refused; any fs/icacls error as is (no
 *   file left behind)
 */
export async function saveProxyLogin({ domain = '', user, password }, {
  home = defaultHome(), platform = process.platform, exec = execFileSync, env = process.env, now = Date.now, upstream,
  newId = () => randomBytes(8).toString('hex'),
} = {}) {
  refuseInBox(env);
  const account = assertProxyLoginInput({ domain, user, password });
  return writeLoginVaulted({ ...account, ntHash: ntHash(password).toString('hex') }, { home, platform, exec, env, now, upstream, newId });
}

/**
 * saveProxyLogin without the vault, synchronous: the egress sidecar's own store (src/egress/api.mjs). In every container
 * setup the sidecar holds the login and the vault stays out of it entirely (docs/secrets.md, "With the other setups"),
 * so this never loads the vault. @throws {ProxyLoginError}
 */
export function saveProxyLoginPlain({ domain = '', user, password }, {
  home = defaultHome(), platform = process.platform, exec = execFileSync, env = process.env, now = Date.now, upstream,
  newId = () => randomBytes(8).toString('hex'),
} = {}) {
  refuseInBox(env);
  const account = assertProxyLoginInput({ domain, user, password });
  return writeLogin({ ...account, ntHash: ntHash(password).toString('hex') }, { home, platform, exec, env, now, upstream, newId });
}

/** The box of a container setup with an egress sidecar (WORCA_EGRESS_API_URL): the login lives there, never here. */
export const SIDECAR_LOGIN_TEXT = 'In this container the corporate proxy login lives in the egress sidecar, not in Worca\'s box. '
  + 'Log in with `worca container proxy login` on the host (or `worca proxy login` inside the box), never by writing proxy-login.json here.';
function refuseInBox(env) {
  if (env && typeof env.WORCA_EGRESS_API_URL === 'string' && env.WORCA_EGRESS_API_URL.trim()) throw new ProxyLoginError('sidecar', SIDECAR_LOGIN_TEXT);
}

const newRecord = (fields, hash, { now, upstream, newId }) => ({ v: 1, id: newId(), domain: fields.domain, user: fields.user,
  ntHash: hash, savedAt: new Date(now()).toISOString(), rejected: null, ...(upstream ? { upstream: String(upstream) } : {}) });

/** Write a plain login (hex NT hash). Never loads the vault. */
function writeLogin(fields, { home, platform, exec, env, now, upstream, newId = () => randomBytes(8).toString('hex') }) {
  const file = proxyLoginFile(home);
  if (!file) throw new ProxyLoginError('home', 'Worca has no home folder to save the login in');
  const record = newRecord(fields, fields.ntHash, { now, upstream, newId });
  writeRecord(file, record, { platform, exec, env });
  return loginView(record);
}

/** writeLogin through the vault: with the secretVault flag on (native install only) the NT hash is sealed into a fresh
 *  vault entry first, and the previous login's entry is released after the write. */
async function writeLoginVaulted(fields, { home, platform, exec, env, now, upstream, newId }) {
  const file = proxyLoginFile(home);
  if (!file) throw new ProxyLoginError('home', 'Worca has no home folder to save the login in');
  let hash = fields.ntHash;
  const vault = await storeVault(env);
  let recheck = () => {};
  if (vault?.sealing) {
    const r = await vault.sealStoreSecrets('proxy', [{ field: NT_HASH_FIELD, value: hash, current: undefined }],
      { home, nothingVaulted: () => !storedRef(home), subject: 'The login' });
    hash = r.values[0];
    recheck = r.recheck;
  }
  // From here to the write: one sync section.
  recheck();
  const previous = vault ? storedRef(home) : null;
  const record = newRecord(fields, hash, { now, upstream, newId });
  writeRecord(file, record, { platform, exec, env });
  if (previous && previous !== hash) {
    await vault.releaseStoreRefs('proxy', [{ ref: previous, field: NT_HASH_FIELD }],
      { home, stillReferenced: (ref) => storedRef(home) === ref, graceMs: vault.LOCKLESS_GRACE_MS, scope: () => true });
  }
  return loginView(record);
}

/** A login given as its NT hash (the egress sidecar: a login moved out of a box, or `worca proxy hash` output).
 *  `upstream` binds it to the proxy it was saved for. @throws {ProxyLoginError} */
export function saveProxyLoginHash({ domain = '', user, ntHash: hash }, {
  home = defaultHome(), platform = process.platform, exec = execFileSync, env = process.env, now = Date.now, upstream,
} = {}) {
  refuseInBox(env);
  const account = checkAccount({ domain, user });
  const hex = String(hash ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new ProxyLoginError('ntHash', 'the NT hash must be 32 hexadecimal characters');
  return writeLogin({ ...account, ntHash: hex }, { home, platform, exec, env, now, upstream });
}

/** `{domain, user, ntHash}` (the sidecar's secret-file login, `worca proxy hash` output) -> a readProxyLogin()-shaped
 *  record, or { error }. Pure. */
export function parseLoginRecord(text) {
  let r;
  try { r = JSON.parse(String(text)); } catch { return { error: 'the login file is not valid JSON' }; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'the login file is not a JSON object' };
  let account;
  try { account = checkAccount({ domain: r.domain ?? '', user: r.user }); } catch (err) { return { error: `the login file: ${err.message}` }; }
  if (typeof r.ntHash !== 'string' || !/^[0-9a-f]{32}$/i.test(r.ntHash.trim())) return { error: 'the login file has no ntHash of 32 hexadecimal characters' };
  return { id: 'managed', ...account, ntHash: Buffer.from(r.ntHash.trim(), 'hex'),
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : '', rejected: null };
}

/**
 * The login file's raw parsed record: null (none, or no home), { error } (not a plain owner-only file, unreadable or
 * not JSON), or { record }. Opened once, checked and read through the same fd. Never resolves the vault.
 */
function readLoginRecord({ home = defaultHome(), platform = process.platform, uid = process.getuid?.() } = {}) {
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
  if (!r || r.v !== 1 || typeof r.user !== 'string' || !r.user || typeof r.ntHash !== 'string') {
    return { error: `${PROXY_LOGIN_FILE} is not a Worca proxy login; run worca proxy login again` };
  }
  return { record: r };
}

/**
 * The vault reference the login file holds, or null: the release decision only, so a file that fails the owner-only
 * check still names its entry (it is never used as a credential here). A link or anything but a plain file is none.
 */
export function storedRef(home = defaultHome()) {
  const file = proxyLoginFile(home);
  try {
    if (!file || !lstatSync(file).isFile()) return null;
    const ref = JSON.parse(readFileSync(file, 'utf8'))?.ntHash;
    return isVaultRef(ref) ? ref : null;
  } catch { return null; }
}

/**
 * The saved login: null (none, or no home), { error } (unusable), or
 * { id, domain, user, ntHash: Buffer, savedAt, rejected }.
 */
export function readProxyLogin({ home = defaultHome(), platform = process.platform, uid = process.getuid?.() } = {}) {
  const raw = readLoginRecord({ home, platform, uid });
  if (!raw || raw.error) return raw;
  const r = raw.record;
  let hash = r.ntHash;
  if (isVaultRef(hash)) {
    // A vaulted NT hash resolves here, at the point of use. One that does not resolve is an error: the egress
    // connector keeps its current login on it (egress-policy.mjs reloadLogin).
    const got = resolveVaultRefSync(hash, { store: 'proxy', field: NT_HASH_FIELD });
    if (got.code) {
      const code = got.code === 'locked' ? 'store-locked' : got.code;
      return { error: `The saved login cannot be read: ${VAULT_MESSAGES[code] ?? VAULT_MESSAGES['unknown-ref']}.${vaultActionLine(code)}` };
    }
    hash = got.value;
  }
  if (!/^[0-9a-f]{32}$/.test(hash)) {
    return { error: `${PROXY_LOGIN_FILE} is not a Worca proxy login; run worca proxy login again` };
  }
  const rejected = r.rejected && typeof r.rejected === 'object' ? { at: String(r.rejected.at || ''), upstream: String(r.rejected.upstream || '') } : null;
  return { id: String(r.id || ''), domain: String(r.domain || ''), user: r.user, ntHash: Buffer.from(hash, 'hex'),
    savedAt: String(r.savedAt || ''), rejected, ...keptUpstream(r) };
}

/** The proxy a login was saved for (the egress sidecar binds its logins to one), kept on every rewrite. */
function keptUpstream(r) {
  return typeof r?.upstream === 'string' && r.upstream ? { upstream: r.upstream } : {};
}

/** Delete the saved login, then (secretVault on) the vault entry it held. @returns {Promise<boolean>} true when one was there */
export async function clearProxyLogin({ home = defaultHome(), env = process.env } = {}) {
  const file = proxyLoginFile(home);
  if (!file) return false;
  const vault = await storeVault(env);
  try { lstatSync(file); } catch { return false; }
  const ref = vault ? storedRef(home) : null;
  rmSync(file, { force: true });
  if (ref) {
    await vault.releaseStoreRefs('proxy', [{ ref, field: NT_HASH_FIELD }],
      { home, stillReferenced: (r) => storedRef(home) === r, graceMs: vault.LOCKLESS_GRACE_MS, scope: () => true });
  }
  return true;
}

/** Delete the saved login file only, synchronously: the egress sidecar and a container's box, where the vault never
 *  holds the login. @returns {boolean} true when one was there */
export function clearProxyLoginPlain({ home = defaultHome() } = {}) {
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
  // Raw records (D4): the stored ntHash (hex or vault reference) is copied as is, never a resolved value.
  const raw = readLoginRecord({ home, platform });
  const cur = raw?.record;
  if (!cur || !id || String(cur.id || '') !== id || (cur.rejected && typeof cur.rejected === 'object')) return false;
  const stillOurs = () => { const again = readLoginRecord({ home, platform }); if (!again?.record || String(again.record.id || '') !== id) throw STALE; };
  try {
    writeRecord(proxyLoginFile(home), { v: 1, id: String(cur.id), domain: String(cur.domain || ''), user: cur.user, ntHash: cur.ntHash,
      savedAt: String(cur.savedAt || ''), rejected: { at: new Date(now()).toISOString(), upstream }, ...keptUpstream(cur) },
    { platform, exec, env, beforeRename: stillOurs });
  } catch (err) {
    if (err === STALE) return false;
    throw err;
  }
  return true;
}

/**
 * The saved login's file-stored NT hash, for the one-time move into the vault (secrets/migrate.mjs): `{ id, value }`,
 * `{ insecure: true }` when readLoginRecord refuses the file (it is not used either way), or null (no login, or the
 * hash is already a vault reference).
 */
export function proxyLoginLiteral({ home = defaultHome(), platform = process.platform, uid = process.getuid?.() } = {}) {
  const raw = readLoginRecord({ home, platform, uid });
  if (!raw) return null;
  if (raw.error) return { insecure: true };
  // A login bound to an upstream was saved by the egress sidecar (saveProxyLoginHash and the sidecar's own api): it
  // belongs to the sidecar, and the vault never takes it.
  if (keptUpstream(raw.record).upstream) return null;
  const hash = raw.record.ntHash;
  return hash && !isVaultRef(hash) ? { id: String(raw.record.id || ''), value: hash } : null;
}

/**
 * Export's restore (secrets/export.mjs): put the literal NT hash `value` back where reference `ref` is, only while the
 * file still holds login `id` with `ref` (checked on the read and again right before the rename). `id`, `savedAt` and
 * `rejected` are kept; 0600 (and the owner-only ACL on Windows); nothing is released. True when the file now holds
 * `value`.
 */
export function restoreProxyLoginRef({ home = defaultHome(), id, ref, value }, { platform = process.platform, exec = execFileSync,
  env = process.env } = {}) {
  const same = (r) => !!r && String(r.id || '') === id && r.ntHash === ref;
  const cur = readLoginRecord({ home, platform })?.record;
  if (!same(cur)) return false;
  const stillOurs = () => { if (!same(readLoginRecord({ home, platform })?.record)) throw STALE; };
  try {
    writeRecord(proxyLoginFile(home), { v: 1, id: String(cur.id), domain: String(cur.domain || ''), user: cur.user, ntHash: value,
      savedAt: String(cur.savedAt || ''), rejected: cur.rejected && typeof cur.rejected === 'object' ? cur.rejected : null,
      ...keptUpstream(cur) },
    { platform, exec, env, beforeRename: stillOurs });
  } catch (err) {
    if (err === STALE) return false;
    throw err;
  }
  return true;
}

/** The saved login's id and raw stored NT hash (hex or a vault reference), or null; never resolves the vault. */
export function storedLogin({ home = defaultHome(), platform = process.platform } = {}) {
  const r = readLoginRecord({ home, platform })?.record;
  return r ? { id: String(r.id || ''), ntHash: r.ntHash } : null;
}

/**
 * Swap the moved NT hash for its reference (the markLoginRejected pattern): only while the file still holds login `id`
 * with hash `value`, checked on the read and again right before the rename. `id`, `savedAt` and `rejected` are kept.
 * `beforeWrite()` runs right before the write. True when the file now holds `ref`.
 */
export function swapProxyLoginLiteral({ home = defaultHome(), id, value, ref }, { beforeWrite = () => {}, platform = process.platform,
  exec = execFileSync, env = process.env } = {}) {
  const same = (r) => !!r && String(r.id || '') === id && r.ntHash === value;
  const cur = readLoginRecord({ home, platform })?.record;
  if (!same(cur)) return false;
  const stillOurs = () => { if (!same(readLoginRecord({ home, platform })?.record)) throw STALE; };
  beforeWrite();
  try {
    writeRecord(proxyLoginFile(home), { v: 1, id: String(cur.id), domain: String(cur.domain || ''), user: cur.user, ntHash: ref,
      savedAt: String(cur.savedAt || ''), rejected: cur.rejected && typeof cur.rejected === 'object' ? cur.rejected : null,
      ...keptUpstream(cur) },
    { platform, exec, env, beforeRename: stillOurs });
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
  // Our own poll with the baseline taken here, not fs.watchFile: its baseline is its first stat,
  // done later on the thread pool, so a save landing before that stat ran was never reported.
  // The vault reader's `loaded` joins the key (D14): a vaulted login read as locked before the vault key arrived is
  // read again once it does, with no file change.
  const sig = () => {
    const vault = settingsVaultState().loaded ? 'v' : '-';
    try { const st = statSync(file); return `${st.ino}|${st.mtimeMs}|${st.ctimeMs}|${st.size}|${vault}`; } catch (err) { return `${err && err.code ? err.code : 'error'}|${vault}`; }
  };
  let last = sig();
  const timer = setInterval(() => {
    const cur = sig();
    if (cur === last) return;
    last = cur;
    try { onChange(); } catch { /* ignore */ }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
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
  for (const k of [...PROXY_VARS, LOCAL_PROXY_VAR, CORPORATE_PROXY_VAR]) delete out[k];
  return out;
}

export const STATE_TEXT = Object.freeze({
  ready: 'ready', 'no-login': 'no login saved', 'needs-login': 'needs login', 'not-configured': 'not set up', error: 'cannot be used', off: 'off',
});

/** A login the operator manages (the egress sidecar's WORCA_EGRESS_LOGIN_FILE) that the proxy rejected: nobody can log
 *  in again from Worca; the operator replaces the file. */
export const MANAGED_REJECTED_FIX = 'The operator manages this login: they must replace the login file (WORCA_EGRESS_LOGIN_FILE) with a working one.';

const when = (iso) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'at an unknown time');

/**
 * The one human sentence for a state, shared by `worca proxy status` ("State: <line>") and the
 * card (the route returns it as `line`), so no surface keeps its own wording (D12).
 */
export function stateLine(st) {
  const who = st.login ? ` as ${st.login.label}` : '';
  const via = st.upstream ? ` via ${st.upstream} (${st.authLabel})` : '';
  switch (st.state) {
    case 'off': return st.upstream
      ? `${STATE_TEXT.off}: Worca connects directly. Turn on Use a corporate proxy to use ${st.upstream}.`
      : `${STATE_TEXT.off}: turn on Use a corporate proxy, enter its host and port, then Save.`;
    case 'ready': return `${STATE_TEXT.ready}:${via}${who}.`;
    case 'no-login': return `${STATE_TEXT['no-login']}:${via}. Log in with your domain, user name and password.`;
    case 'needs-login': return `${STATE_TEXT['needs-login']}: the corporate proxy rejected the saved login${st.login ? ` for ${st.login.label}` : ''} ${when(st.login && st.login.rejected && st.login.rejected.at)}, so Worca sends no credentials. ${st.managed ? MANAGED_REJECTED_FIX : 'Log in again (worca proxy login).'}`;
    case 'error': return `${STATE_TEXT.error}: ${st.error}`;
    default: return `${STATE_TEXT['not-configured']}: enter the corporate proxy host and port, then Save (or set HTTPS_PROXY).`;
  }
}

/**
 * One status for the CLI, the route and the card. `live` = a running connector's status(), or
 * null. `enabled` false (networkProxy.enabled off) gives state `off`, with the login fields filled.
 * `expectRunning` with no live connector sets `restartNeeded` (kept for callers that ask; the
 * server applies changes live and passes false).
 * @returns {{state: keyof STATE_TEXT, text: string, line: string, upstream?: string, source?: string, auth?: string,
 *   authLabel?: string, login: object|null, loginError: string|null, running: boolean, restartNeeded: boolean,
 *   warnings: string[], error?: string}}
 */
export function proxyState({ env = process.env, networkProxy, login = readProxyLogin(), live = null, expectRunning = false,
  localUrl = null, enabled = true } = {}) {
  const saved = login && !login.error ? login : null;
  const base = { login: saved ? loginView(saved) : null, loginError: login && login.error ? login.error : null,
    running: !!live, restartNeeded: false, warnings: [], localUrl };
  const done = (st) => ({ ...st, line: stateLine(st) });
  const up = resolveUpstream({ env, settings: networkProxy, login: saved });
  if (!enabled) {
    const where = up && !up.error
      ? { upstream: upstreamLabel(up.host, up.port), source: up.source, auth: up.auth, authLabel: AUTH_LABELS[up.auth] } : {};
    return done({ ...base, state: 'off', text: STATE_TEXT.off, ...where });
  }
  if (!up) return done({ ...base, state: 'not-configured', text: STATE_TEXT['not-configured'] });
  if (up.error) return done({ ...base, state: 'error', text: STATE_TEXT.error, source: up.source, error: up.error });
  const tripped = live ? live.state === 'tripped' : !!(up.login && up.login.rejected);
  const state = tripped ? 'needs-login' : up.auth === 'none' ? 'no-login' : 'ready';
  return done({ ...base, state, text: STATE_TEXT[state], upstream: upstreamLabel(up.host, up.port), source: up.source,
    auth: up.auth, authLabel: AUTH_LABELS[up.auth], warnings: up.warnings, restartNeeded: expectRunning && !live });
}
