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
import { detectRuntime, dotenvValue, isLoopbackProxy, composeValue } from './container.mjs';
import { hardenedProjectName, selectBox } from './container-hardened.mjs';
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

In the hardened box the projects live inside the box, so the specs are read from the running box (start it first:
worca container up --hardened). --project then takes a project's key or name as the box lists it.

Options:
  --dir <d>        Container dir (default: <worcaHome>/container)
  --runtime <r>    docker | podman (default: autodetect; env WORCA_CONTAINER_RUNTIME)
  --hardened / --plain   read the specs from that box this once (default: the box worca container up remembered)

The build starts from WORCA_BASE_IMAGE in the container .env (default: the image of WORCA_TAG). Nothing rebuilds by
itself: a stale image is still used, with a warning. Restart the box on a new image with: worca container up
`;

function defaultExec(cmd, args, { cwd, capture = false, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.error ? 127 : (r.status ?? 1), stdout: r.stdout || '', stderr: r.stderr || '' };
}

function parse(argv) {
  const o = { projects: [], status: false, json: false, dryRun: false, reset: false, dir: null, runtime: null, help: false, box: null };
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
    else if (a === '--hardened' || a === '--plain') o.box = a.slice(2);
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

/** The script `docker exec` runs in the hardened box: Worca's CLI as the worca user, on the box's data volume (the
 *  entrypoint sets HOME and WORCA_HOME there for the server; an exec does not run the entrypoint). */
const BOX_SPECS_SCRIPT = 'd="${WORCA_DATA_DIR:-/data}"; HOME="$d/home" WORCA_HOME="$d/worca" exec worca exec-env specs --json';

/**
 * Every project with a spec, read inside the running hardened box: [{key, name, spec}], or {error}.
 * Its projects are cloned into the box's volume, so the host's registry knows none of them.
 */
export function boxSpecs({ exec, bin, dir, env }) {
  const project = hardenedProjectName({ dir, env });
  const ps = exec(bin, ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=worca'], { capture: true });
  const id = ps.status === 0 ? String(ps.stdout || '').trim().split('\n')[0].trim() : '';
  if (!id) return { error: `the hardened box (compose project ${project}) is not running, and its projects and their environment specs live inside it. Start it with worca container up --hardened, then run worca container build again` };
  const r = exec(bin, ['exec', '-u', 'worca', id, 'sh', '-c', BOX_SPECS_SCRIPT], { capture: true });
  let list = null;
  try { list = JSON.parse(String(r.stdout || '').trim()); } catch { list = null; }
  if (r.status !== 0 || !Array.isArray(list)) {
    const why = String(r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`;
    return { error: `cannot read the environment specs in the hardened box (${why}). Its Worca may be older than this one: update the image (WORCA_TAG in .env, then worca container pull --hardened)` };
  }
  return list.filter((p) => p && typeof p.key === 'string' && p.spec && typeof p.spec === 'object').map((p) => ({ key: p.key, name: p.name || '', spec: p.spec }));
}

/** From the box's list: the named projects (key or name), else all of them. */
function pickFromList(all, names) {
  if (!all.length) throw new Error('no project in the hardened box has an environment spec (set one in the box: Projects › the project › Environment)');
  if (!names.length) return all;
  const out = [];
  for (const n of names) {
    const hit = all.find((p) => p.key === n) || all.find((p) => p.name === n);
    if (!hit) throw new Error(`the hardened box has no project ${n} with an environment spec (known: ${all.map((p) => p.name || p.key).join(', ')})`);
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

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
  // WORCA_TAG as compose reads it for the box (shell over .env); WORCA_BASE_IMAGE is the container .env's alone.
  const baseEnv = (k) => (k === 'WORCA_TAG' ? composeValue(k, { env, envFile }) : envFile(k));
  try { base = boxBaseImage(baseEnv); } catch (err) { fail(err.message); return 1; }
  const record = readBoxImageRecord(dir);
  const envImage = envFile('WORCA_IMAGE');
  let state = {};
  try { state = JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')); } catch { /* none */ }
  const hardened = selectBox(o.box, state) === 'hardened';
  // The hardened box's specs, read once from inside it (null: the host's projects).
  let inBox = null;
  const readBox = () => {
    const rt = detectRuntime(exec, o.runtime);
    if (rt.error) return { error: rt.error };
    const r = boxSpecs({ exec, bin: rt.bin, dir, env });
    if (!r.error) inBox = r;
    return r;
  };

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
    let specHashOf = currentSpecHash; let withSpec;
    if (hardened) {
      const r = readBox();
      if (r.error) { fail(r.error); return 1; }
      specHashOf = (key) => r.find((p) => p.key === key)?.spec?.hash ?? null;
      withSpec = r.map((p) => ({ key: p.key, name: p.name }));
    } else withSpec = await projectsWithSpec();
    const st = boxImageState({ record, envImage, base, specHashOf, baseId, withSpec });
    out(o.json ? JSON.stringify({ ...st, base, record }, null, 2) : describeState(st, record, base));
    return 0;
  }

  let picked; let spec; let dockerfile;
  if (hardened) { const r = readBox(); if (r.error) { fail(r.error); return 1; } }
  try {
    picked = inBox ? pickFromList(inBox, o.projects) : await pickProjects(o.projects);
    spec = unionSpecs(picked);
    dockerfile = renderBoxDockerfile({ base, spec, projects: picked.map((p) => ({ key: p.key, specHash: p.spec.hash })) });
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
    image: tag, base, baseId, specHash: spec.hash, ...(hardened ? { box: 'hardened' } : {}),
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
