// src/cli/exec-env.mjs
// `worca exec-env` — execution environments and per-project sandbox environments (docs/e2b.md,
// docs/environment-spec.md). The spec and the status are read/written in this process (worca's DB); a BUILD runs
// only in the worca server, which holds the backend keys, so `build` asks the running server over HTTP and follows
// its log.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readProjectExecEnv } from '../core/config.mjs';
import { describeExecEnvs, getExecBackend } from '../core/exec-env/index.mjs';
import { defaultBuildBackend } from '../core/exec-env/registry.mjs';
import { setProjectEnvSpec, clearProjectEnvSpec, projectExecEnvView } from '../core/exec-env/project-env.mjs';
import { projectKey as keyOfDir, PROJECT_KEY_RE } from '../core/store.mjs';
import { listProjects } from '../core/projects.mjs';
import { callUi } from '../core/ui-instance.mjs';

export const EXEC_ENV_HELP = `worca exec-env — execution environments and per-project sandbox environments

Usage:
  worca exec-env list                                        the registered execution environments
  worca exec-env status --project <key|dir>                  a project's spec, settings and builds, as the running
                                                             server sees them (this shell's view when none runs)
  worca exec-env specs [--json]                              every project that has an environment spec, with it
  worca exec-env spec --project <key|dir> [--set <file.json> | --clear] [--json]
                                                             show, set or clear the project's environment spec
  worca exec-env build --project <key|dir> [--backend <name>] [--spec <file.json>] [--no-wait]
                                                             build or rebuild the project's environment in the
                                                             running worca server (it alone holds the backend keys)

The spec lists pinned tools (mise names) and apt packages. It holds tools only: never env vars, files or secrets.
`;
const NO_SERVER = 'No running worca server found. Environment builds run only in the server process, which holds the backend keys: start it with `worca ui`, then retry.';

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '--set' || a === '--spec' || a === '--backend') {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else if (a === '--clear' || a === '--json' || a === '--no-wait') o[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}
/** A registered project's key from a key or a directory; throws for anything else (a spec must never land under
 *  a key no project has — projectKey() hashes any directory). A key-shaped name is tried as a key first. */
export async function keyOf(p) {
  const known = new Set((await listProjects()).map((x) => x.key));
  if (PROJECT_KEY_RE.test(p) && known.has(p)) return p;
  const k = keyOfDir(resolve(p));
  if (known.has(k)) return k;
  throw new Error(`${p} is not a registered project (see: worca list)`);
}
const readSpecFile = (file) => JSON.parse(readFileSync(resolve(file), 'utf8'));

function describe(spec) {
  if (!spec) return 'no environment spec';
  const lines = [`environment spec ${spec.hash} (updated ${spec.updatedAt ?? 'unknown'})`, `tools (${spec.tools.length}):`];
  for (const t of spec.tools) lines.push(`  ${t.name} ${t.version}`);
  lines.push(`apt packages (${spec.apt.length}):`);
  for (const p of spec.apt) lines.push(`  ${p}`);
  return lines.join('\n');
}

export async function cmdExecEnv(argv, { out, fail, call = callUi, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help') { out(EXEC_ENV_HELP); return 0; }
  let o; try { o = parse(rest); } catch (err) { fail(err.message); return 2; }
  if (verb === 'list') { for (const e of describeExecEnvs()) out(`${e.name.padEnd(10)} ${e.label}`); return 0; }
  if (verb === 'specs') {
    // `worca container build` in the hardened box runs this inside the box: the projects live there.
    const list = [];
    for (const p of await listProjects()) {
      let spec = null;
      try { spec = readProjectExecEnv(p.key).spec; } catch { spec = null; }
      if (spec) list.push({ key: p.key, name: p.name || '', spec });
    }
    if (o.json) out(JSON.stringify(list));
    else if (!list.length) out('no project has an environment spec');
    else for (const p of list) out(`${(p.name || p.key).padEnd(24)} ${p.key}  ${p.spec.tools.length} tools, ${p.spec.apt.length} apt packages (${p.spec.hash})`);
    return 0;
  }
  if (!['status', 'spec', 'build'].includes(verb)) { fail(`unknown exec-env command: ${verb} (see: worca exec-env help)`); return 1; }
  if (!o.project) { fail('--project <key|dir> is required'); return 2; }
  if (verb === 'spec' && o.set && o.clear) { fail('--set and --clear exclude each other'); return 2; }
  try {
    const key = await keyOf(o.project);
    if (verb === 'status') {
      // The server's view: its env (E2B_API_URL, key, WORCA_E2B_TEMPLATE) decides the template a run gets and
      // whether a build was made on another server. This shell's env usually has none of it.
      const r = await call(`/api/projects/${encodeURIComponent(key)}/exec-env`);
      if (r?.ok) { out(JSON.stringify(r.data, null, 2)); return 0; }
      fail(`${r ? `The worca server answered ${r.status}` : 'No running worca server found'}: computed in this shell's environment, so the template in use and "built on another server" may differ from what runs get.`);
      out(JSON.stringify(projectExecEnvView(key), null, 2)); return 0;
    }
    if (verb === 'spec') {
      if (o.set) {
        const s = setProjectEnvSpec(key, readSpecFile(o.set));
        out(o.json ? JSON.stringify(s, null, 2) : `spec saved: ${s.tools.length} tools, ${s.apt.length} apt packages (${s.hash})`);
        return 0;
      }
      if (o.clear) { clearProjectEnvSpec(key); out(o.json ? JSON.stringify(null) : 'spec cleared'); return 0; }
      const spec = readProjectExecEnv(key).spec;
      out(o.json ? JSON.stringify(spec, null, 2) : describe(spec));
      return 0;
    }
    // build
    const backend = o.backend ? getExecBackend(o.backend).name : defaultBuildBackend()?.name;
    if (!backend) { fail('no execution backend can build environments'); return 1; }
    if (o.spec) setProjectEnvSpec(key, readSpecFile(o.spec));
    const r = await call(`/api/projects/${encodeURIComponent(key)}/exec-env/build`, { method: 'POST', body: { backend } });
    if (!r) { fail(NO_SERVER); return 1; }
    if (!r.ok) { fail(r.data?.error || `the server answered ${r.status}`); return 1; }
    const job = r.data.job;
    out(`build ${job.id}: ${job.name} on ${backend}`);
    if (o['no-wait']) return 0;
    for (let since = 0; ;) {
      const s = await call(`/api/exec-env/builds/${job.id}?since=${since}`);
      if (!s?.ok) { fail('lost the build job (did the server restart?)'); return 1; }
      for (const l of s.data.lines) out(l);
      since = s.data.next;
      if (s.data.job.state !== 'running') return s.data.job.state === 'done' ? 0 : 1;
      await sleep(1000);
    }
  } catch (err) { fail(err.message); return 1; }
}
