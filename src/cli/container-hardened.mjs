// src/cli/container-hardened.mjs — `worca container … --hardened`: the hardened box (docs/hardened-box.md, #1619).
//
// One developer on their own machine. Docker only. It always turns on, together: the credential broker in single
// mode, agent users, the allow-list on a network with no route out, and the egress sidecar (which holds the proxy
// login when the proxy needs one). No host folder is mounted: projects are cloned into the box's volume and leave
// as pushed branches and pull requests. src/cli/container.mjs drives compose; this file adds the box's file list,
// the preflight, the guided setup that writes .env, and the posture report (`worca container status`).
//
// Every docker call goes through the injected `exec` ({status, stdout, stderr}), so tests never need Docker.

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import process from 'node:process';

import { DEFAULT_ALLOW } from '../core/egress-proxy.mjs';
import { dotenvValue, isLoopbackProxy, boxProxyEnv, gitConfigValue } from './container.mjs';
import { readHidden } from './proxy.mjs';

/** The overlays after compose.yml, in order. compose.ca.yml (with a CA) goes after `hardened`, compose.proxy.yml last. */
export const HARDENED_OVERLAYS = Object.freeze(['broker', 'isolation', 'egress', 'hardened', 'proxy']);
export const HARDENED_PROJECT = 'worca-hardened';
export const PLAIN_PROJECT = 'worca';
export const HARDENED_IMAGE_LABEL = 'dev.worca.hardened-box';
export const HARDENED_IMAGE_NEEDED = 1;
/** compose.isolation.yml's `!reset` and compose.hardened.yml's `!override` need it. */
export const MIN_COMPOSE = [2, 24, 0];
const DATA_VOLUME = `${HARDENED_PROJECT}_worca-data`;
const CA_MOUNT = '/etc/worca/corporate-ca.pem';
const SIDECAR = 'http://egress:3128';

/** The git hosts the setup knows: the token variable compose.yml passes, and the hosts the allow-list needs. */
export const GIT_HOSTS = Object.freeze({
  'github.com': { tokenVar: 'GH_TOKEN', allow: ['github.com', '.github.com', '.githubusercontent.com'] },
  'dev.azure.com': { tokenVar: 'WORCA_ADO_TOKEN', allow: ['dev.azure.com', '.visualstudio.com', 'vssps.dev.azure.com'] },
  'bitbucket.org': { tokenVar: 'WORCA_BB_TOKEN', allow: ['bitbucket.org', 'api.bitbucket.org'] },
});
const GIT_ALIASES = { github: 'github.com', azure: 'dev.azure.com', ado: 'dev.azure.com', bitbucket: 'bitbucket.org' };
/** Git tokens compose.yml hands to Worca (never to agents): one of them set counts as "git token set". */
const GIT_TOKEN_VARS = ['GH_TOKEN', 'WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN', 'WORCA_BB_TOKEN', 'WORCA_BB_READ_TOKEN', 'WORCA_BB_WRITE_TOKEN'];
/** The example .env's placeholders: not a value the user set. */
const PLACEHOLDERS = { GIT_AUTHOR_NAME: 'Your Name', GIT_AUTHOR_EMAIL: 'you@example.com' };
/** Model credentials Worca's container must not hold (the broker holds the one key). */
const MODEL_KEY_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CURSOR_API_KEY', 'OPENROUTER_API_KEY'];

export const HARDENED_HELP = `
The hardened box (docs/hardened-box.md): one developer, on their own machine, Docker only.
  worca container up --hardened [setup flags]   Check this machine, ask for what is missing, write .env, start it.
                                                 Remembered: later verbs act on the hardened box.
  worca container init --hardened [setup flags] The same checks and setup, without starting it
  worca container status [--json]               The posture report: one line per protection, read from the running box
  worca container up --plain                    Back to the plain container (its own volumes, untouched)
  --hardened / --plain on down, logs, status, run, shell, proxy: act on that box this once.

Setup flags (each also settable without a prompt; secrets never on the command line):
  --model-key-file <f>   The broker's model credential (API key or subscription token); or WORCA_BROKER_KEY_ANTHROPIC in the environment
  --git-host <h>         github.com (default), dev.azure.com or bitbucket.org
  --git-token-file <f>   The git token Worca holds (agents never get it); or WORCA_GIT_TOKEN (or GH_TOKEN, …) in the environment
  --git-name <n>, --git-email <e>   Commit identity (default: your git config)
  --allow <hosts>        Extra hosts for the allow-list, comma-separated (your package registry, …)
  --proxy <host:port>    The corporate proxy (default: detected); --no-proxy for none
  --proxy-user <DOMAIN\\user>   Log in to the proxy now; the password comes from a hidden prompt or stdin
  --ca-file <pem>        The corporate CA, for a proxy that re-signs TLS
  --yes                  Never prompt: take what is given and detected, refuse what is missing`;

// ── Flags ──────────────────────────────────────────────────────────────────────────────────────────

const VALUE_FLAGS = { '--model-key-file': 'modelKeyFile', '--git-host': 'gitHost', '--git-token-file': 'gitTokenFile', '--git-name': 'gitName',
  '--git-email': 'gitEmail', '--allow': 'allow', '--proxy': 'proxy', '--proxy-user': 'proxyUser', '--ca-file': 'caFile' };
const BOOL_FLAGS = { '--no-proxy': 'noProxy', '--yes': 'yes', '-y': 'yes', '--json': 'json' };

/** The setup flags among the tokens container.mjs did not take. @returns {{flags: object, rest: string[]} | {error: string}} */
export function parseHardenedFlags(tokens = []) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^--(model-key|git-token|password|proxy-password)(=|$)/.test(t)) {
      return { error: `${t.split('=')[0]} would put a secret on the command line, where ps shows it: use the matching -file flag or the environment` };
    }
    if (VALUE_FLAGS[t]) {
      const v = tokens[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${t} needs a value` };
      flags[VALUE_FLAGS[t]] = v; i++;
    } else if (BOOL_FLAGS[t]) flags[BOOL_FLAGS[t]] = true;
    else rest.push(t);
  }
  if (flags.proxy && flags.noProxy) return { error: '--proxy and --no-proxy contradict each other' };
  return { flags, rest };
}

/** Which box a call acts on: the flag, else the remembered choice. */
export function selectBox(flagBox, state = {}) {
  if (flagBox === 'hardened' || flagBox === 'plain') return flagBox;
  return state.hardened === true ? 'hardened' : 'plain';
}

// ── .env ───────────────────────────────────────────────────────────────────────────────────────────

/** `key` as compose's .env reads it ('' when unset, commented out, empty or still the example's placeholder). */
export function envValue(body, key) {
  const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`, 'm').exec(body || '');
  const v = m ? dotenvValue(m[1]) : '';
  return PLACEHOLDERS[key] && v === PLACEHOLDERS[key] ? '' : v;
}

/**
 * Write `entries` ([{key, value}]) into .env without touching a value the user set: an empty line or the example's
 * placeholder is filled in place, anything else is appended under one header. Mode 0600.
 */
export function writeEnvValues(file, entries) {
  let body = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const append = [];
  for (const { key, value } of entries) {
    if (/[\r\n]/.test(String(value))) throw new Error(`${key}: a value cannot hold a line break`);
    if (envValue(body, key)) continue;
    const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
    if (re.test(body)) body = body.replace(re, () => `${key}=${value}`);
    else append.push(`${key}=${value}`);
  }
  if (append.length) body = `${body.replace(/\n*$/, '\n')}\n# Hardened box (worca container up --hardened, docs/hardened-box.md).\n${append.join('\n')}\n`;
  writeFileSync(file, body, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows */ }
}

// ── Preflight ──────────────────────────────────────────────────────────────────────────────────────

/** Windows runs it from WSL2; WSL1 has no real Linux kernel for Docker. @returns {string|null} the refusal */
export function checkPlatform({ platform = process.platform, readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  if (platform === 'win32') return 'the hardened box runs from a WSL2 shell on Windows: open your WSL2 distro and run worca container up --hardened there';
  if (platform !== 'linux') return null;
  let v = '';
  try { v = readFile('/proc/version'); } catch { return null; }
  if (/microsoft/i.test(v) && !/WSL2|microsoft-standard/i.test(v)) return 'this is WSL1: the hardened box needs WSL2 (wsl --set-version <distro> 2)';
  return null;
}

/** Docker present and running, not Podman, not rootless. @returns {string|null} */
export function checkDocker({ exec, bin }) {
  if (bin !== 'docker') return `the hardened box needs Docker; ${bin} is not supported (Podman and rootless Docker are not, for now)`;
  const r = exec('docker', ['info', '--format', '{{json .}}'], { capture: true });
  if (r.status !== 0) return 'Docker is not running (docker info failed): start Docker Desktop or the Docker service, then try again';
  let info = null;
  try { info = JSON.parse(String(r.stdout || '').trim()); } catch { /* read as text below */ }
  const text = String(r.stdout || '');
  if (/podman/i.test(info ? JSON.stringify([info.ServerVersion, info.OperatingSystem, info.Name, info.host, info.version]) : text)) {
    return 'this docker command talks to Podman: the hardened box needs Docker (Podman is not supported for now)';
  }
  const opts = info && Array.isArray(info.SecurityOptions) ? info.SecurityOptions : [];
  if (opts.some((o) => /name=rootless/.test(String(o))) || /name=rootless/.test(text)) {
    return 'this Docker runs rootless: the hardened box needs rootful Docker (agent users need setuid inside the box)';
  }
  return null;
}

/** `2.39.1-desktop.1` or `v2.24.0` → [2, 39, 1]; null when it is not a version. */
export function parseComposeVersion(s) {
  const m = /v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

export function checkComposeVersion({ exec, bin }) {
  const r = exec(bin, ['compose', 'version', '--short'], { capture: true });
  const v = r.status === 0 ? parseComposeVersion(r.stdout) : null;
  if (!v) return 'cannot read the Docker Compose version (docker compose version --short): the hardened box needs Compose 2.24 or newer';
  for (let i = 0; i < 3; i++) {
    if (v[i] > MIN_COMPOSE[i]) return null;
    if (v[i] < MIN_COMPOSE[i]) return `Docker Compose ${v.join('.')} is too old: the hardened box needs 2.24 or newer (update Docker Desktop or the compose plugin)`;
  }
  return null;
}

/** The worca image carries `label` ≥ `needed`, pulled once when missing. @returns {string|null} */
export function checkImageLabel({ exec, bin, cwd, env, files, service = 'worca', label = HARDENED_IMAGE_LABEL, needed = HARDENED_IMAGE_NEEDED, tag = '' }) {
  let image = `ghcr.io/worca-org/worca:${tag || 'latest'}`;
  const cfg = exec(bin, ['compose', ...files, 'config', '--format', 'json'], { cwd, env, capture: true });
  if (cfg.status === 0) { try { image = JSON.parse(cfg.stdout).services[service].image || image; } catch { /* the default */ } }
  const inspect = () => exec(bin, ['image', 'inspect', '--format', `{{ index .Config.Labels "${label}" }}`, image], { capture: true });
  let r = inspect();
  if (r.status !== 0) { exec(bin, ['compose', ...files, 'pull', service], { cwd, env, capture: true }); r = inspect(); }
  if (r.status !== 0) return `cannot check the image ${image}: it is not on this machine and could not be pulled; nothing was started`;
  const v = Number(String(r.stdout || '').trim());
  if (!Number.isInteger(v) || v < needed) {
    return `the image ${image} is older than these compose files: it has no hardened box (label ${label}). Use a newer image (WORCA_TAG in .env, then worca container pull --hardened); nothing was started`;
  }
  return null;
}

/** Sign-ins the broker refuses to start with, on the box's data volume. */
export const SIGN_IN_PATHS = Object.freeze(['/data/home/.claude/.credentials.json', '/data/home/.codex/auth.json',
  '/data/agent-home/.claude/.credentials.json', '/data/agent-home/.codex/auth.json', '/data/agent-homes/*/.claude/.credentials.json']);
const SIGN_IN_SCRIPT = `for f in ${SIGN_IN_PATHS.join(' ')}; do [ -e "$f" ] && echo "$f"; done; `
  + 'for f in /data/home/.claude/settings.json /data/agent-home/.claude/settings.json; do grep -l apiKeyHelper "$f" 2>/dev/null; done; true';

/** A Claude (or Codex) sign-in or an apiKeyHelper left on the data volume. @returns {string[]} the paths found */
export function findSignIns({ exec, bin, cwd, env, files }) {
  if (exec(bin, ['volume', 'inspect', DATA_VOLUME], { capture: true }).status !== 0) return [];
  const r = exec(bin, ['compose', ...files, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'worca', '-c', SIGN_IN_SCRIPT], { cwd, env, capture: true });
  return r.status === 0 ? String(r.stdout || '').split('\n').map((s) => s.trim()).filter((s) => s.startsWith('/data/')) : [];
}

/** Compose projects with a container running. */
export function runningProject({ exec, bin, project }) {
  const r = exec(bin, ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`], { capture: true });
  return r.status === 0 && String(r.stdout || '').trim() !== '';
}

/** The plain container's volumes (project `worca`): its data, which the hardened box does not carry over. */
export function plainVolumes({ exec, bin }) {
  const r = exec(bin, ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${PLAIN_PROJECT}`], { capture: true });
  return r.status === 0 ? String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

// ── Guided setup ───────────────────────────────────────────────────────────────────────────────────

/** `http://host:port` without a login, from `host:port` or a URL. @returns {{url: string, hadLogin: boolean} | null} */
export function normalizeProxy(s) {
  const raw = String(s || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (!u.hostname) return null;
    return { url: `${u.protocol}//${u.host}`, hadLogin: !!(u.username || u.password) };
  } catch { return null; }
}

const readTrimmed = (f) => readFileSync(resolve(f), 'utf8').trim();
const isPem = (f) => { try { return /BEGIN CERTIFICATE/.test(readFileSync(f, 'utf8')); } catch { return false; } };

/** A visible prompt (readline) and a hidden one (raw mode), for a terminal. */
export function terminalAsk({ input = process.stdin, output = process.stderr } = {}) {
  return async (question, { hidden = false } = {}) => {
    if (hidden) return readHidden(question, { input, output });
    const rl = createInterface({ input, output });
    return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
  };
}

/**
 * Work out what .env needs and ask only for what is missing.
 * @param {{body: string, flags: object, env: object, ask: Function|null, gitConfig: (k: string) => string,
 *   detectProxy: () => string, random?: () => string, exists?: Function}} o  `ask` null: never prompt
 * @returns {Promise<{entries: {key: string, value: string, note: string}[], notes: string[], error?: string}>}
 */
export async function planSetup({ body, flags = {}, env = {}, ask = null, gitConfig = () => '', detectProxy = () => '',
  random = () => randomBytes(32).toString('base64url'), exists = existsSync }) {
  const has = (k) => !!envValue(body, k);
  const entries = [];
  const notes = [];
  const put = (key, value, note) => entries.push({ key, value, note });
  const askLine = async (q, def = '') => { if (!ask) return def; const a = String(await ask(def ? `${q} [${def}]: ` : `${q}: `)).trim(); return a || def; };

  // 1. The model credential, for the broker only (never ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN: those reach Worca).
  if (!has('WORCA_BROKER_KEY_ANTHROPIC')) {
    let key = '';
    if (flags.modelKeyFile) { try { key = readTrimmed(flags.modelKeyFile); } catch { return { entries, notes, error: `--model-key-file: cannot read ${flags.modelKeyFile}` }; } }
    else if (env.WORCA_BROKER_KEY_ANTHROPIC) key = String(env.WORCA_BROKER_KEY_ANTHROPIC).trim();
    else if (ask) key = String(await ask('Model credential for the broker (an Anthropic API key, or a subscription token from `claude setup-token`): ', { hidden: true })).trim();
    if (!key) return { entries, notes, error: 'no model credential for the broker: set WORCA_BROKER_KEY_ANTHROPIC in the environment, or pass --model-key-file <file>' };
    if (!/^sk-ant-/.test(key)) notes.push('the model credential does not start with sk-ant-: the broker checks it on the first call');
    put('WORCA_BROKER_KEY_ANTHROPIC', key, 'the model credential (held by the broker only)');
  }
  // 2. The two shared secrets, generated.
  if (!has('WORCA_BROKER_SECRET')) put('WORCA_BROKER_SECRET', random(), 'generated');
  if (!has('WORCA_EGRESS_SECRET')) put('WORCA_EGRESS_SECRET', random(), 'generated');

  // 3. Git over HTTPS: the host, then the token Worca holds.
  let host = String(flags.gitHost || '').trim().toLowerCase();
  host = GIT_ALIASES[host] || host;
  if (host && !GIT_HOSTS[host]) return { entries, notes, error: `--git-host must be github.com, dev.azure.com or bitbucket.org (another host: set its token in .env and add it with --allow)` };
  const tokenSet = GIT_TOKEN_VARS.some(has);
  if (!tokenSet) {
    if (!host) { host = (await askLine('Git host (github.com, dev.azure.com or bitbucket.org)', 'github.com')).toLowerCase(); host = GIT_ALIASES[host] || host; }
    if (!GIT_HOSTS[host]) return { entries, notes, error: `git host ${host}: the setup knows github.com, dev.azure.com and bitbucket.org` };
    const tokenVar = GIT_HOSTS[host].tokenVar;
    let token = '';
    if (flags.gitTokenFile) { try { token = readTrimmed(flags.gitTokenFile); } catch { return { entries, notes, error: `--git-token-file: cannot read ${flags.gitTokenFile}` }; } }
    else if (env.WORCA_GIT_TOKEN) token = String(env.WORCA_GIT_TOKEN).trim();
    else if (env[tokenVar]) token = String(env[tokenVar]).trim();
    else if (ask) token = String(await ask(`Git token for ${host} (Worca holds it; agents never get it; Enter to skip): `, { hidden: true })).trim();
    if (token) put(tokenVar, token, `the git token for ${host}`);
    else notes.push(`no git token: Worca cannot clone private repositories or push. Add ${tokenVar} to .env later`);
    if (host === 'bitbucket.org' && token && !has('WORCA_BB_EMAIL')) notes.push('an Atlassian API token also needs WORCA_BB_EMAIL in .env');
  }
  // 4. Commit identity.
  for (const [key, flag, label, cfg] of [['GIT_AUTHOR_NAME', 'gitName', 'Commit name', 'user.name'], ['GIT_AUTHOR_EMAIL', 'gitEmail', 'Commit email', 'user.email']]) {
    if (has(key)) continue;
    const v = flags[flag] || (await askLine(label, gitConfig(cfg)));
    if (v) put(key, v, 'commit identity');
    else notes.push(`no ${label.toLowerCase()}: agents cannot commit until ${key} is in .env`);
  }
  // 5. The allow-list: the defaults (the broker reaches the model provider through it), the git host, the extras.
  const extras = String(flags.allow || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (has('WORCA_EGRESS_ALLOW')) {
    const now = envValue(body, 'WORCA_EGRESS_ALLOW').split(',').map((s) => s.trim());
    const missing = extras.filter((h) => !now.includes(h));
    if (missing.length) notes.push(`WORCA_EGRESS_ALLOW is already set in .env, so it was left alone: add ${missing.join(', ')} to it yourself`);
  } else {
    const asked = flags.allow !== undefined ? [] : String(await askLine('Extra hosts for the allow-list, comma-separated (your package registry, …; Enter for none)')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const list = [...new Set([...DEFAULT_ALLOW, ...(GIT_HOSTS[host] ? GIT_HOSTS[host].allow : []), ...extras, ...asked])];
    const bad = list.find((h) => !/^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(h));
    if (bad) return { entries, notes, error: `the allow-list entry ${bad} is not a host name (".acme.example" allows its subdomains)` };
    put('WORCA_EGRESS_ALLOW', list.join(','), 'the allow-list');
  }
  // 6. The corporate proxy: host and port only. The login goes to the sidecar, never to .env.
  let proxySet = has('HTTPS_PROXY') && !isLoopbackProxy(envValue(body, 'HTTPS_PROXY'));
  if (has('HTTPS_PROXY') && !proxySet) notes.push('.env sets HTTPS_PROXY to a loopback address, which inside the box is the box itself: set it to the corporate proxy');
  if (!proxySet && !flags.noProxy && !has('HTTPS_PROXY')) {
    const detected = flags.proxy ? '' : String(detectProxy() || '');
    const pick = flags.proxy || (ask ? await askLine('Corporate proxy, host:port (Enter for none)', detected ? normalizeProxy(detected)?.url || '' : '') : detected);
    if (pick && pick !== '-') {
      const p = normalizeProxy(pick);
      if (!p) return { entries, notes, error: `the proxy ${pick} is not host:port or a URL` };
      if (isLoopbackProxy(p.url)) notes.push(`${p.url} is on this machine's loopback (Worca's own local proxy?): the box cannot reach it, so it was left out`);
      else {
        put('HTTPS_PROXY', p.url, 'the corporate proxy (host and port; the login goes to the sidecar)');
        if (p.hadLogin) notes.push('the login in that proxy URL was left out of .env: log in to the sidecar instead (worca container proxy login)');
        proxySet = true;
      }
    }
  }
  // 7. The corporate CA, for a proxy that re-signs TLS.
  if (!has('WORCA_CA_CERT')) {
    const detected = [env.NODE_EXTRA_CA_CERTS, env.SSL_CERT_FILE].find((f) => f && String(f).trim() && isPem(String(f).trim()));
    let file = flags.caFile || '';
    if (!file && proxySet && ask) file = await askLine('Corporate CA file (PEM) for a proxy that re-signs TLS (Enter for none)', detected || '');
    else if (!file && detected && !ask) file = detected;
    if (file) {
      const abs = resolve(String(file).trim());
      if (!exists(abs) || !isPem(abs)) return { entries, notes, error: `the CA file ${abs} is not a readable PEM certificate` };
      put('WORCA_CA_CERT', abs, 'the corporate CA');
    }
  }
  return { entries, notes, proxySet };
}

/** The corporate proxy this machine uses, for the setup's default: the shell's (not Worca's loopback one), else settings.json. */
export function detectProxy({ env = process.env, settings, login } = {}) {
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    if (env[k] && !isLoopbackProxy(env[k])) return env[k];
  }
  try {
    const p = boxProxyEnv({ env: { HTTPS_PROXY: 'http://127.0.0.1:1' }, envFile: () => '', ...(settings ? { settings } : {}), ...(login ? { login } : {}) });
    return p.loginUpstream || p.set.HTTPS_PROXY || '';
  } catch { return ''; }
}

// ── Posture ────────────────────────────────────────────────────────────────────────────────────────

const envMap = (c) => Object.fromEntries((c?.Config?.Env || []).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
/** The value of whichever regex matches last in `text` (the newest start-up line wins), or null. */
const lastMatch = (text, pairs) => {
  let best = null; let at = -1;
  for (const [re, v] of pairs) {
    for (const m of String(text).matchAll(new RegExp(re.source, 'g'))) if (m.index > at) { at = m.index; best = v; }
  }
  return best;
};
const urlLogin = (v) => { try { const u = new URL(String(v)); return !!(u.username || u.password); } catch { return false; } };

/**
 * One row per protection, from what docker reports about the running box. Pure.
 * @param {{containers: Record<string, object>, networks: object[], sidecar: object|null, logs: string}} d
 *   containers: `docker inspect` per service (worca, broker, egress, ui); networks: `docker network inspect` of worca's
 * @returns {{running: boolean, rows: {id: string, label: string, status: 'on'|'off'|'unknown', detail: string, fix?: string}[], reason?: string}}
 */
export function postureRows({ containers = {}, networks = [], sidecar = null, logs = '' }) {
  const w = containers.worca;
  const running = !!w?.State?.Running;
  if (!running) {
    const why = String(logs).split('\n').filter((l) => /^worca: /.test(l.trim()) || /refuses|cannot|not writable/i.test(l)).slice(-4).join('\n');
    return { running: false, rows: [], reason: why };
  }
  const e = envMap(w);
  const rows = [];
  const row = (id, label, status, detail, fix) => rows.push({ id, label, status, detail, ...(status === 'on' ? {} : { fix }) });

  // Agents under their own users: the entrypoint says which, at each start.
  const agents = lastMatch(logs, [[/agents run as worca-agent; they cannot read/, 'on'], [/agents run as worca instead/, 'off']]);
  const pool = /each signed-in person's agents run as their own user/.test(logs);
  if (e.WORCA_DATA_DIR && e.WORCA_AGENT_ISOLATION !== '0' && agents === 'on') {
    row('agents', 'Agents run under their own users', 'on', `worca-agent${pool ? ', and one user per signed-in person' : ''}: they cannot read Worca's settings, database or environment`);
  } else if (agents === 'off' || e.WORCA_AGENT_ISOLATION === '0' || !e.WORCA_DATA_DIR) {
    row('agents', 'Agents run under their own users', 'off', e.WORCA_AGENT_ISOLATION === '0' ? 'WORCA_AGENT_ISOLATION=0 is set' : 'agents run as Worca itself',
      'the box could not switch to the agent users (see worca container logs); start it again with worca container up --hardened, which brings back compose.isolation.yml');
  } else {
    row('agents', 'Agents run under their own users', 'unknown', 'the start-up line is no longer in the logs', 'start the box again (worca container up --hardened) and run status once more');
  }

  // The model key in the broker: none in Worca's container, the broker up, and Worca's own line.
  const keys = MODEL_KEY_VARS.filter((k) => e[k]);
  const broker = containers.broker;
  if (keys.length) row('model-key', 'Model key held by the broker', 'off', `${keys.join(', ')} is set in Worca's container`, 'remove it from the shell and .env; the key belongs in WORCA_BROKER_KEY_ANTHROPIC');
  else if (!e.WORCA_BROKER_URL) row('model-key', 'Model key held by the broker', 'off', 'Worca has no broker (WORCA_BROKER_URL is unset)', 'start the box with worca container up --hardened');
  else if (!broker?.State?.Running) row('model-key', 'Model key held by the broker', 'off', 'the broker is not running', 'see worca container logs; then worca container up --hardened');
  else if (/credentials: broker /.test(logs)) row('model-key', 'Model key held by the broker', 'on', `Worca's container holds none; the broker (${envMap(broker).WORCA_BROKER_MODE || 'single'} mode) adds it on the way to the provider`);
  else row('model-key', 'Model key held by the broker', 'unknown', 'Worca has not logged its credentials line yet', 'wait for the box to finish starting, then run status again');

  // The proxy login in the sidecar, or no proxy.
  const boxProxy = [e.HTTPS_PROXY, e.HTTP_PROXY, e.https_proxy, e.http_proxy].filter(Boolean);
  const eg = containers.egress;
  if (boxProxy.some(urlLogin)) row('proxy-login', 'Proxy login in the sidecar', 'off', 'Worca\'s container has a proxy URL with a login in it', 'take the login out of the proxy variables; log in with worca container proxy login');
  else if (!eg?.State?.Running) row('proxy-login', 'Proxy login in the sidecar', 'off', 'the egress sidecar is not running', 'worca container up --hardened');
  else if (!sidecar) row('proxy-login', 'Proxy login in the sidecar', 'unknown', 'the sidecar did not answer worca egress status', 'see worca container logs --hardened');
  else if (sidecar.state === 'not-configured' || sidecar.state === 'off') row('proxy-login', 'Proxy login in the sidecar', 'on', 'no corporate proxy: the sidecar relays direct');
  else if (sidecar.state === 'no-login') row('proxy-login', 'Proxy login in the sidecar', 'on', `the proxy ${sidecar.upstream} needs no login`);
  else if (sidecar.state === 'ready') row('proxy-login', 'Proxy login in the sidecar', 'on', `the sidecar holds the login for ${sidecar.upstream}${sidecar.login?.label ? ` (${sidecar.login.label})` : ''}${sidecar.managed ? ', managed by the operator' : ''}`);
  else if (sidecar.state === 'needs-login') row('proxy-login', 'Proxy login in the sidecar', 'off', `the proxy ${sidecar.upstream} asks for a login and none works`,
    sidecar.managed ? 'the operator manages this login: replace the login file (WORCA_EGRESS_LOGIN_FILE) with a working one' : 'worca container proxy login');
  else row('proxy-login', 'Proxy login in the sidecar', 'off', `the proxy setting has an error${sidecar.error ? `: ${sidecar.error}` : ''}`, 'fix HTTPS_PROXY in .env, then worca container up --hardened');

  // The allow-list: Worca on internal networks only, the sidecar in allow-list mode, Worca pointed at it.
  const nets = Object.keys(w?.NetworkSettings?.Networks || {});
  const open = nets.filter((n) => !networks.find((x) => x.Name === n)?.Internal);
  const mode = sidecar?.policy?.mode || (envMap(eg).WORCA_EGRESS_MODE ? envMap(eg).WORCA_EGRESS_MODE : envMap(eg).WORCA_EGRESS_ALLOWLIST === '1' ? 'allowlist' : 'open');
  if (!nets.length || open.length) row('allowlist', 'Allow-list on, no route out', 'off', `Worca is on ${open.length ? `a network with a route out (${open.join(', ')})` : 'no network'}`, 'worca container up --hardened (compose.egress.yml puts it on the internal network)');
  else if (mode !== 'allowlist') row('allowlist', 'Allow-list on, no route out', 'off', `the sidecar runs in ${mode} mode`, 'leave WORCA_EGRESS_MODE unset in .env, then worca container up --hardened');
  else if (!boxProxy.every((v) => String(v).startsWith(SIDECAR))) row('allowlist', 'Allow-list on, no route out', 'off', 'Worca is not pointed at the sidecar', 'worca container up --hardened');
  else {
    const allow = sidecar?.policy?.allow || [];
    row('allowlist', 'Allow-list on, no route out', 'on', `Worca's network has no route out; the sidecar lets through ${allow.length ? `${allow.length} hosts (${allow.slice(0, 4).join(', ')}${allow.length > 4 ? ', …' : ''})` : 'the listed hosts'}`);
  }

  // No host project mount: volumes only (and the CA file, read-only).
  const binds = (w?.Mounts || []).filter((m) => m.Type === 'bind' && !(m.Destination === CA_MOUNT && m.RW === false));
  if (binds.length) row('no-host-mount', 'No host project mount', 'off', `host folders are mounted at ${binds.map((m) => m.Destination).join(', ')}`, 'remove the mount (a compose.override.yml?) and start the box with worca container up --hardened');
  else row('no-host-mount', 'No host project mount', 'on', 'projects live in the box\'s volume; results leave as pushed branches and pull requests');

  return { running: true, rows };
}

/** Gather what postureRows reads, from the running box. */
export function readPosture({ exec, bin, cwd, env, files }) {
  const ps = exec(bin, ['compose', ...files, 'ps', '-a', '--format', 'json'], { cwd, env, capture: true });
  const list = [];
  const raw = String(ps.stdout || '').trim();
  if (raw.startsWith('[')) { try { list.push(...JSON.parse(raw)); } catch { /* none */ } }
  else for (const l of raw.split('\n')) { try { if (l.trim()) list.push(JSON.parse(l)); } catch { /* skip */ } }
  const containers = {};
  const names = list.filter((x) => ['worca', 'broker', 'egress', 'ui'].includes(x.Service));
  if (names.length) {
    const r = exec(bin, ['inspect', ...names.map((x) => x.Name || x.ID)], { capture: true });
    let arr = [];
    try { arr = JSON.parse(r.stdout || '[]'); } catch { arr = []; }
    for (const c of arr) {
      const svc = c?.Config?.Labels?.['com.docker.compose.service'];
      if (svc) containers[svc] = c;
    }
  }
  let networks = [];
  const nets = Object.keys(containers.worca?.NetworkSettings?.Networks || {});
  if (nets.length) {
    const r = exec(bin, ['network', 'inspect', ...nets], { capture: true });
    try { networks = JSON.parse(r.stdout || '[]'); } catch { networks = []; }
  }
  let sidecar = null;
  if (containers.egress?.State?.Running) {
    const r = exec(bin, ['compose', ...files, 'exec', '-T', 'egress', 'worca', 'egress', 'status', '--json'], { cwd, env, capture: true });
    try { sidecar = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch { sidecar = null; }
  }
  const logs = String(exec(bin, ['compose', ...files, 'logs', '--no-log-prefix', '--tail', '2000', 'worca'], { cwd, env, capture: true }).stdout || '');
  return { containers, networks, sidecar, logs };
}

export function printPosture(p, { out, c }) {
  if (!p.running) {
    out(`${c('bold', 'Hardened box')}  not running`);
    if (p.reason) for (const l of p.reason.split('\n')) out(`  ${l}`);
    out(`  Start it: ${c('bold', 'worca container up --hardened')}`);
    return;
  }
  out(`${c('bold', 'Hardened box')}  running (compose project ${HARDENED_PROJECT})`);
  for (const r of p.rows) {
    const tag = r.status === 'on' ? c('green', 'on     ') : r.status === 'off' ? c('red', 'OFF    ') : c('yellow', 'unknown');
    out(`  ${tag}  ${r.label.padEnd(34)} ${r.detail}`);
    if (r.fix) out(`           Fix: ${r.fix}`);
  }
  out('  Agents cannot reach a model key, the git token or the proxy login. Other secrets (MCP registry secrets a run uses) stay in reach: docs/hardened-box.md');
}

// ── The verbs ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Before container.mjs prepares the compose env, for `up` and `init` on the hardened box: the machine checks, the
 * move from a plain container, and the guided setup. @returns {Promise<number|null>} an exit code to stop with, or null
 */
export async function hardenedBefore({ a, dir, exec, bin, out, c, fail, env, settings, login, stdin, state, writeState, ask: askOverride, platform }) {
  const parsed = parseHardenedFlags(a._);
  if (parsed.error) { fail(parsed.error); return 2; }
  const { flags } = parsed;
  if (a.with !== null && a.with !== undefined) {
    fail(`the hardened box has its own fixed set of overlays (${HARDENED_OVERLAYS.join(', ')}); --with is for the plain container${/\bssh\b/.test(a.with) ? '. The ssh-agent overlay is refused: git goes over HTTPS with the token Worca holds' : ''}`);
    return 2;
  }
  for (const check of [() => checkPlatform({ platform }), () => checkDocker({ exec, bin }), () => checkComposeVersion({ exec, bin })]) {
    const e = check();
    if (e) { fail(e); return 1; }
  }
  if (a.verb === 'up' && runningProject({ exec, bin, project: PLAIN_PROJECT })) {
    fail('the plain container is running and holds the same port: stop it first with worca container down --plain');
    return 1;
  }
  if (state.hardened !== true) {
    const old = plainVolumes({ exec, bin });
    if (old.length) {
      out(`${c('yellow', 'note')}  your plain container's data (${old.join(', ')}) is not carried over: the hardened box keeps its own volumes, and its projects are cloned from the remote.`);
      out('        The old volumes stay untouched. worca container up --plain brings the plain container back.');
    }
  }
  const envFile = join(dir, '.env');
  const body = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const interactive = !flags.yes && !!stdin?.isTTY;
  const ask = askOverride !== undefined ? askOverride : (interactive ? terminalAsk({ input: stdin }) : null);
  const gitConfig = (k) => gitConfigValue(exec, k);
  let plan;
  try {
    plan = await planSetup({ body, flags, env, ask, gitConfig, detectProxy: () => detectProxy({ env, settings, login }) });
  } catch (e) {
    fail(e && e.code === 'ABORT_ERR' ? 'cancelled; nothing was written' : `the setup stopped: ${e && e.message ? e.message : e}`);
    return e && e.code === 'ABORT_ERR' ? 130 : 1;
  }
  if (plan.error) { fail(plan.error); return 1; }
  if (plan.entries.length) {
    writeEnvValues(envFile, plan.entries);
    out(`${c('green', 'setup')}  wrote into ${envFile} (mode 0600): ${plan.entries.map((x) => `${x.key} (${x.note})`).join('; ')}`);
  } else out(`${c('green', 'setup')}  ${envFile} already has everything the hardened box needs`);
  for (const n of plan.notes) out(`${c('yellow', 'note')}  ${n}`);
  writeState({ ...state, hardened: true, ...(flags.proxyUser ? { proxyUser: flags.proxyUser } : {}) });
  return a.verb === 'init' ? 0 : null;
}

/**
 * `up` on the hardened box, after container.mjs prepared the compose env: the image, a sign-in left on the volume,
 * then the proxy login (into the sidecar) before Worca starts. @returns {Promise<number|null>} exit code, or null to go on
 */
export async function hardenedUp({ a, dir, exec, bin, composeEnv, files, out, c, fail, stdin, login: proxyLogin, state, ask: askOverride }) {
  const { flags } = parseHardenedFlags(a._);
  const img = checkImageLabel({ exec, bin, cwd: dir, env: composeEnv, files, tag: composeEnv?.WORCA_TAG });
  if (img) { fail(img); return 1; }
  const found = findSignIns({ exec, bin, cwd: dir, env: composeEnv, files });
  if (found.length) {
    fail(`a sign-in is left on the box's volume, and the broker refuses to start with one in agents' reach: ${found.join(', ')}.\n`
      + `  Remove it: cd ${dir} && docker compose ${files.join(' ')} run --rm --no-deps --entrypoint rm worca -f ${found.join(' ')}`);
    return 1;
  }
  const envBody = existsSync(join(dir, '.env')) ? readFileSync(join(dir, '.env'), 'utf8') : '';
  const proxy = envValue(envBody, 'HTTPS_PROXY');
  const user = flags.proxyUser || state?.proxyUser || '';
  if (proxy && !urlLogin(proxy.includes('://') ? proxy : `http://${proxy}`)) {
    let wanted = !!flags.proxyUser;
    if (!wanted && !flags.yes && stdin?.isTTY) {
      const up = exec(bin, ['compose', ...files, 'up', '-d', '--no-deps', 'egress'], { cwd: dir, env: composeEnv, capture: true });
      const st = up.status === 0 ? exec(bin, ['compose', ...files, 'exec', '-T', 'egress', 'worca', 'egress', 'status', '--json'], { cwd: dir, env: composeEnv, capture: true }) : null;
      let saved = null;
      try { saved = st ? JSON.parse(String(st.stdout || '').trim().split('\n').pop()) : null; } catch { saved = null; }
      if (!saved?.login && saved?.state !== 'no-login') {
        const ask = askOverride !== undefined ? askOverride : terminalAsk({ input: stdin });
        wanted = /^y/i.test(String(await ask(`Does the proxy ${proxy} need a login (NTLM, Negotiate, Digest or Basic)? [y/N]: `)).trim());
      }
    }
    if (wanted) {
      const code = await proxyLogin([...(user ? ['--user', user] : [])]);
      if (code !== 0) { fail('the proxy login was not saved; the box was not started. Try again, or start without it and run worca container proxy login'); return code; }
    } else if (!stdin?.isTTY || flags.yes) {
      out(`${c('yellow', 'proxy')}  if ${proxy} needs a login: worca container proxy login (the sidecar holds it; .env never does)`);
    }
  }
  return null;
}

/** `status` on the hardened box: the posture report. Exit 0 all on, 1 something off or unknown, 3 not running. */
export function hardenedStatus({ a, dir, exec, bin, composeEnv, files, out, c }) {
  const json = a._.includes('--json');
  const p = postureRows(readPosture({ exec, bin, cwd: dir, env: composeEnv, files }));
  const ok = p.running && p.rows.every((r) => r.status === 'on');
  if (json) out(JSON.stringify({ box: 'hardened', project: HARDENED_PROJECT, running: p.running, ok, protections: p.rows, ...(p.reason ? { reason: p.reason } : {}) }));
  else printPosture(p, { out, c });
  return !p.running ? 3 : ok ? 0 : 1;
}

/** The keys the setup may write into .env (docs/hardened-box.md, docker/.env.example). */
export const SETUP_KEYS = Object.freeze(['WORCA_BROKER_KEY_ANTHROPIC', 'WORCA_BROKER_SECRET', 'WORCA_EGRESS_SECRET', 'GH_TOKEN', 'WORCA_ADO_TOKEN',
  'WORCA_BB_TOKEN', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'WORCA_EGRESS_ALLOW', 'HTTPS_PROXY', 'WORCA_CA_CERT']);
