// src/cli/container.mjs
// `worca container` — run Worca in a container from the npm install
// (docs/docker.md; plans/container-isolation-design.md §12.3). A thin wrapper:
// it writes the package's compose files into <worcaHome>/container/, seeds a
// .env once, and shells out to `docker compose` (or `podman compose`). Nothing
// here talks to the engine; the box runs its own Worca with its own home.
//
// Every verb takes { out, c, fail } from the CLI and an injectable `exec` so
// tests never spawn a runtime.

import { spawnSync } from 'node:child_process';
import { INSTANCE_LABEL } from '../core/executor/shared.mjs';
import { workerImageFor } from '../core/executor/backends/docker.mjs';
/** The published controller image (docker/compose.yml WORCA_IMAGE default); worker images are `<image>-worker`. */
const DEFAULT_IMAGE = 'ghcr.io/sinishadjukic/worca';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { worcaHome, listProjects } from '../core/projects.mjs';
import { gitAvailable } from '../core/git-available.mjs';
import { readSettings } from '../core/settings.mjs';
import { readProxyLogin } from '../core/proxy-credentials.mjs';
import { resolveUpstream, upstreamLabel } from '../core/upstream-proxy.mjs';

/** The compose files shipped in the package (package.json `files`). */
export const COMPOSE_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docker');
export const OVERLAYS = Object.freeze(['egress', 'ssh', 'teams', 'clonein', 'workers', 'broker']);
/** The label every worker container the controller starts carries (src/core/executor/backends/docker.mjs). */
export const WORKER_INSTANCE_LABEL = INSTANCE_LABEL;      // …and which installation it belongs to: the Compose project

/**
 * The installation name the docker backend labels this stack's workers with (docker.mjs): WORCA_INSTANCE_ID when
 * the operator set one (compose.workers.yml hands it to the controller), else the Compose project. Each is read the
 * way Compose reads it: the process environment first, then `.env`; the project falls back to compose.yml's `name: worca`.
 */
export function workerInstanceOf({ dotEnv = () => null, env = {} } = {}) {
  return env.WORCA_INSTANCE_ID || dotEnv('WORCA_INSTANCE_ID') || env.COMPOSE_PROJECT_NAME || dotEnv('COMPOSE_PROJECT_NAME') || 'worca';
}

/**
 * A `docker images` reference pattern for this stack's worker images, any engine: from WORCA_WORKER_IMAGE when it
 * has the `{engine}` placeholder, else the default `<WORCA_IMAGE>-worker:<WORCA_TAG>-*`. null when workers run from
 * one fixed image (`self`, or a pattern without the placeholder): there is nothing per engine to refresh.
 */
export function workerImageGlob({ dotEnv = () => null, env = {} } = {}) {
  const read = (name) => env[name] || dotEnv(name) || null;
  const pattern = read('WORCA_WORKER_IMAGE');
  if (pattern && (pattern === 'self' || !pattern.includes('{engine}'))) return null;   // one fixed image: nothing per engine to refresh
  const image = read('WORCA_IMAGE') || DEFAULT_IMAGE;
  const tag = read('WORCA_TAG') || 'latest';
  // The backend's own rule (executor/backends/docker.mjs workerImageFor), with `*` for the engine: `-full` is a
  // variant only some engines have, so the glob covers every engine's slim and full image alike.
  return workerImageFor('*', { pattern, controllerImage: `${image}:${tag}`, fullEngines: [] });   // `<tag>-*` covers `-codex` and `-claude-full` alike
}
/** Compose variables an overlay COMBINATION needs. With the egress allowlist on, the controller shares the
 *  internal network with its workers, never the open default one (compose.workers.yml WORCA_UPLINK_NETWORK). */
export function overlayEnv(overlays = [], { already = null } = {}) {
  const both = overlays.includes('egress') && (overlays.includes('workers') || overlays.includes('broker'));   // either names the uplink network
  if (both) return String(already || '').trim() === 'internal' ? {} : { WORCA_UPLINK_NETWORK: 'internal' };   // any other persisted value would leave the controller on the open network
  // Only the egress overlay defines the `internal` network: a value kept in .env from an earlier `--with egress,workers`
  // would stop a start without egress ("refers to undefined network internal"). The shell value wins for this start.
  return (overlays.includes('workers') || overlays.includes('broker')) && String(already || '').trim() === 'internal' ? { WORCA_UPLINK_NETWORK: 'default', notice: 'WORCA_UPLINK_NETWORK=internal in .env needs the egress overlay; this start uses the default network' } : {};
}
const STATE_FILE = '.worca-container.json';
/** The proxy variables compose.yml interpolates into the box (case-sensitive: compose reads these names only). */
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY'];
/** compose.yml's own NO_PROXY default. */
const DEFAULT_NO_PROXY = '127.0.0.1,localhost';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export const CONTAINER_HELP = `worca container — run Worca in a container (docs/docker.md)

  worca container init [--projects <dir>]        Write the compose files and a .env into the container dir
  worca container up [--with <overlays>] [--tag <t>]
                                                 Start the box in the background and print the URL.
                                                 --with: comma-separated egress,ssh,teams,clonein,workers,broker (remembered)
                                                 --tag: the image tag, e.g. local (remembered, like --with)
                                                 workers: agents in their own containers (docs/workers.md)
  worca container down                           Stop and remove the containers (volumes are kept)
  worca container status                         Which containers are up
  worca container logs [--follow]                Server logs
  worca container pull                           Pull the newest image for the tag in .env
  worca container login                          Log Claude Code in, once, into the box's own volume
  worca container shell                          A bash shell inside the box
  worca container run -- <worca args>            Run the Worca CLI inside the box
                                                 e.g. worca container run -- --project /path/to/repo --prompt "…"
  worca container where                          Print the container dir (compose files, .env)
  worca container help

A corporate CA (PEM) is mounted into the box when WORCA_CA_CERT is set in .env,
else from the shell's NODE_EXTRA_CA_CERTS or SSL_CERT_FILE. A proxy on this
machine's loopback (Worca's own local proxy) is never passed in; see docs/docker.md.

Options:
  --dir <d>        Container dir (default: <worcaHome>/container)
  --runtime <r>    docker | podman (default: autodetect; env WORCA_CONTAINER_RUNTIME)

The box has its own Worca home and its own Claude Code login: nothing from
~/.worca-cc or ~/.claude is mounted. Your repositories are mounted at the same
path as on the host (WORCA_PROJECTS in .env), so run worktrees stay valid here.
`;

/** Default exec: run and inherit the terminal. Returns { status }. */
export function defaultExec(cmd, args, { cwd, capture = false, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
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
  const o = { verb: argv[0] || 'help', dir: null, runtime: null, projects: null, with: null, tag: null, follow: false, passthrough: [], _: [] };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { o.passthrough = rest.slice(i + 1); break; }
    else if (a === '--dir') o.dir = rest[++i];
    else if (a === '--runtime') o.runtime = rest[++i];
    else if (a === '--projects') o.projects = rest[++i];
    else if (a === '--with') o.with = rest[++i] ?? '';   // no value: an error below, never 'forget every overlay'
    else if (a === '--tag') o.tag = rest[++i];
    else if (a === '--follow' || a === '-f') o.follow = true;
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

/** `-f compose.yml -f compose.<overlay>.yml …` for the remembered or requested overlays, in ONE order (OVERLAYS, not
 *  the order typed): a later file's values win in compose, and the overlays are written for this order (the egress
 *  overlay's NO_PROXY, for one, must come before the workers overlay's). An unknown name keeps its typed position. */
export function composeFileArgs(overlays) {
  const rank = (o) => { const i = OVERLAYS.indexOf(o); return i < 0 ? OVERLAYS.length : i; };
  const args = ['-f', 'compose.yml'];
  for (const o of [...overlays].sort((a, b) => rank(a) - rank(b))) args.push('-f', `compose.${o}.yml`);
  return args;
}

function parseWith(s) {
  if (!s) return { error: `--with needs a comma-separated list of overlays (known: ${OVERLAYS.join(', ')}); to run with none, start without --with and remove the remembered ones from ${STATE_FILE}` };
  const list = s.split(',').map((x) => x.trim()).filter(Boolean);
  const bad = list.filter((x) => !OVERLAYS.includes(x));
  if (bad.length) return { error: `--with: unknown overlay ${bad.join(', ')} (known: ${OVERLAYS.join(', ')})` };
  return [...new Set(list)];
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
    const git = (k) => { if (!gitAvailable()) return ''; const r = exec('git', ['config', '--get', k], { capture: true }); return r.status === 0 ? r.stdout.trim() : ''; };
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
  const why = needsLogin ? `the corporate proxy ${upstreamLabel(up.host, up.port)} needs a login`
    : off ? 'the network proxy is off in settings.json' : 'no corporate proxy is configured in settings.json';
  return { set, notice: `the box gets no proxy: this shell's ${shellLoopback[0]} is Worca's local proxy, which the box cannot reach, and ${why}. `
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

/**
 * `worca container <verb> …`. Returns the process exit code.
 * @param {string[]} argv          tokens after `container`
 * @param {object} io              { out, c, fail } from the CLI; `exec` and `dir` are injectable for tests
 */
export async function cmdContainer(argv, { out, c, fail, exec = defaultExec, dir: dirOverride = null, env: hostEnv = process.env,
  settings = readSettings, login = readProxyLogin } = {}) {
  const a = parse(argv);
  if (a.verb === 'help' || a.verb === '--help' || a.verb === '-h') { out(CONTAINER_HELP.trimEnd()); return 0; }
  const dir = resolve(a.dir || dirOverride || join(worcaHome(), 'container'));
  if (a.verb === 'where') { out(dir); return 0; }

  const rt = detectRuntime(exec, a.runtime);
  if (rt.error) { fail(rt.error); return 1; }
  const state = readState(dir);
  let overlays = Array.isArray(state.with) ? state.with : [];
  // The tag `up --tag` named is remembered with the overlays: login, pull, status and down must resolve the SAME image
  // (a `--tag local` stack whose `login` pulls `:latest` fails on a tag that was never pulled or built).
  const tag = (typeof a.tag === 'string' && a.tag.trim()) ? a.tag.trim() : (typeof state.tag === 'string' && state.tag.trim() ? state.tag.trim() : null);
  // Every compose call interpolates the same env (shell before .env), so the proxy and CA
  // fixes apply to up, run, login and shell alike. Resolved after init so a fresh .env counts.
  let composeEnv;
  let extra = [];
  const prepare = () => {
    const envFile = (k) => readEnvValue(dir, k);
    const proxy = boxProxyEnv({ env: hostEnv, envFile, settings, login });
    if (proxy.notice) out(`${c('yellow', 'proxy')}  ${proxy.notice}`);
    const ca = boxCaCert({ env: hostEnv, envFile, dir });
    const caEnv = {};
    // From .env: unset the shell's, so compose reads the file's own value.
    if (ca?.file) { extra = ['ca']; caEnv.WORCA_CA_CERT = ca.source.startsWith('.env') ? undefined : ca.file; }
    else if (ca?.missing) out(`${c('yellow', 'ca')}  ${ca.source} names ${ca.missing}, which does not exist; the box gets no corporate CA`);
    composeEnv = Object.fromEntries(Object.entries({ ...hostEnv, ...proxy.set, ...caEnv }).filter(([, v]) => v !== undefined));
  };
  const noticed = new Set();
  const files = () => composeFileArgs([...overlays, ...extra]);
  const compose = (args, opts = {}) => {
    const { notice, ...more } = overlayEnv([...overlays, ...extra], { already: readEnvValue(dir, 'WORCA_UPLINK_NETWORK') || (composeEnv ?? process.env).WORCA_UPLINK_NETWORK });
    if (notice && !noticed.has(notice)) { noticed.add(notice); out(`${c('yellow', 'network')}  ${notice}`); }
    const set = { ...(tag ? { WORCA_TAG: tag } : {}), ...more };
    const env = Object.keys(set).length ? { ...(composeEnv ?? process.env), ...set } : composeEnv;
    return exec(rt.bin, ['compose', ...files(), ...args], { cwd: dir, env, ...opts }).status;
  };

  if (a.verb === 'init' || a.verb === 'up') {
    const r = await initDir(dir, { projects: a.projects, exec });
    out(`${c('bold', 'container dir')}  ${dir}${r.envCreated ? `   (${c('green', '.env created')} — edit it: WORCA_PROJECTS, tokens)` : ''}`);
    if (a.verb === 'init') return 0;
  }
  if (!existsSync(join(dir, 'compose.yml'))) { fail(`no compose files in ${dir}; run: worca container init`); return 1; }
  if (!['down', 'status', 'logs', 'pull'].includes(a.verb)) prepare();

  switch (a.verb) {
    case 'up': {
      if (a.with !== null) {
        const parsed = parseWith(a.with);
        if (parsed.error) { fail(parsed.error); return 1; }
        overlays = parsed;
      }
      if (a.with !== null || (tag && tag !== state.tag)) writeState(dir, { ...state, with: overlays, ...(tag ? { tag } : {}) });
      const port = readEnvValue(dir, 'WORCA_PORT') || '4317';
      const code = compose(['up', '-d']);
      if (code !== 0) return code;
      const shown = [...overlays, ...extra];
      out(`${c('bold', 'Worca')}  http://localhost:${port}${shown.length ? `   overlays: ${shown.join(', ')}` : ''}`);
      out(`  Log in once:  ${c('bold', 'worca container login')}`);
      out(`  Stop:         ${c('bold', 'worca container down')}`);
      return 0;
    }
    case 'down': {
      // Worker containers (compose.workers.yml) are started by the controller, not by compose, so `down` does not
      // know them — and while one is still attached, compose cannot remove the project network. So: stop the stack
      // first (the controller drains and tells its workers to leave), remove any worker still around by its label,
      // then take the stack down. Only this installation's workers: another worca stack on the host keeps its own.
      compose(['stop']);
      const instance = workerInstanceOf({ dotEnv: (name) => readEnvValue(dir, name), env: composeEnv ?? hostEnv });
      const ps = exec(rt.bin, ['ps', '-aq', '--filter', `label=${WORKER_INSTANCE_LABEL}=${instance}`], { cwd: dir, env: composeEnv, capture: true });
      const ids = String(ps.stdout || '').split(/\s+/).filter(Boolean);
      if (ids.length) {
        exec(rt.bin, ['rm', '-f', ...ids], { cwd: dir, env: composeEnv, capture: true });
        out(`removed ${ids.length} worker container(s)`);
      }
      return compose(['down']);
    }
    case 'status': return compose(['ps']);
    case 'logs': return compose(['logs', ...(a.follow ? ['-f'] : []), 'worca']);
    case 'pull': {
      const code = compose(['pull', 'worca']);
      // Worker images are started by the controller, not by compose, so `compose pull` does not know them: a stale
      // one under a moving tag would run against the new controller. Every worker image of this tag that is here
      // is pulled too.
      const glob = workerImageGlob({ dotEnv: (name) => readEnvValue(dir, name), env: { ...(composeEnv ?? hostEnv), ...(tag ? { WORCA_TAG: tag } : {}) } });
      if (overlays.includes('workers') && glob) {
        const ls = exec(rt.bin, ['images', '--format', '{{.Repository}}:{{.Tag}}', '--filter', `reference=${glob}`], { cwd: dir, env: composeEnv, capture: true });
        const images = [...new Set(String(ls.stdout || '').split(/\s+/).filter((i) => i && !i.endsWith(':<none>')))];
        if (!images.length) out(`no worker image here yet: pull the one for your engine, e.g. ${glob.replace('*', 'claude')}`);
        for (const image of images) exec(rt.bin, ['pull', image], { cwd: dir, env: composeEnv });
      }
      return code;
    }
    case 'login': return compose(['run', '--rm', 'worca', 'claude']);
    case 'shell': return compose(['run', '--rm', 'worca', 'bash']);
    case 'run': {
      const args = a.passthrough.length ? a.passthrough : a._;
      if (!args.length) { fail('Usage: worca container run -- <worca args>'); return 1; }
      return compose(['run', '--rm', 'worca', 'worca', ...args]);
    }
    default:
      fail(`unknown container verb: ${a.verb}\n\n${CONTAINER_HELP}`);
      return 1;
  }
}
