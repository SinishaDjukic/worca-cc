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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { worcaHome, listProjects } from '../core/projects.mjs';

/** The compose files shipped in the package (package.json `files`). */
export const COMPOSE_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docker');
export const OVERLAYS = Object.freeze(['egress', 'ssh', 'teams', 'clonein']);
const STATE_FILE = '.worca-container.json';

export const CONTAINER_HELP = `worca container — run Worca in a container (docs/docker.md)

  worca container init [--projects <dir>]        Write the compose files and a .env into the container dir
  worca container up [--with <overlays>] [--tag <t>]
                                                 Start the box in the background and print the URL.
                                                 --with: comma-separated egress,ssh,teams,clonein (remembered)
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

Options:
  --dir <d>        Container dir (default: <worcaHome>/container)
  --runtime <r>    docker | podman (default: autodetect; env WORCA_CONTAINER_RUNTIME)

The box has its own Worca home and its own Claude Code login: nothing from
~/.worca-cc or ~/.claude is mounted. Your repositories are mounted at the same
path as on the host (WORCA_PROJECTS in .env), so run worktrees stay valid here.
`;

/** Default exec: run and inherit the terminal. Returns { status }. */
function defaultExec(cmd, args, { cwd, capture = false, env } = {}) {
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
    else if (a === '--with') o.with = rest[++i];
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

/** `-f compose.yml -f compose.<overlay>.yml …` for the remembered or requested overlays. */
export function composeFileArgs(overlays) {
  const args = ['-f', 'compose.yml'];
  for (const o of overlays) args.push('-f', `compose.${o}.yml`);
  return args;
}

function parseWith(s) {
  if (!s) return [];
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
    const git = (k) => { const r = exec('git', ['config', '--get', k], { capture: true }); return r.status === 0 ? r.stdout.trim() : ''; };
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

function readEnvValue(dir, key) {
  try {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(join(dir, '.env'), 'utf8'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/**
 * `worca container <verb> …`. Returns the process exit code.
 * @param {string[]} argv          tokens after `container`
 * @param {object} io              { out, c, fail } from the CLI; `exec` and `dir` are injectable for tests
 */
export async function cmdContainer(argv, { out, c, fail, exec = defaultExec, dir: dirOverride = null } = {}) {
  const a = parse(argv);
  if (a.verb === 'help' || a.verb === '--help' || a.verb === '-h') { out(CONTAINER_HELP.trimEnd()); return 0; }
  const dir = resolve(a.dir || dirOverride || join(worcaHome(), 'container'));
  if (a.verb === 'where') { out(dir); return 0; }

  const rt = detectRuntime(exec, a.runtime);
  if (rt.error) { fail(rt.error); return 1; }
  const state = readState(dir);
  let overlays = Array.isArray(state.with) ? state.with : [];
  const compose = (args, opts = {}) => exec(rt.bin, ['compose', ...composeFileArgs(overlays), ...args], { cwd: dir, ...opts }).status;

  if (a.verb === 'init' || a.verb === 'up') {
    const r = await initDir(dir, { projects: a.projects, exec });
    out(`${c('bold', 'container dir')}  ${dir}${r.envCreated ? `   (${c('green', '.env created')} — edit it: WORCA_PROJECTS, tokens)` : ''}`);
    if (a.verb === 'init') return 0;
  }
  if (!existsSync(join(dir, 'compose.yml'))) { fail(`no compose files in ${dir}; run: worca container init`); return 1; }

  switch (a.verb) {
    case 'up': {
      if (a.with !== null) {
        const parsed = parseWith(a.with);
        if (parsed.error) { fail(parsed.error); return 1; }
        overlays = parsed;
        writeState(dir, { ...state, with: overlays });
      }
      const env = a.tag ? { ...process.env, WORCA_TAG: a.tag } : undefined;
      const port = readEnvValue(dir, 'WORCA_PORT') || '4317';
      const code = exec(rt.bin, ['compose', ...composeFileArgs(overlays), 'up', '-d'], { cwd: dir, env }).status;
      if (code !== 0) return code;
      out(`${c('bold', 'Worca')}  http://localhost:${port}${overlays.length ? `   overlays: ${overlays.join(', ')}` : ''}`);
      out(`  Log in once:  ${c('bold', 'worca container login')}`);
      out(`  Stop:         ${c('bold', 'worca container down')}`);
      return 0;
    }
    case 'down': return compose(['down']);
    case 'status': return compose(['ps']);
    case 'logs': return compose(['logs', ...(a.follow ? ['-f'] : []), 'worca']);
    case 'pull': return compose(['pull', 'worca']);
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
