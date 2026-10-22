// src/core/exec-env/project-env.mjs
// A project's sandbox environment (plans/e2b-execution-design.md §18): its backend fields (e2b: template), its
// environment spec, its builds; which environment a run uses and whether that build is stale. Never blocks a run.
import { readProjectExecEnv, updateProjectExecEnv } from '../config.mjs';
import { getExecBackend, listExecBackends } from './registry.mjs';
import { normalizeEnvSpec } from './env-spec.mjs';

export class ExecEnvConfigError extends Error {
  constructor(message) { super(message); this.name = 'ExecEnvConfigError'; this.code = 'EXEC_ENV_CONFIG_INVALID'; }
}

export function setProjectEnvSpec(projectKey, input, { now = new Date() } = {}) {
  const spec = { ...normalizeEnvSpec(input), updatedAt: now.toISOString() };
  updateProjectExecEnv(projectKey, (rec) => { rec.spec = spec; });
  return spec;
}
export function clearProjectEnvSpec(projectKey) { updateProjectExecEnv(projectKey, (rec) => { rec.spec = null; }); }

/** values: { field: string | null } — null or '' clears the field. Validated by the backend's projectFields. */
export function setProjectBackendConfig(projectKey, backendName, values) {
  const backend = getExecBackend(backendName);
  const fields = new Map((backend.projectFields || []).map((f) => [f.key, f]));
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ExecEnvConfigError('values must be an object');
  const clean = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.get(k);
    if (!f) throw new ExecEnvConfigError(`${backend.label} has no project setting "${k}"`);
    if (v === null || (typeof v === 'string' && !v.trim())) { clean[k] = null; continue; }
    if (typeof v !== 'string' || !f.validate(v.trim())) throw new ExecEnvConfigError(`${f.label}: must be ${f.hint}`);
    clean[k] = v.trim();
  }
  const rec = updateProjectExecEnv(projectKey, (r) => {
    const cur = { ...(r.config[backend.name] || {}) };
    for (const [k, v] of Object.entries(clean)) { if (v === null) delete cur[k]; else cur[k] = v; }
    if (Object.keys(cur).length) r.config[backend.name] = cur; else delete r.config[backend.name];
  });
  return rec.config[backend.name] || {};
}

/** Only a SUCCESSFUL build lands here (a failed one leaves the previous record and template in place).
 *  `result.server` is the backend's serverIdentity() the build ran against ({ id, label }), or null. */
export function recordProjectBuild(projectKey, backendName, result, { now = new Date() } = {}) {
  const record = { name: result.name, id: result.id ?? null, buildId: result.buildId ?? null,
    specHash: result.specHash, baseVersion: result.baseVersion, server: result.server ?? null, builtAt: now.toISOString() };
  updateProjectExecEnv(projectKey, (rec) => { rec.builds[backendName] = record; });
  return record;
}

/** The backend's current base, or null when it cannot be read (e.g. a package without docker/): no base reason then. */
export function safeBaseVersion(backend) { try { return backend.baseVersion?.() ?? null; } catch { return null; } }

/** Why a recorded build no longer matches the project: its spec hash or the backend's base moved. */
export function buildStaleness({ spec, build, baseVersion }) {
  const reasons = [];
  if (!spec) reasons.push('the project no longer has an environment spec');
  else if (spec.hash !== build.specHash) reasons.push('the environment spec changed since the build');
  if (baseVersion && build.baseVersion && baseVersion !== build.baseVersion) reasons.push(`the base changed (${build.baseVersion} → ${baseVersion})`);
  return { stale: reasons.length > 0, reasons };
}

/** The recorded build when it was made on the server `env` points at. A build on another server (e.g. after
 *  E2B_API_URL moved from a remote E2B to a local one) names an environment that does not exist here: it is set
 *  aside, with both servers' labels. A build without a recorded server predates the record and is kept. */
export function usableBuild(backend, build, env = process.env) {
  const here = build?.server && backend.serverIdentity ? backend.serverIdentity(env) : null;
  if (!here || build.server.id === here.id) return { build, elsewhere: null };
  return { build: null, elsewhere: { builtOn: build.server.label, here: here.label } };
}

/** Which environment a run of `projectKey` uses on `backend`, plus run-log notes and `rebuild`: how to rebuild it when it
 *  lacks an engine's CLI (RemoteExecEnv.ensureCli), or null when the backend names no way. Never throws, never blocks. */
export function resolveRunEnvironment(backend, projectKey, { env = process.env } = {}) {
  let rec; try { rec = readProjectExecEnv(projectKey); } catch { rec = { config: {}, spec: null, builds: {} }; }
  const recorded = rec.builds[backend.name] || null;
  const { build, elsewhere } = usableBuild(backend, recorded, env);
  const target = backend.resolveEnvironment({ config: rec.config[backend.name] || {}, build, env });
  const notes = [];
  const how = `Rebuild it on the project page, or run: worca exec-env build --project ${projectKey}`;
  if (elsewhere && target.source !== 'project') {
    notes.push({ level: 'warn', text: `the project's ${backend.environmentNoun} ${recorded.name} was built on another ${backend.title} server (${elsewhere.builtOn}); this server is ${elsewhere.here}. This run uses ${target.name} (${target.from}). ${how}` });
  } else if (target.source === 'build') {
    const s = buildStaleness({ spec: rec.spec, build, baseVersion: safeBaseVersion(backend) });
    if (s.stale) notes.push({ level: 'warn', text: `the project's ${backend.environmentNoun} ${build.name} is stale (${s.reasons.join('; ')}); this run still uses it. ${how}` });
  } else if (rec.spec && backend.capabilities.buildEnvironment && !recorded) {
    notes.push({ level: 'info', text: `the project has an environment spec but no built ${backend.environmentNoun} yet; this run uses ${target.name}. Build it on the project page, or run: worca exec-env build --project ${projectKey}` });
  }
  const rebuild = target.source === 'build' ? `Rebuild environment on the project page, or run: worca exec-env build --project ${projectKey}`
    : backend.rebuildHint ?? null;
  // The build the sandbox starts from: a rebuild keeps the name, so a resume compares this too.
  return { ...target, buildId: target.source === 'build' ? build.buildId ?? null : null, notes, rebuild };
}

/** GET /api/projects/:key/exec-env. `jobFor(backendName)` is the server's latest build job (build.mjs). */
export function projectExecEnvView(projectKey, { jobFor = () => null, env = process.env } = {}) {
  const rec = readProjectExecEnv(projectKey);
  return {
    projectKey, spec: rec.spec,
    backends: listExecBackends().map((b) => {
      const config = rec.config[b.name] || {}; const build = rec.builds[b.name] || null;
      const usable = usableBuild(b, build, env);
      return { name: b.name, label: b.label, title: b.title, environmentNoun: b.environmentNoun, canBuild: b.capabilities.buildEnvironment,
        buildName: b.capabilities.buildEnvironment ? b.environmentName(projectKey) : null,
        fields: (b.projectFields || []).map(({ key, label, hint }) => ({ key, label, hint, value: config[key] ?? null })),
        effective: b.resolveEnvironment({ config, build: usable.build, env }),
        build, elsewhere: usable.elsewhere, stale: build ? buildStaleness({ spec: rec.spec, build, baseVersion: safeBaseVersion(b) }) : null,
        job: jobFor(b.name) };
    }),
  };
}
