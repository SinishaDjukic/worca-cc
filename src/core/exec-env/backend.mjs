// src/core/exec-env/backend.mjs
// The execution-backend contract (plans/e2b-execution-design.md §17). A backend is ONE module that
// exports a frozen definition; exec-env/registry.mjs lists it. Local is not a backend: it is the
// absence of an exec-env object (every call site branches on `execEnv?.remote`).

/**
 * @typedef {object} ExecBackend
 * @property {string} name              registry key, run-log channel, resume-record `kind` ('e2b')
 * @property {string} label             a sandbox of it in UI and messages ('E2B sandbox')
 * @property {string} title             the provider's short name ('E2B': "E2B execution cannot start")
 * @property {string} environmentNoun   what an environment is called here ('template')
 * @property {string} [workDir]         scratch dir INSIDE the sandbox (default '/tmp/worca-exec')
 * @property {string} [homeDir]         the sandbox user's HOME (default '/home/user'): engine homes (codex's CODEX_HOME) live there
 * @property {string} [rebuildHint]     how to rebuild the default environment ('npm run e2b:build'): named when one lacks an
 *   engine's CLI (RemoteExecEnv.ensureCli); a project's own build is rebuilt from its page instead (project-env.mjs)
 * @property {{pause: boolean, buildEnvironment: boolean, defaultMaxConcurrent: number, defaultMaxWaitMin: number}} capabilities
 * @property {{maxConcurrent?: string, maxWaitMin?: string}} [limitSettings]  user setting keys (settings.mjs execEnvLimitSetting)
 * @property {RegExp} secretEnv         env keys that are this backend's secrets: stripped from every host child
 * @property {Array<{key: string, label: string, hint: string, validate: (value: string) => boolean}>} [projectFields]
 * @property {(ctx: {engine: string, isWorkspace: boolean, mock: boolean, brokerOn: boolean, runRootMode: string, needsSignIn?: boolean}) => {errors: string[], warnings: string[]}} preflight
 *   sync (the server's 409 path). Only the backend's OWN checks (keys, SDK, endpoint): the harness adds
 *   policy.mjs remotePreflight (workspace, engine, run-root mode, platform) for every backend. `needsSignIn` false: the
 *   run engine's sign-in is not needed (a codex run on endpoint models only), so it is not checked.
 * @property {(run: {workspace: boolean, engine: string|null}) => string|null} [refusesDefault]  extra reasons a SAVED
 *   default does not apply (policy.mjs remoteRefusesDefault already covers workspace runs and engines no sandbox runs)
 * @property {(env?: object) => boolean} configured   keys present and SDK installed (the boot sweep)
 * @property {(o?: {mock?: boolean, env?: object}) => Promise<BackendClient>} open
 * @property {(o: {config: object, build: object|null, env?: object}) => {name: string, source: 'project'|'build'|'env'|'default', from: string}} resolveEnvironment
 * @property {(env?: object) => {id: string, label: string}} [serverIdentity]  the provider server `env` points at: a
 *   build records it, and a build made on another server is not used (project-env.mjs usableBuild)
 * @property {(o?: {env?: object, mock?: boolean}) => Promise<BackendStatus>} [status]  the live status of the server `env`
 *   points at (GET /api/exec-envs/status, exec-env/status.mjs adds the cap and the waiting runs): one cheap, time-limited
 *   provider call. Never throws.
 * @property {() => string} [baseVersion]           what a project build stands on (with buildEnvironment)
 * @property {(projectKey: string) => string} [environmentName]  a project's built environment name
 */

/**
 * @typedef {{state: 'connected'|'unreachable'|'key-refused'|'not-configured', server: string, running?: number, error?: string}} BackendStatus
 *   `running` (connected only): every sandbox the provider runs against capacity; `error`: one safe line, never a key
 */

/**
 * @typedef {{ id: string, pathPrefix: string, box: unknown }} Box   `box` is the backend's own handle
 * @typedef {{ background?: boolean, cwd?: string, env?: Record<string,string>, user?: string, timeoutMs?: number, stdin?: boolean,
 *   onStdout?: (d: string) => void, onStderr?: (d: string) => void }} RunOptions
 * @typedef {{ pid: number, wait: () => Promise<{exitCode: number}>, kill: () => Promise<boolean>,
 *   sendStdin?: (data: string) => Promise<void> }} CommandHandle
 * @typedef {{ name: string, id: string|null, buildId: string|null, specHash: string, baseVersion: string }} BuildResult
 *
 * @typedef {object} BackendClient   one connection; holds the server's keys, never handed to an agent
 * @property {(o: {environment: string, tags: Record<string,string>, timeoutMs: number}) => Promise<Box>} create
 * @property {(id: string) => Promise<Box>} connect
 * @property {(id: string) => Promise<unknown>} info   resolves while the sandbox exists (the control-plane check)
 * @property {(tags: Record<string,string>) => Promise<Array<{id: string, tags: Record<string,string>}>>} list
 * @property {(id: string) => Promise<boolean>} remove
 * @property {(o?: {timeoutMs?: number}) => Promise<number>} [countRunning]   every running sandbox the provider counts against capacity
 * @property {(box: unknown, cmd: string, o?: RunOptions) => Promise<{stdout: string, stderr: string, exitCode: number}|CommandHandle>} run
 *   foreground: resolves on exit 0, REJECTS with an error carrying numeric `exitCode` and `stderr` otherwise;
 *   `background: true`: resolves a CommandHandle whose wait() rejects the same way. `stdin: true` (only with `background: true`, for
 *   long-lived helpers) keeps stdin open and the handle gains sendStdin(data); an agent's own stdin is never passed:
 *   RemoteExecEnv writes it to a scratch file and redirects.
 * @property {(box: unknown, path: string) => Promise<Buffer>} readFile
 * @property {(box: unknown, path: string, data: Buffer) => Promise<unknown>} writeFile   creates parent dirs
 * @property {(box: unknown, ms: number) => Promise<void>} setTimeout   the provider ends the sandbox after ms
 * @property {(box: unknown) => Promise<void>} [pause]
 * @property {(box: unknown) => Promise<void>} [resume]
 * @property {(err: unknown) => 'gone'|'unreachable'|null} classifyError
 * @property {() => string} [describe]   one safe line for the run log (never a whole key)
 * @property {(spec: object, o: {name: string, onLog?: (line: string) => void}) => Promise<BuildResult>} [buildEnvironment]
 */

const REQUIRED_FNS = ['preflight', 'configured', 'open', 'resolveEnvironment'];
/** Throws on a malformed definition (the registry calls it; a second backend fails fast in its test). */
export function assertBackend(b) {
  const bad = (why) => { throw new Error(`execution backend ${JSON.stringify(b?.name)}: ${why}`); };
  if (!b || typeof b !== 'object') bad('not an object');
  if (typeof b.name !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(b.name) || b.name === 'local') bad('name must be a lowercase id other than "local"');
  for (const k of ['label', 'title', 'environmentNoun']) if (typeof b[k] !== 'string' || !b[k]) bad(`${k} is required`);
  for (const k of REQUIRED_FNS) if (typeof b[k] !== 'function') bad(`${k}() is required`);
  for (const k of ['serverIdentity', 'status']) if (b[k] !== undefined && typeof b[k] !== 'function') bad(`${k} must be a function`);
  const c = b.capabilities;
  if (!c || typeof c.pause !== 'boolean' || typeof c.buildEnvironment !== 'boolean'
    || !Number.isSafeInteger(c.defaultMaxConcurrent) || c.defaultMaxConcurrent < 1
    || !Number.isSafeInteger(c.defaultMaxWaitMin) || c.defaultMaxWaitMin < 1) bad('capabilities are incomplete');
  if (!(b.secretEnv instanceof RegExp) || b.secretEnv.global || b.secretEnv.sticky) bad('secretEnv must be a RegExp without g/y');
  if (c.buildEnvironment && (typeof b.environmentName !== 'function' || typeof b.baseVersion !== 'function')) bad('buildEnvironment needs environmentName() and baseVersion()');
  for (const f of b.projectFields || []) if (!f?.key || !f.label || typeof f.validate !== 'function') bad('a project field needs key, label and validate()');
}
