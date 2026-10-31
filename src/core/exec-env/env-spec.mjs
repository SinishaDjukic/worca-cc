// src/core/exec-env/env-spec.mjs
// A project's backend-neutral environment spec (plans/e2b-execution-design.md §18): the tools its sandbox needs —
// never repo code, files, env or secrets. Stored in worca's DB (config.mjs execEnvProject.spec); set through the
// API/CLI now, and from the Toolchain setup workflow's approved lock next (mise rows -> tools, apt: rows -> apt).
import { createHash } from 'node:crypto';

export const ENV_SPEC_VERSION = 1;
const TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,127}$/;   // mise names: node, npm:prettier, pipx:black, github:cli/cli
const TOOL_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const APT_RE = /^[a-z0-9][a-z0-9+.-]{1,63}$/;                      // the Toolchain workflow's own apt rule
const MAX_TOOLS = 100;
const MAX_APT = 200;
const SPEC_KEYS = new Set(['version', 'tools', 'apt', 'hash', 'updatedAt']);   // hash/updatedAt: a GET round-trip; recomputed

export class EnvSpecError extends Error {
  constructor(message) { super(message); this.name = 'EnvSpecError'; this.code = 'EXEC_ENV_SPEC_INVALID'; }
}
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The canonical spec (sorted, deduplicated) with its hash; throws EnvSpecError naming the first problem. */
export function normalizeEnvSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EnvSpecError('the environment spec must be a JSON object');
  for (const k of Object.keys(input)) if (!SPEC_KEYS.has(k)) throw new EnvSpecError(`unknown key "${k}": a spec holds only tools and apt packages`);
  if (input.version !== undefined && input.version !== ENV_SPEC_VERSION) throw new EnvSpecError(`version must be ${ENV_SPEC_VERSION}`);
  const tools = input.tools ?? []; const apt = input.apt ?? [];
  if (!Array.isArray(tools)) throw new EnvSpecError('tools must be an array');
  if (tools.length > MAX_TOOLS) throw new EnvSpecError(`at most ${MAX_TOOLS} tools`);
  const seen = new Map();
  for (const t of tools) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new EnvSpecError('each tool must be an object { name, version }');
    for (const k of Object.keys(t)) if (k !== 'name' && k !== 'version') throw new EnvSpecError(`tool ${JSON.stringify(t.name)}: unknown key "${k}"`);
    if (typeof t.name !== 'string' || !TOOL_NAME_RE.test(t.name)) throw new EnvSpecError(`tool name ${JSON.stringify(t.name)} is not a mise tool name`);
    if (typeof t.version !== 'string' || !TOOL_VERSION_RE.test(t.version) || t.version === 'latest') {
      throw new EnvSpecError(`tool ${t.name}: version must be pinned (e.g. 24.21.0), not ${JSON.stringify(t.version)}`);
    }
    if (seen.has(t.name)) throw new EnvSpecError(`tool ${t.name} is listed twice`);
    seen.set(t.name, t.version);
  }
  if (!Array.isArray(apt)) throw new EnvSpecError('apt must be an array of package names');
  if (apt.length > MAX_APT) throw new EnvSpecError(`at most ${MAX_APT} apt packages`);
  for (const p of apt) if (typeof p !== 'string' || !APT_RE.test(p)) throw new EnvSpecError(`apt package ${JSON.stringify(p)} is not a Debian package name`);
  const spec = { version: ENV_SPEC_VERSION, tools: [...seen].map(([name, version]) => ({ name, version })).sort(byName), apt: [...new Set(apt)].sort() };
  return { ...spec, hash: envSpecHash(spec) };
}

/** sha256 over the canonical content only (never updatedAt): the same tools hash the same everywhere. */
export function envSpecHash({ version = ENV_SPEC_VERSION, tools = [], apt = [] }) {
  const canonical = JSON.stringify({ version, tools: tools.map((t) => [t.name, t.version]), apt });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
