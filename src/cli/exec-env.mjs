// src/cli/exec-env.mjs
// `worca exec-env` — a project's environment spec (docs/environment-spec.md). The spec is read and written in this
// process, in Worca's DB. Later verbs (status, build) join here in later releases.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readProjectExecEnv } from '../core/config.mjs';
import { setProjectEnvSpec, clearProjectEnvSpec } from '../core/exec-env/project-env.mjs';
import { projectKey as keyOfDir, PROJECT_KEY_RE } from '../core/store.mjs';
import { listProjects } from '../core/projects.mjs';

export const EXEC_ENV_HELP = `worca exec-env — a project's environment spec (docs/environment-spec.md)

Usage:
  worca exec-env spec --project <key|dir> [--set <file.json> | --clear] [--json]
                                   show, set or clear the project's environment spec

The spec lists pinned tools (mise names) and apt packages. It holds tools only: never env vars, files or secrets.
`;

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '--set') {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else if (a === '--clear' || a === '--json') o[a.slice(2)] = true;
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

export async function cmdExecEnv(argv, { out, fail } = {}) {
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help') { out(EXEC_ENV_HELP); return 0; }
  if (verb !== 'spec') { fail(`unknown exec-env command: ${verb} (see: worca exec-env help)`); return 1; }
  let o; try { o = parse(rest); } catch (err) { fail(err.message); return 2; }
  if (!o.project) { fail('--project <key|dir> is required'); return 2; }
  if (o.set && o.clear) { fail('--set and --clear exclude each other'); return 2; }
  try {
    const key = await keyOf(o.project);
    if (o.set) {
      const s = setProjectEnvSpec(key, readSpecFile(o.set));
      out(o.json ? JSON.stringify(s, null, 2) : `spec saved: ${s.tools.length} tools, ${s.apt.length} apt packages (${s.hash})`);
      return 0;
    }
    if (o.clear) { clearProjectEnvSpec(key); out(o.json ? JSON.stringify(null) : 'spec cleared'); return 0; }
    const spec = readProjectExecEnv(key).spec;
    out(o.json ? JSON.stringify(spec, null, 2) : describe(spec));
    return 0;
  } catch (err) { fail(err.message); return 1; }
}
