// src/cli/container.mjs
// `worca container` — run Worca in a container from the npm install
// (docs/docker.md; plans/container-isolation-design.md §12.3). A thin wrapper:
// it writes the package's compose files into <worcaHome>/container/, seeds a
// .env once, and shells out to `docker compose` (or `podman compose`). Nothing
// here talks to the engine; the box runs its own Worca with its own home.
// `up --project` narrows the box to one project with its secret files masked
// (container-mounts.mjs; plans/core-5-per-run-container-mount-design.md).
//
// Every verb takes { out, c, fail } from the CLI and an injectable `exec` so
// tests never spawn a runtime.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, appendFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { worcaHome, listProjects } from '../core/projects.mjs';
import { gitAvailable } from '../core/git-available.mjs';
import { readSettings } from '../core/settings.mjs';
import { readProxyLogin } from '../core/proxy-credentials.mjs';
import { resolveUpstream, upstreamLabel } from '../core/upstream-proxy.mjs';
import { readLoginInput } from './proxy.mjs';
import { HARDENED_OVERLAYS, HARDENED_HELP, HARDENED_PROJECT, selectBox, hardenedBefore, hardenedUp, hardenedStatus, runningProject } from './container-hardened.mjs';
import { boxImageForCompose } from '../core/exec-env/box-image.mjs';
import {
  MOUNT_FILE, MAX_MASKS, boxName, resolveProjectDir, maskSettingsFor, planProjectMasks, writeProjectMount, removeProjectMount, maskLines,
  maskAliases, maskAliasRefusal,
} from './container-mounts.mjs';

/** The compose files shipped in the package (package.json `files`). */
export const COMPOSE_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docker');
export const OVERLAYS = Object.freeze(['egress', 'ssh', 'teams', 'clonein', 'proxy']);
/** The image label that says it has the `worca egress` sidecar (docker/Dockerfile), and the API version these files need. */
export const SIDECAR_LABEL = 'dev.worca.egress-sidecar';
export const SIDECAR_API_NEEDED = 1;
export const SIDECAR_PROXY_URL = 'http://egress:3128';
const PROXY_VERBS = new Set(['status', 'login', 'logout', 'test']);
const STATE_FILE = '.worca-container.json';
/** The proxy variables compose.yml interpolates into the box (case-sensitive: compose reads these names only). */
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY'];
/** compose.yml's own NO_PROXY default. */
const DEFAULT_NO_PROXY = '127.0.0.1,localhost';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export const CONTAINER_HELP = `worca container — run Worca in a container (docs/docker.md)

  worca container init [--projects <dir>]        Write the compose files and a .env into the container dir
  worca container up [--with <overlays>] [--tag <t>] [--project <dir> | --no-project]
                                                 Start the box in the background and print the URL.
                                                 --with: comma-separated egress,ssh,teams,clonein (remembered)
                                                 --project: mount only this project, its secret files masked,
                                                 in its own box (remembered); --no-project: the whole
                                                 WORCA_PROJECTS folder again
  worca container down                           Stop and remove the containers (volumes are kept)
  worca container status                         Which containers are up
  worca container logs [--follow]                Server logs
  worca container pull                           Pull the newest image for the tag in .env
  worca container build [--project <key|dir>] [--status]
                                                 Build the box image from the projects' environment specs
  worca container login                          Log Claude Code in, once, into the box's own volume
  worca container shell                          A bash shell inside the box
  worca container run -- <worca args>            Run the Worca CLI inside the box
                                                 e.g. worca container run -- --project /path/to/repo --prompt "…"
  worca container proxy login|logout|status|test
                                                 The corporate proxy login, held by the egress sidecar
                                                 (never in the box). login asks for DOMAIN\\user and a hidden
                                                 password, or reads both from stdin
  worca container where                          Print the container dir (compose files, .env)
  worca container help

The egress sidecar (compose.proxy.yml) is added by itself when the corporate proxy
needs a login: a login in .env HTTPS_PROXY, a networkProxy.upstream on this machine
that needs one, or after \`worca container proxy login\`. It holds the login; the box
never does. WORCA_EGRESS_SECRET is written into .env for it.

A corporate CA (PEM) is mounted into the box when WORCA_CA_CERT is set in .env,
else from the shell's NODE_EXTRA_CA_CERTS or SSL_CERT_FILE. A proxy on this
machine's loopback (Worca's own local proxy) is never passed in; see docs/docker.md.

Options:
  --dir <d>        Container dir (default: <worcaHome>/container)
  --runtime <r>    docker | podman (default: autodetect; env WORCA_CONTAINER_RUNTIME)

The box has its own Worca home and its own Claude Code login: nothing from
~/.worca-cc or ~/.claude is mounted. Your repositories are mounted at the same
path as on the host (WORCA_PROJECTS in .env), so run worktrees stay valid here.
That folder is mounted whole and unmasked. With --project only that one folder
is mounted, in a box of its own (own volumes, own login), and its untracked
secret files (.env*, *.pem, *.key, .npmrc, .netrc, id_*, plus the project's
secretPaths) read as empty files in the box.
The plain container protects your machine, not the mounted projects.
`;

/** Default exec: run and inherit the terminal. Returns { status }. */
function defaultExec(cmd, args, { cwd, capture = false, env, input } = {}) {
  // `input`: written to the child's stdin (a login piped into the sidecar; never an argument).
  const stdin = input !== undefined ? 'pipe' : capture ? 'ignore' : 'inherit';
  const r = spawnSync(cmd, args, { cwd, env, input, stdio: capture ? [stdin, 'pipe', 'pipe'] : [stdin, 'inherit', 'inherit'], encoding: 'utf8' });
  return { status: r.error ? 127 : (r.status ?? 1), stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** `docker compose` or `podman compose`, by flag, env, then autodetect. */
export function detectRuntime(exec, want) {
  const pick = want || process.env.WORCA_CONTAINER_RUNTIME || '';
  const candidates = pick ? [pick] : ['docker', 'podman'];
  for (const bin of candidates) {
    if (!['docker', 'podman'].includes(bin)) return { error: `--runtime must be docker or podman, got ${bin}` };
    if (exec(bin, ['compose', 'version'], { capture: true }).status === 0) return { bin };
  }
  return { error: pick ? `${pick} compose is not available` : 'no container runtime found: install Docker Desktop, Docker Engine or Podman (with podman compose)' };
}

function parse(argv) {
  const o = { verb: argv[0] || 'help', dir: null, runtime: null, projects: null, with: null, tag: null, project: null, noProject: false, follow: false, box: null, passthrough: [], _: [] };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { o.passthrough = rest.slice(i + 1); break; }
    else if (a === '--dir') o.dir = rest[++i];
    else if (a === '--runtime') o.runtime = rest[++i];
    else if (a === '--projects') o.projects = rest[++i];
    else if (a === '--with') o.with = rest[++i];
    else if (a === '--tag') o.tag = rest[++i];
    // Only `up` takes these: `run --project <p> …` without `--` passes the worca CLI's own --project through.
    else if (a === '--project' && o.verb === 'up') o.project = rest[++i] ?? '';
    else if (a === '--no-project' && o.verb === 'up') o.noProject = true;
    else if (a === '--follow' || a === '-f') o.follow = true;
    else if (a === '--hardened' || a === '--plain') o.box = a.slice(2);
    else if (a === '--user') { o._.push(a, rest[++i]); }
    else o._.push(a);
  }
  return o;
}

/** Longest common ancestor directory of the registered projects, or null. */
export function commonParent(paths) {
  const parts = paths.filter(Boolean).map((p) => resolve(p).split(/[\\/]+/));
  if (!parts.length) return null;
  let prefix = parts[0].slice(0, -1);             // a project's parent, never the project itself
  for (const p of parts.slice(1)) {
    let n = 0;
    while (n < prefix.length && n < p.length - 1 && prefix[n] === p[n]) n++;
    prefix = prefix.slice(0, n);
  }
  if (prefix.length <= 1) return null;            // "/" or a drive root is too wide to mount
  return prefix.join('/') || '/';
}

/** The .env body for a fresh container dir: the example with the known values filled in. */
export function seedEnv(example, { projects, tz, gitName, gitEmail }) {
  const set = (body, key, value) => {
    if (!value) return body;
    const re = new RegExp(`^#?${key}=.*$`, 'm');
    return re.test(body) ? body.replace(re, `${key}=${value}`) : `${body}\n${key}=${value}\n`;
  };
  let body = example;
  body = set(body, 'WORCA_PROJECTS', projects);
  body = set(body, 'TZ', tz);
  body = set(body, 'GIT_AUTHOR_NAME', gitName);
  body = set(body, 'GIT_AUTHOR_EMAIL', gitEmail);
  return body;
}

function readState(dir) {
  try { return JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')); } catch { return {}; }
}
function writeState(dir, state) {
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

/** `-f compose.yml -f compose.<overlay>.yml …` for the remembered or requested overlays, then the generated project
 *  mount (container-mounts.mjs) last, so its masks land on top of every bind. */
export function composeFileArgs(overlays, { project = false } = {}) {
  const args = ['-f', 'compose.yml'];
  for (const o of overlays) args.push('-f', `compose.${o}.yml`);
  if (project) args.push('-f', MOUNT_FILE);
  return args;
}

function parseWith(s) {
  if (!s) return [];
  const list = s.split(',').map((x) => x.trim()).filter(Boolean);
  const bad = list.filter((x) => !OVERLAYS.includes(x));
  if (bad.length) return { error: `--with: unknown overlay ${bad.join(', ')} (known: ${OVERLAYS.join(', ')})` };
  return [...new Set(list)];
}

/** One `git config --get <key>` value from this machine, or '' (no git, or unset). */
export function gitConfigValue(exec, key) {
  if (!gitAvailable()) return '';
  const r = exec('git', ['config', '--get', key], { capture: true });
  return r.status === 0 ? String(r.stdout).trim() : '';
}

/** Copy the package's compose files into `dir` (always, they are versioned with the package)
 *  and seed .env once. Returns { dir, envCreated }. */
export async function initDir(dir, { projects, exec, srcDir = COMPOSE_SRC_DIR, env = process.env } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (/^compose(\.[a-z]+)?\.yml$/.test(f)) copyFileSync(join(srcDir, f), join(dir, f));
  }
  const envPath = join(dir, '.env');
  let envCreated = false;
  if (!existsSync(envPath)) {
    let root = projects;
    if (!root) {
      try { root = commonParent((await listProjects()).map((p) => p.path)); } catch { root = null; }
    }
    if (!root) root = join(env.HOME || env.USERPROFILE || homedir(), 'dev');
    const git = (k) => gitConfigValue(exec, k);
    const body = seedEnv(readFileSync(join(srcDir, '.env.example'), 'utf8'), {
      projects: root,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      gitName: git('user.name'),
      gitEmail: git('user.email'),
    });
    writeFileSync(envPath, body, { mode: 0o600 });
    envCreated = true;
  }
  return { dir, envCreated };
}

/** `raw` as compose's .env reads it, for checks only (whitespace-led `#` starts a comment
 *  in an unquoted value; quotes wrap a value). Never handed to compose: a value from .env
 *  reaches the box by leaving the shell variable unset, so compose reads the file itself. */
export function dotenvValue(raw) {
  const s = String(raw ?? '').trim();
  const q = /^(["'])(.*?)\1/.exec(s);
  return q ? q[2] : s.replace(/\s+#.*$/, '').trim();
}

function readEnvValue(dir, key) {
  try {
    const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`, 'm').exec(readFileSync(join(dir, '.env'), 'utf8'));
    return m ? dotenvValue(m[1]) : '';
  } catch { return ''; }
}

/** True when `value` is a proxy URL whose host is loopback: inside the box that is the box itself. */
export function isLoopbackProxy(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  try { return LOOPBACK_HOSTS.has(new URL(s.includes('://') ? s : `http://${s}`).hostname.toLowerCase()); } catch { return false; }
}

/**
 * The proxy variables for compose's interpolation. Compose takes a variable from the shell
 * before .env, so a shell that carries Worca's local proxy (http://127.0.0.1:<port>, set in
 * every terminal and child Worca starts with the corporate proxy on) would hand the box a
 * proxy that points at the box itself. Then, in order: the .env value wins; else the corporate
 * upstream from settings.json networkProxy.upstream, when it needs no login; else no proxy
 * and a notice (a login lives in the box's own Worca: its own settings and `worca proxy login`).
 * @returns {{set: Record<string, string|undefined>, notice: string}}  `set` overrides the shell env;
 *   undefined unsets a variable so compose takes .env's own value (never re-parsed here)
 */
export function boxProxyEnv({ env = process.env, envFile = () => '', settings = readSettings, login = readProxyLogin } = {}) {
  const set = {};
  let notice = '';
  const fileHas = (k) => !!envFile(k);
  for (const k of PROXY_KEYS) {
    if (fileHas(k) && isLoopbackProxy(envFile(k))) {
      notice = `.env sets ${k} to a loopback address, which inside the box is the box itself; set it to the corporate proxy`;
    }
  }
  const shellLoopback = PROXY_KEYS.filter((k) => isLoopbackProxy(env[k]));
  if (!shellLoopback.length) return { set, notice };
  if (PROXY_KEYS.some((k) => fileHas(k) && !isLoopbackProxy(envFile(k)))) {
    for (const k of PROXY_KEYS) set[k] = undefined;
    // The local proxy's NO_PROXY (loopback, the direct list, or '*') is not the box's.
    if (fileHas('NO_PROXY')) set.NO_PROXY = undefined;
    else if (env.NO_PROXY !== undefined) set.NO_PROXY = DEFAULT_NO_PROXY;
    return { set, notice };
  }
  for (const k of PROXY_KEYS) set[k] = '';
  let np = {};
  try { const v = settings()?.networkProxy; if (v && typeof v === 'object') np = v; } catch { /* no settings */ }
  let saved = null;
  try { saved = login(); } catch { /* unreadable: treated as none */ }
  const off = np.enabled === false;               // a proxy the user turned off is never passed in
  const up = !off && typeof np.upstream === 'string' && np.upstream.trim() ? resolveUpstream({ env: {}, settings: np, login: saved }) : null;
  const needsLogin = up && !up.error && (up.auth !== 'none' || (up.requestedAuth && up.requestedAuth !== 'none'));
  if (up && !up.error && !needsLogin) {
    const url = `http://${upstreamLabel(up.host, up.port)}`;
    for (const k of PROXY_KEYS) set[k] = url;
    const direct = Array.isArray(np.noProxy) ? np.noProxy.join(',') : (typeof np.noProxy === 'string' ? np.noProxy : '');
    if (fileHas('NO_PROXY')) set.NO_PROXY = undefined;
    else if (direct) set.NO_PROXY = `${DEFAULT_NO_PROXY},${direct}`;
    else if (env.NO_PROXY !== undefined) set.NO_PROXY = DEFAULT_NO_PROXY;
    return { set, notice: `the box uses the corporate proxy ${upstreamLabel(up.host, up.port)} (this shell's ${shellLoopback[0]} is Worca's local proxy, which the box cannot reach)` };
  }
  if (fileHas('NO_PROXY')) set.NO_PROXY = undefined;
  else if (env.NO_PROXY !== undefined) set.NO_PROXY = DEFAULT_NO_PROXY;
  // The egress sidecar (compose.proxy.yml) can log in to it: cmdContainer hands it this host and port.
  const loginUpstream = needsLogin ? `http://${upstreamLabel(up.host, up.port)}` : undefined;
  const why = needsLogin ? `the corporate proxy ${upstreamLabel(up.host, up.port)} needs a login`
    : off ? 'the network proxy is off in settings.json' : 'no corporate proxy is configured in settings.json';
  return { set, ...(loginUpstream ? { loginUpstream } : {}), notice: `the box gets no proxy: this shell's ${shellLoopback[0]} is Worca's local proxy, which the box cannot reach, and ${why}. `
    + 'Set HTTPS_PROXY in the container .env, or configure the proxy in the box\'s own Worca (its Settings › Network proxy, then `worca container run -- proxy login`)' };
}

/** The corporate CA file to mount into the box: WORCA_CA_CERT (.env, then shell), else the
 *  shell's NODE_EXTRA_CA_CERTS or SSL_CERT_FILE. `{ file, source }`, `{ missing, source }`, or null.
 *  A relative .env path is relative to the container dir, as compose resolves it. */
export function boxCaCert({ env = process.env, envFile = () => '', dir = '.', exists = existsSync } = {}) {
  const pick = [['.env WORCA_CA_CERT', envFile('WORCA_CA_CERT')], ['WORCA_CA_CERT', env.WORCA_CA_CERT],
    ['NODE_EXTRA_CA_CERTS', env.NODE_EXTRA_CA_CERTS], ['SSL_CERT_FILE', env.SSL_CERT_FILE]].find(([, v]) => v && String(v).trim());
  if (!pick) return null;
  const file = pick[0].startsWith('.env') ? resolve(dir, String(pick[1]).trim()) : resolve(String(pick[1]).trim());
  return exists(file) ? { file, source: pick[0] } : { missing: file, source: pick[0] };
}

/** True when a proxy URL carries a user name (a Basic or Digest login in .env HTTPS_PROXY). */
const urlHasLogin = (v) => { try { const s = String(v || '').trim(); return !!s && !!new URL(s.includes('://') ? s : `http://${s}`).username; } catch { return false; } };

/**
 * Why the egress sidecar is needed, or null: a login was set up for it before (`state.sidecar`), .env's proxy URL
 * carries a login, or this machine's networkProxy.upstream needs one (`loginUpstream` from boxProxyEnv).
 */
export function sidecarReason({ state = {}, envFile = () => '', loginUpstream } = {}) {
  if (state.sidecar === true) return 'a proxy login was set up for the egress sidecar';
  const k = PROXY_KEYS.find((x) => urlHasLogin(envFile(x)));
  if (k) return `${k} in .env carries a login, which only the egress sidecar gets`;
  if (loginUpstream) return `the corporate proxy ${loginUpstream.replace(/^http:\/\//, '')} needs a login`;
  return null;
}

/** Make sure .env holds WORCA_EGRESS_SECRET (32 random bytes, base64url), keeping the file 0600. @returns {boolean} added */
export function ensureEgressSecret(dir, { random = () => randomBytes(32).toString('base64url') } = {}) {
  if (readEnvValue(dir, 'WORCA_EGRESS_SECRET')) return false;
  const file = join(dir, '.env');
  appendFileSync(file, `\n# The egress sidecar's shared secret (compose.proxy.yml), written by worca container.\nWORCA_EGRESS_SECRET=${random()}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows */ }
  return true;
}

/**
 * Refuse compose files that need the sidecar with an image that does not have it (the compose files ship with the
 * npm package, the image tag is pinned separately). Inspects the egress service's image label, pulling it once
 * when it is not there yet. @returns {{ok: true} | {error: string}}
 */
export function checkSidecarImage({ exec, bin, cwd, env, files }) {
  let image = `ghcr.io/worca-org/worca:${env.WORCA_TAG || readEnvValue(cwd, 'WORCA_TAG') || 'latest'}`;
  const cfg = exec(bin, ['compose', ...files, 'config', '--format', 'json'], { cwd, env, capture: true });
  if (cfg.status === 0) { try { image = JSON.parse(cfg.stdout).services.egress.image || image; } catch { /* the default above */ } }
  const inspect = () => exec(bin, ['image', 'inspect', '--format', `{{ index .Config.Labels "${SIDECAR_LABEL}" }}`, image], { capture: true });
  let r = inspect();
  if (r.status !== 0) {
    exec(bin, ['compose', ...files, 'pull', 'egress'], { cwd, env, capture: true });
    r = inspect();
  }
  if (r.status !== 0) return { error: `cannot check the image ${image}: it is not on this machine and could not be pulled. The egress sidecar needs it; nothing was started.` };
  const v = Number(String(r.stdout || '').trim());
  if (!Number.isInteger(v) || v < SIDECAR_API_NEEDED) {
    return { error: `the image ${image} is older than these compose files: it has no egress sidecar for the proxy login. Use a newer image (WORCA_TAG in .env, then worca container pull); nothing was started.` };
  }
  return { ok: true };
}

/**
 * `worca container <verb> …`. Returns the process exit code.
 * @param {string[]} argv          tokens after `container`
 * @param {object} io              { out, c, fail } from the CLI; `exec` and `dir` are injectable for tests
 */
export async function cmdContainer(argv, { out, c, fail, exec = defaultExec, dir: dirOverride = null, env: hostEnv = process.env,
  settings = readSettings, login = readProxyLogin, stdin = process.stdin, aliasesOf = maskAliases } = {}) {
  if (argv[0] === 'build') return (await import('./container-build.mjs')).cmdContainerBuild(argv.slice(1), { out, c, fail, exec, dir: dirOverride, env: hostEnv });
  const a = parse(argv);
  if (a.verb === 'help' || a.verb === '--help' || a.verb === '-h') { out(`${CONTAINER_HELP}${HARDENED_HELP}`.trimEnd()); return 0; }
  const dir = resolve(a.dir || dirOverride || join(worcaHome(), 'container'));
  if (a.verb === 'where') { out(dir); return 0; }

  const rt = detectRuntime(exec, a.runtime);
  if (rt.error) { fail(rt.error); return 1; }
  const state = readState(dir);
  // The hardened box (container-hardened.mjs): its own fixed overlays, remembered by `up --hardened`.
  const box = selectBox(a.box, state);
  let overlays = box === 'hardened' ? [...HARDENED_OVERLAYS] : Array.isArray(state.with) ? state.with : [];
  // `up --project` (container-mounts.mjs) narrows the PLAIN box to one host folder. The hardened box mounts no host
  // folder at all (its projects are cloned into its volume), so a remembered project never applies to it.
  const plainProject = typeof state.project === 'string' && state.project ? state.project : null;
  let project = box === 'hardened' ? null : plainProject;
  const mountFile = () => !!project && existsSync(join(dir, MOUNT_FILE));
  // Every compose call interpolates the same env (shell before .env), so the proxy and CA
  // fixes apply to up, run, login and shell alike. Resolved after init so a fresh .env counts.
  let composeEnv;   // unset until prepare(): down, status, logs and pull inherit the shell
  let extra = [];
  let sidecar = null;   // why the egress sidecar runs, or null
  const prepare = () => {
    const envFile = (k) => readEnvValue(dir, k);
    const proxy = boxProxyEnv({ env: hostEnv, envFile, settings, login });
    sidecar = sidecarReason({ state: readState(dir), envFile, loginUpstream: proxy.loginUpstream });
    if (sidecar) {
      // The box gets http://egress:3128 from compose.proxy.yml; HTTPS_PROXY here reaches only the sidecar.
      if (proxy.loginUpstream) { proxy.set.HTTPS_PROXY = proxy.loginUpstream; proxy.set.HTTP_PROXY = proxy.loginUpstream; }
      out(`${c('yellow', 'proxy')}  the egress sidecar holds the proxy login (${sidecar}); the box never does. Log in: worca container proxy login`);
    } else if (proxy.notice) out(`${c('yellow', 'proxy')}  ${proxy.notice}`);
    const ca = boxCaCert({ env: hostEnv, envFile, dir });
    const caEnv = {};
    // From .env: unset the shell's, so compose reads the file's own value.
    if (ca?.file) { extra = ['ca']; caEnv.WORCA_CA_CERT = ca.source.startsWith('.env') ? undefined : ca.file; }
    else if (ca?.missing) out(`${c('yellow', 'ca')}  ${ca.source} names ${ca.missing}, which does not exist; the box gets no corporate CA`);
    const sideEnv = {};
    if (sidecar && !overlays.includes('proxy')) extra.push('proxy');
    if (sidecar || overlays.includes('proxy')) {
      if (ensureEgressSecret(dir)) out(`${c('green', 'proxy')}  wrote WORCA_EGRESS_SECRET into ${join(dir, '.env')}`);
      // From .env: compose reads the file's own value (a shell export would win otherwise).
      sideEnv.WORCA_EGRESS_SECRET = undefined;
      // compose.broker.yml: the broker's provider calls go through the sidecar, which logs in.
      if (!envFile('WORCA_BROKER_PROXY')) sideEnv.WORCA_BROKER_PROXY = SIDECAR_PROXY_URL;
    }
    const img = boxImageForCompose({ dir, envFile });   // WORCA_IMAGE in .env: the image `worca container build` made
    if (img.overlay) extra.push('image');
    if (img.notice) out(`${c('yellow', 'image')}  ${img.notice}`);
    composeEnv = Object.fromEntries(Object.entries({ ...hostEnv, ...proxy.set, ...caEnv, ...sideEnv }).filter(([, v]) => v !== undefined));
    if (a.tag) composeEnv.WORCA_TAG = a.tag;
  };
  // compose.proxy.yml goes last among the overlays: it takes over the egress service compose.egress.yml defines.
  // The generated project mount (`mount`) goes after it, so its masks land on top of every bind.
  const ordered = () => { const all = [...new Set([...overlays, ...extra])]; return [...all.filter((o) => o !== 'proxy'), ...(all.includes('proxy') ? ['proxy'] : [])]; };
  // A project-scoped box is its own compose project (boxName: own containers and volumes) and binds only `p`, at the
  // same path (compose.yml builds its bind from both variables), on every verb: `run`, `login` and `shell` start
  // one-off containers that must not see the whole tree either.
  const nameArgs = (p) => (p ? ['-p', boxName(p)] : []);
  const envFor = (p) => (p ? { ...(composeEnv || hostEnv), WORCA_PROJECTS: p, WORCA_PROJECTS_MOUNT: p } : composeEnv);
  const files = ({ mount = mountFile() } = {}) => [...nameArgs(project), ...composeFileArgs(ordered(), { project: mount })];
  const needsSidecar = () => !!sidecar || overlays.includes('proxy');
  const imageOk = () => {
    if (!needsSidecar()) return true;
    const r = checkSidecarImage({ exec, bin: rt.bin, cwd: dir, env: envFor(project), files: files() });
    if (r.error) { fail(r.error); return false; }
    return true;
  };
  const compose = (args, opts = {}) => exec(rt.bin, ['compose', ...files(), ...args], { cwd: dir, env: envFor(project), ...opts }).status;

  if (a.verb === 'init' || a.verb === 'up') {
    const r = await initDir(dir, { projects: a.projects, exec });
    out(`${c('bold', 'container dir')}  ${dir}${r.envCreated ? `   (${c('green', '.env created')} — edit it: WORCA_PROJECTS, tokens)` : ''}`);
    if (box === 'hardened') {
      if (a.project !== null || a.noProject) {
        fail('--project and --no-project are for the plain container: the hardened box mounts no host folder (its projects are cloned into its volume)');
        return 2;
      }
      // hardenedBefore checks the plain box (compose project `worca`); a project-scoped plain box has its own name.
      if (a.verb === 'up' && plainProject && runningProject({ exec, bin: rt.bin, project: boxName(plainProject) })) {
        fail(`the plain container for ${plainProject} is running and holds the same port: stop it first with worca container down --plain`);
        return 1;
      }
      const code = await hardenedBefore({ a, dir, exec, bin: rt.bin, out, c, fail, env: hostEnv, settings, login, stdin, state, writeState: (s) => writeState(dir, s) });
      if (code !== null) return code;
    } else if (a.box === 'plain' && state.hardened) writeState(dir, { ...readState(dir), hardened: false });
    if (a.verb === 'init') return 0;
  }
  if (!existsSync(join(dir, 'compose.yml'))) { fail(`no compose files in ${dir}; run: worca container init`); return 1; }
  if (project && !mountFile() && ['login', 'shell', 'run'].includes(a.verb)) {
    fail(`the project mount for ${project} is missing; run: worca container up`);
    return 1;
  }
  // A login set up for the sidecar is remembered, so every later verb (down included) keeps its overlay.
  const proxyLoginVerb = (a.verb === 'proxy' && a._[0] === 'login') || (a.verb === 'run' && a.passthrough[0] === 'proxy' && a.passthrough[1] === 'login');
  if (proxyLoginVerb && readState(dir).sidecar !== true) writeState(dir, { ...readState(dir), sidecar: true });
  if (!['down', 'status', 'logs', 'pull'].includes(a.verb)) prepare();
  else if (readState(dir).sidecar === true && !overlays.includes('proxy')) extra = ['proxy'];
  const hb = () => ({ a, dir, exec, bin: rt.bin, composeEnv, files: files(), out, c, fail, stdin, state: readState(dir),
    login: (args) => cmdContainer(['proxy', 'login', ...args], { out, c, fail, exec, dir, env: hostEnv, settings, login, stdin }) });

  switch (a.verb) {
    case 'up': {
      if (box === 'plain' && runningProject({ exec, bin: rt.bin, project: HARDENED_PROJECT })) { fail('the hardened box is running and holds the same port: stop it first with worca container down --hardened'); return 1; }
      const before = { project, overlays };
      if (a.with !== null && box === 'plain') {
        const parsed = parseWith(a.with);
        if (parsed.error) { fail(parsed.error); return 1; }
        overlays = parsed;
      }
      // The project-scoped box is the plain container only (the hardened box refused --project above).
      if (box === 'plain') {
        if (a.project !== null && a.noProject) { fail('--project and --no-project cannot go together'); return 1; }
        if (a.noProject) project = null;
        else if (a.project !== null || project) {
          // A remembered project is checked again: compose would create a missing bind source as an empty folder.
          const r = resolveProjectDir(a.project ?? project, { worcaHomeDir: worcaHome() });
          if (r.error) { fail(a.project !== null ? r.error : `${r.error} (remembered from an earlier up: pass --project <dir> or --no-project)`); return 1; }
          project = r.dir;
        }
        if (project && overlays.includes('clonein')) {
          fail('--project mounts a host folder and clone-in mounts none: use one of them (--no-project, or --with without clonein)');
          return 1;
        }
        let plan = null;
        if (project) {
          plan = await planProjectMasks(project, maskSettingsFor(project));
          if (plan.masks.length > MAX_MASKS) {
            fail(`--project: ${plan.masks.length} secret files to mask (the limit is ${MAX_MASKS}); leave some unmasked with the project's secretPathsUnmask setting, or move them out of ${project}`);
            return 1;
          }
          const aliased = aliasesOf(project, plan.masks);
          if (aliased.length) { fail(maskAliasRefusal(project, aliased)); return 1; }
          for (const line of maskLines({ projectDir: project, ...plan })) out(line.level === 'warn' ? c('yellow', line.text) : line.text);
        } else if (!overlays.includes('clonein')) {
          out(c('yellow', `projects  ${readEnvValue(dir, 'WORCA_PROJECTS') || '$HOME/dev'}   the whole folder is mounted, unmasked: every project in it and its secret files are readable in the box (narrow it: --project <dir>)`));
        }
        if (before.project !== project) {
          // Another box (boxName): stop the one this dir ran before, or it keeps its own mounts and holds the port.
          // `down` keeps its volumes; `up --project <it>` or `--no-project` brings it back.
          out(`stopping the box for ${before.project || 'the whole folder'} first (its volumes are kept)`);
          const stopped = exec(rt.bin, ['compose', ...nameArgs(before.project), ...composeFileArgs(before.overlays), 'down'],
            { cwd: dir, env: envFor(before.project) }).status;
          if (stopped !== 0) { fail(`could not stop the box for ${before.project || 'the whole folder'}; nothing was started`); return stopped; }
        }
        if (project) writeProjectMount(dir, { projectDir: project, masks: plan.masks });
        else removeProjectMount(dir);
        if (a.with !== null || a.project !== null || a.noProject || project !== before.project) writeState(dir, { ...readState(dir), with: overlays, project });
      }
      const port = readEnvValue(dir, 'WORCA_PORT') || '4317';
      if (box === 'hardened') { const code = await hardenedUp(hb()); if (code !== null) return code; }
      if (!imageOk()) return 1;
      const code = compose(['up', '-d']);
      if (code !== 0) return code;
      const shown = [...overlays, ...extra];
      out(`${c('bold', box === 'hardened' ? 'Worca (hardened box)' : 'Worca')}  http://localhost:${port}${shown.length ? `   overlays: ${shown.join(', ')}` : ''}${project ? `   box: ${boxName(project)}` : ''}`);
      if (box === 'hardened') out(`  Posture:      ${c('bold', 'worca container status')}`);
      else out(`  Log in once:  ${c('bold', 'worca container login')}`);
      out(`  Stop:         ${c('bold', 'worca container down')}`);
      return 0;
    }
    case 'down': return compose(['down']);
    case 'status': return box === 'hardened' ? hardenedStatus(hb()) : compose(['ps']);
    case 'logs': return compose(['logs', ...(a.follow ? ['-f'] : []), 'worca']);
    case 'pull': return compose(['pull', 'worca']);
    case 'login':
      if (box === 'hardened') { fail('the hardened box keeps no Claude sign-in: the broker holds the model credential (WORCA_BROKER_KEY_ANTHROPIC in .env)'); return 1; }
      return imageOk() ? compose(['run', '--rm', 'worca', 'claude']) : 1;
    case 'shell': return imageOk() ? compose(['run', '--rm', 'worca', 'bash']) : 1;
    case 'run': {
      const args = a.passthrough.length ? a.passthrough : a._;
      if (!args.length) { fail('Usage: worca container run -- <worca args>'); return 1; }
      if (!imageOk()) return 1;
      return compose(['run', '--rm', 'worca', 'worca', ...args]);
    }
    case 'proxy': {
      const [pverb, ...prest] = a._;
      if (!PROXY_VERBS.has(pverb)) { fail('Usage: worca container proxy login|logout|status|test [--json] [--user DOMAIN\\user]'); return pverb ? 2 : 1; }
      if (!needsSidecar()) { fail('no egress sidecar is set up: log in first with worca container proxy login (or put the corporate proxy in .env HTTPS_PROXY)'); return 1; }
      if (!imageOk()) return 1;
      // The sidecar alone: no box needed to log in.
      const upCode = compose(['up', '-d', '--no-deps', 'egress']);
      if (upCode !== 0) return upCode;
      const json = prest.includes('--json') ? ['--json'] : [];
      if (pverb !== 'login') return compose(['exec', '-T', 'egress', 'worca', 'egress', pverb, ...json]);
      // The password is read here (hidden prompt or stdin) and piped into the sidecar: never an argument, never the box.
      let got;
      try { got = await readLoginInput(prest, { input: stdin, prompt: process.stderr }); } catch (e) {
        fail(e && e.code === 'ABORT_ERR' ? 'cancelled; nothing was saved' : `the login could not be read (${e && e.message ? e.message : 'error'})`);
        return e && e.code === 'ABORT_ERR' ? 130 : 1;
      }
      const account = got.account.domain ? `${got.account.domain}\\${got.account.user}` : got.account.user;
      const code = compose(['exec', '-T', 'egress', 'worca', 'egress', 'login'], { input: `${account}\n${got.password}\n` });
      got.password = '';
      if (code === 0) out('  If the box was started before the sidecar, start it again so it uses the sidecar: worca container up');
      return code;
    }
    default:
      fail(`unknown container verb: ${a.verb}\n\n${CONTAINER_HELP}`);
      return 1;
  }
}
