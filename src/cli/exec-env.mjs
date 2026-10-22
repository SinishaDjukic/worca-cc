// src/cli/exec-env.mjs
// `worca exec-env` — execution environments and per-project sandbox environments (docs/e2b.md). The spec and the
// status are read/written in this process (worca's DB); a BUILD runs only in the worca server, which holds the
// backend keys, so `build` asks the running server over HTTP and follows its log.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  worca exec-env spec --project <key|dir> [--set <file.json> | --clear]
                                                             show, set or clear the project's environment spec
  worca exec-env build --project <key|dir> [--backend <name>] [--spec <file.json>] [--no-wait]
                                                             build or rebuild the project's environment in the
                                                             running worca server (it alone holds the backend keys)
`;
const NO_SERVER = 'No running worca server found. Environment builds run only in the server process, which holds the backend keys: start it with `worca ui`, then retry.';

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '--set' || a === '--spec' || a === '--backend') o[a.slice(2)] = argv[++i];
    else if (a === '--clear' || a === '--no-wait') o[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}
/** A registered project's key from a key or a directory; throws for anything else (a spec must never land under
 *  a key no project has — projectKey() hashes any directory). A key-shaped name is tried as a key first. */
async function keyOf(p) {
  const known = new Set((await listProjects()).map((x) => x.key));
  if (PROJECT_KEY_RE.test(p) && known.has(p)) return p;
  const k = keyOfDir(resolve(p));
  if (known.has(k)) return k;
  throw new Error(`${p} is not a registered project (see: worca projects)`);
}
const readSpec = (file) => JSON.parse(readFileSync(resolve(file), 'utf8'));

export async function cmdExecEnv(argv, { out, fail, call = callUi, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help') { out(EXEC_ENV_HELP); return 0; }
  let o; try { o = parse(rest); } catch (err) { fail(err.message); return 2; }
  if (verb === 'list') { for (const e of describeExecEnvs()) out(`${e.name.padEnd(10)} ${e.label}`); return 0; }
  if (!['status', 'spec', 'build'].includes(verb)) { fail(`unknown exec-env command: ${verb} (see: worca exec-env help)`); return 1; }
  if (!o.project) { fail('--project <key|dir> is required'); return 2; }
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
      if (o.set && o.clear) { fail('--set and --clear exclude each other'); return 2; }
      if (o.set) { const s = setProjectEnvSpec(key, readSpec(o.set)); out(`spec saved: ${s.tools.length} tools, ${s.apt.length} apt packages (${s.hash})`); return 0; }
      if (o.clear) { clearProjectEnvSpec(key); out('spec cleared'); return 0; }
      out(JSON.stringify(projectExecEnvView(key).spec, null, 2)); return 0;
    }
    // build
    const backend = o.backend ? getExecBackend(o.backend).name : defaultBuildBackend()?.name;
    if (!backend) { fail('no execution backend can build environments'); return 1; }
    if (o.spec) setProjectEnvSpec(key, readSpec(o.spec));
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
