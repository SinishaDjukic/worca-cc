// src/cli/container-build.mjs
// `worca container build` — the box image from the projects' environment specs (docs/environment-spec.md,
// "Building the box image"). FROM the operator's base (WORCA_BASE_IMAGE in the container .env, else the image of
// WORCA_TAG), plus the union of the specs. A finished image is checked for what Worca needs before the box is
// pointed at it (WORCA_IMAGE in .env, which adds compose.image.yml); a failed build or check changes nothing.
// Every runtime call goes through the injectable `exec`, so tests never need Docker.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { worcaHome, listProjects } from '../core/projects.mjs';
import { readProjectExecEnv } from '../core/config.mjs';
import { detectRuntime, dotenvValue, isLoopbackProxy } from './container.mjs';
import { keyOf } from './exec-env.mjs';
import {
  BUILD_DIR, PROBE_SCRIPT, boxBaseImage, boxImageState, boxImageTag, checkBoxProbe, parseBoxProbe, parseLabels,
  readBoxImageRecord, renderBoxDockerfile, unionSpecs, writeBoxImageRecord, writeEnvValue, currentSpecHash,
} from '../core/exec-env/box-image.mjs';

export const CONTAINER_BUILD_HELP = `worca container build — the box image from the projects' environment specs
(docs/environment-spec.md, "Building the box image")

  worca container build [--project <key|dir>]...  Build it and point the box at it (default: every project with a spec)
  worca container build --status [--json]         Is the image in use current or stale?
  worca container build --dry-run                 Print the Dockerfile; build nothing
  worca container build --reset                   Go back to the plain image (removes WORCA_IMAGE from .env)

Options:
  --dir <d>        Container dir (default: <worcaHome>/container)
  --runtime <r>    docker | podman (default: autodetect; env WORCA_CONTAINER_RUNTIME)

The build starts from WORCA_BASE_IMAGE in the container .env (default: the image of WORCA_TAG). Nothing rebuilds by
itself: a stale image is still used, with a warning. Restart the box on a new image with: worca container up
`;

function defaultExec(cmd, args, { cwd, capture = false, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.error ? 127 : (r.status ?? 1), stdout: r.stdout || '', stderr: r.stderr || '' };
}

function parse(argv) {
  const o = { projects: [], status: false, json: false, dryRun: false, reset: false, dir: null, runtime: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '--dir' || a === '--runtime') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--project') o.projects.push(v); else o[a.slice(2)] = v;
    } else if (a === '--status') o.status = true;
    else if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--reset') o.reset = true;
    else if (a === 'help' || a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (see: worca container build --help)`);
  }
  if ([o.status, o.dryRun, o.reset].filter(Boolean).length > 1) throw new Error('--status, --dry-run and --reset exclude each other');
  if (o.json && !o.status) throw new Error('--json goes with --status');
  if (o.projects.length && (o.status || o.reset)) throw new Error('--project goes with a build or --dry-run');
  return o;
}

const envReader = (dir) => {
  let body = '';
  try { body = readFileSync(join(dir, '.env'), 'utf8'); } catch { /* no .env: every value unset */ }
  return (key) => {
    const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`, 'm').exec(body);
    return m ? dotenvValue(m[1]) : '';
  };
};

/** The projects to build for, each with its stored spec: the named ones, else every project with a spec. */
async function pickProjects(names) {
  const all = await listProjects();
  const nameOf = new Map(all.map((p) => [p.key, p.name]));
  if (names.length) {
    const out = [];
    for (const n of names) {
      const key = await keyOf(n);
      if (out.some((p) => p.key === key)) continue;
      const spec = readProjectExecEnv(key).spec;
      if (!spec) throw new Error(`project ${nameOf.get(key) || key} has no environment spec (set one: worca exec-env spec --project ${key} --set <file.json>)`);
      out.push({ key, name: nameOf.get(key) || '', spec });
    }
    return out;
  }
  const out = [];
  for (const p of all) {
    let spec = null;
    try { spec = readProjectExecEnv(p.key).spec; } catch { spec = null; }
    if (spec) out.push({ key: p.key, name: p.name || '', spec });
  }
  if (!out.length) throw new Error('no project has an environment spec (set one: worca exec-env spec --project <key|dir> --set <file.json>)');
  return out;
}

async function projectsWithSpec() {
  const out = [];
  for (const p of await listProjects()) {
    try { if (readProjectExecEnv(p.key).spec) out.push({ key: p.key, name: p.name || '' }); } catch { /* skip */ }
  }
  return out;
}

/** True when a proxy value carries a login (`user:pass@host`, with or without a scheme). Any `@` counts, and so does
 *  an unparsable value: neither is passed on. */
function proxyHasLogin(v) {
  const s = String(v).trim();
  if (s.includes('@')) return true;
  try { const u = new URL(s.includes('://') ? s : `http://${s}`); return Boolean(u.username || u.password); } catch { return true; }
}

/** The proxy for the build's own downloads (apt, mise, the tools), from the container .env: never a loopback one, and
 *  never one whose URL carries a login. Third-party install scripts run in the build, and a build argument also stays
 *  in the image's history. */
function proxyBuildArgs(envFile, out, c) {
  const args = [];
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
    const v = envFile(k);
    if (!v) continue;
    if (k !== 'NO_PROXY' && isLoopbackProxy(v)) { out(`${c('yellow', 'proxy')}  .env sets ${k} to a loopback address; the build does not use it`); continue; }
    if (k !== 'NO_PROXY' && proxyHasLogin(v)) { out(`${c('yellow', 'proxy')}  .env sets ${k} with a login; the build does not use it. Set the proxy in Docker's own settings for builds.`); continue; }
    args.push('--build-arg', `${k}=${v}`);
  }
  return args;
}

function describeState(st, record, base) {
  const lines = [];
  if (st.state === 'none') lines.push(`no built image in use: the box runs ${base}`);
  else if (st.state === 'detached') lines.push(`the box runs ${st.image}`);
  else {
    lines.push(`${st.state === 'current' ? 'current' : 'stale'}: ${st.image}, built ${record.builtAt} from ${record.base}`);
    for (const p of record.projects ?? []) lines.push(`  project ${p.name ? `${p.name} (${p.key})` : p.key}  ${p.specHash}`);
    if (st.state === 'stale') lines.push('It is still used. Rebuild: worca container build');
  }
  for (const r of st.reasons) lines.push(`  - ${r}`);
  for (const n of st.notes) lines.push(`  note: ${n}`);
  return lines.join('\n');
}

/**
 * `worca container build …`. Returns the exit code.
 * @param {string[]} argv  tokens after `container build`
 * @param {object} io      { out, c, fail }; `exec`, `dir`, `env` and `now` are injectable for tests
 */
export async function cmdContainerBuild(argv, { out, c = (_n, s) => s, fail, exec = defaultExec, dir: dirOverride = null, env = process.env, now = () => new Date() } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { fail(err.message); return 2; }
  if (o.help) { out(CONTAINER_BUILD_HELP.trimEnd()); return 0; }
  const dir = resolve(o.dir || dirOverride || join(worcaHome(), 'container'));
  if (!existsSync(join(dir, 'compose.yml'))) { fail(`no compose files in ${dir}; run: worca container init`); return 1; }
  const envFile = envReader(dir);
  let base;
  try { base = boxBaseImage(envFile); } catch (err) { fail(err.message); return 1; }
  const record = readBoxImageRecord(dir);
  const envImage = envFile('WORCA_IMAGE');

  if (o.reset) {
    if (!envImage) { out(`no built image in use: the box runs ${base}`); return 0; }
    writeEnvValue(dir, 'WORCA_IMAGE', null);
    out(`the box goes back to ${base} on the next start (worca container up). ${envImage} stays on this machine until you remove it.`);
    return 0;
  }

  if (o.status) {
    let baseId = null;
    if (envImage && record) {
      const rt = detectRuntime(exec, o.runtime);
      if (!rt.error) {
        const r = exec(rt.bin, ['image', 'inspect', '--format', '{{.Id}}', base], { capture: true });
        if (r.status === 0) baseId = r.stdout.trim() || null;
      }
    }
    const st = boxImageState({ record, envImage, base, specHashOf: currentSpecHash, baseId, withSpec: await projectsWithSpec() });
    out(o.json ? JSON.stringify({ ...st, base, record }, null, 2) : describeState(st, record, base));
    return 0;
  }

  let picked; let spec; let dockerfile;
  try {
    picked = await pickProjects(o.projects);
    spec = unionSpecs(picked);
    dockerfile = renderBoxDockerfile({ base, spec });
  } catch (err) { fail(err.message); return 1; }
  if (o.dryRun) { out(dockerfile.trimEnd()); return 0; }

  const rt = detectRuntime(exec, o.runtime);
  if (rt.error) { fail(rt.error); return 1; }
  const keep = envImage ? `the box keeps running ${envImage}` : `the box keeps running ${base}`;
  const inspectId = () => { const r = exec(rt.bin, ['image', 'inspect', '--format', '{{.Id}}', base], { capture: true }); return r.status === 0 ? r.stdout.trim() : ''; };
  let baseId = inspectId();
  if (!baseId) {
    out(`${c('bold', 'pull')}  ${base}`);
    if (exec(rt.bin, ['pull', base], {}).status === 0) baseId = inspectId();
    if (!baseId) { fail(`the base image ${base} is not available (set WORCA_BASE_IMAGE in ${join(dir, '.env')}); ${keep}`); return 1; }
  }
  const tag = boxImageTag(dockerfile, baseId);
  const buildDir = join(dir, BUILD_DIR);
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'Dockerfile'), dockerfile);
  const who = picked.map((p) => p.name || p.key).join(', ');
  out(`${c('bold', 'build')}  ${tag} from ${base}: ${spec.tools.length} tools, ${spec.apt.length} apt packages (${who})`);
  const built = exec(rt.bin, ['build', '-t', tag, '-f', join(buildDir, 'Dockerfile'), ...proxyBuildArgs(envFile, out, c), buildDir], {});
  if (built.status !== 0) { fail(`the build failed (exit ${built.status}); ${keep}`); return 1; }

  const drop = () => { if (tag !== envImage) exec(rt.bin, ['image', 'rm', tag], { capture: true }); };
  const labels = parseLabels(exec(rt.bin, ['image', 'inspect', '--format', '{{json .Config.Labels}}', tag], { capture: true }).stdout);
  const ran = exec(rt.bin, ['run', '--rm', '--network', 'none', '--entrypoint', '/bin/sh', tag, '-c', PROBE_SCRIPT], { capture: true });
  const probe = parseBoxProbe(ran.stdout);
  const problems = checkBoxProbe(probe, { labels, base });
  if (problems.length) {
    for (const p of problems) fail(`the built image cannot run Worca: ${p}`);
    fail(keep);
    drop();
    return 1;
  }

  writeBoxImageRecord(dir, {
    image: tag, base, baseId, specHash: spec.hash,
    projects: picked.map((p) => ({ key: p.key, name: p.name, specHash: p.spec.hash })),
    tools: spec.tools.length, apt: spec.apt.length,
    node: probe.node, git: probe.git, claudeCode: probe.claude, worca: probe.worca,
    builtAt: now().toISOString(),
  });
  writeEnvValue(dir, 'WORCA_IMAGE', tag);
  out(`${c('green', 'built')}  ${tag}  (node ${probe.node}, git ${probe.git}, Claude Code ${probe.claude}, worca ${probe.worca})`);
  out(`  .env now sets WORCA_IMAGE=${tag}. Restart the box on it: ${c('bold', 'worca container up')}`);
  return 0;
}
