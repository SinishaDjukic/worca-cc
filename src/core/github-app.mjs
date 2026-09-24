// GitHub App mode: worca holds an App ID and private key and mints a short-lived
// installation token for EACH git/gh operation (github-credentials.mjs#githubEnv).
//
//   WORCA_GH_APP_ID               the App's numeric id
//   WORCA_GH_APP_KEY_FILE         path to the PEM private key (preferred), or
//   WORCA_GH_APP_KEY_B64          base64 of the PEM, where only variables exist
//   WORCA_GH_APP_INSTALLATION_ID  optional; else resolved from the repository, or
//                                 the App's only installation
//
// The token lives for at most an hour and is never cached, written or logged:
// minted, handed to one command's env, dropped. A run lasting days is fine, since
// only its short fetch/push/PR calls need a credential. Each token is scoped down
// to the role: read = contents/metadata/pull requests read; write adds contents
// and pull requests write.
import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'worca' };
const PERMISSIONS = {
  read: { contents: 'read', metadata: 'read', pull_requests: 'read' },
  write: { contents: 'write', metadata: 'read', pull_requests: 'write' },
};

const val = (v) => (typeof v === 'string' ? v.trim() : '');

/** True when the App variables are present (the key itself is loaded lazily). Pure. */
export function appConfigured(env = process.env) {
  return /^\d+$/.test(val(env.WORCA_GH_APP_ID)) && !!(val(env.WORCA_GH_APP_KEY_FILE) || val(env.WORCA_GH_APP_KEY_B64));
}

/** { appId, key (KeyObject), installationId|null } or throws with a message that names no secret. */
export function loadAppConfig(env = process.env, { readFile = readFileSync } = {}) {
  const appId = val(env.WORCA_GH_APP_ID);
  if (!/^\d+$/.test(appId)) throw new Error('WORCA_GH_APP_ID must be the App\'s numeric id');
  let pem;
  if (val(env.WORCA_GH_APP_KEY_FILE)) {
    try { pem = readFile(val(env.WORCA_GH_APP_KEY_FILE), 'utf8'); } catch (e) { throw new Error(`cannot read WORCA_GH_APP_KEY_FILE (${e.code || 'error'})`); }
  } else if (val(env.WORCA_GH_APP_KEY_B64)) {
    pem = Buffer.from(val(env.WORCA_GH_APP_KEY_B64), 'base64').toString('utf8');
  } else {
    throw new Error('set WORCA_GH_APP_KEY_FILE or WORCA_GH_APP_KEY_B64');
  }
  let key;
  try { key = createPrivateKey(pem); } catch { throw new Error('the App private key is not a valid PEM key'); }
  if (key.asymmetricKeyType !== 'rsa') throw new Error('the App private key must be an RSA key');
  const inst = val(env.WORCA_GH_APP_INSTALLATION_ID);
  if (inst && !/^\d+$/.test(inst)) throw new Error('WORCA_GH_APP_INSTALLATION_ID must be numeric');
  return { appId, key, installationId: inst || null };
}

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

/** The App's own JWT (RS256): issued 60 s in the past for clock drift, valid 9 minutes. */
export function appJwt({ appId, key }, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const head = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const sig = createSign('RSA-SHA256').update(head).sign(key).toString('base64url');
  return `${head}.${sig}`;
}

async function api(fetchImpl, method, path, jwt, body) {
  let res;
  try {
    res = await fetchImpl(`${API}${path}`, {
      method, headers: { ...HEADERS, Authorization: `Bearer ${jwt}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`GitHub API unreachable (${e.name === 'TimeoutError' ? 'timeout' : e.code || e.name})`);
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

const OWNER_REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Which installation: the configured id, else the repository's, else the App's only one. */
export async function resolveInstallation(cfg, { repo = null, fetchImpl = fetch, now = Date.now() } = {}) {
  if (cfg.installationId) return cfg.installationId;
  const jwt = appJwt(cfg, now);
  if (repo && OWNER_REPO_RE.test(repo)) {
    const r = await api(fetchImpl, 'GET', `/repos/${repo}/installation`, jwt);
    if (r.status === 200 && r.data?.id) return String(r.data.id);
    if (r.status === 404) throw new Error(`the GitHub App is not installed on ${repo}`);
    throw new Error(`cannot find the App installation for ${repo} (HTTP ${r.status})`);
  }
  const r = await api(fetchImpl, 'GET', '/app/installations', jwt);
  if (r.status !== 200 || !Array.isArray(r.data)) throw new Error(`cannot list the App's installations (HTTP ${r.status})`);
  if (r.data.length === 1) return String(r.data[0].id);
  throw new Error(r.data.length ? 'the App has several installations: set WORCA_GH_APP_INSTALLATION_ID' : 'the GitHub App is not installed anywhere');
}

/** A fresh installation token for `role`, scoped down to it. Never cached. */
export async function mintInstallationToken(cfg, { role = 'read', repo = null, fetchImpl = fetch, now = Date.now() } = {}) {
  const installationId = await resolveInstallation(cfg, { repo, fetchImpl, now });
  const r = await api(fetchImpl, 'POST', `/app/installations/${installationId}/access_tokens`, appJwt(cfg, now),
    { permissions: PERMISSIONS[role === 'write' ? 'write' : 'read'] });
  if (r.status === 201 && typeof r.data?.token === 'string') return { token: r.data.token, expiresAt: r.data.expires_at || null };
  const why = r.status === 401 ? 'the App ID or private key was rejected'
    : r.status === 404 ? `installation ${installationId} not found`
      : r.status === 422 ? `the App lacks the ${role} permissions it asked for`
        : `HTTP ${r.status}`;
  throw new Error(`cannot mint a GitHub App token: ${why}`);
}
