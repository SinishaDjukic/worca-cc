// src/core/exec-env/registry.mjs
// The execution-backend registry (like engines/index.mjs ENGINES): the only way the harness, the
// server, the CLI and settings reach a backend. Adding a backend = one module + one line below
// (plans/e2b-execution-design.md §17). Each backend's secretEnv joins stripHostCredentials.
import { assertBackend } from './backend.mjs';
import { e2bBackend } from './backends/e2b.mjs';
import { registerHostSecretEnv } from '../host-credentials.mjs';

const BACKENDS = new Map();
function register(backend) {
  assertBackend(backend);
  if (BACKENDS.has(backend.name)) throw new Error(`execution backend "${backend.name}" is registered twice`);
  BACKENDS.set(backend.name, backend);
  registerHostSecretEnv(backend.secretEnv);
}
register(e2bBackend);

/** 'local' first, then every registered backend. */
export const execEnvNames = () => ['local', ...BACKENDS.keys()];
export const listExecBackends = () => [...BACKENDS.values()];
export function getExecBackend(name) {
  const backend = BACKENDS.get(name);
  if (!backend) throw new Error(`unknown execution environment "${name}" (known: ${execEnvNames().join(', ')})`);
  return backend;
}
/** The pickers' list (GET /api/exec-envs): no functions, no secrets. */
export function describeExecEnvs() {
  return [{ name: 'local', label: 'Local', title: 'Local' }, ...listExecBackends().map((b) => ({
    name: b.name, label: b.label, title: b.title, environmentNoun: b.environmentNoun,
    capabilities: { pause: b.capabilities.pause, buildEnvironment: b.capabilities.buildEnvironment },
    projectFields: (b.projectFields || []).map(({ key, label, hint }) => ({ key, label, hint })),
  }))];
}
/** The backend `worca exec-env build` uses without --backend: the first that can build. */
export const defaultBuildBackend = () => listExecBackends().find((b) => b.capabilities.buildEnvironment) || null;
/** Tests only (test/helpers/loopback-backend.mjs): returns the unregister. The secretEnv stays registered. */
export function _registerExecBackendForTests(backend) { register(backend); return () => { BACKENDS.delete(backend.name); }; }
