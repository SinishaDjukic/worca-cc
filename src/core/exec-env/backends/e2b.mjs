// src/core/exec-env/backends/e2b.mjs
// The E2B backend (plans/e2b-execution-design.md §17): the only module that knows the e2b SDK's shapes.
// Top-level imports stay light — the registry loads this from exec-env/index.mjs, which settings.mjs
// imports — so the SDK loader (e2b-sdk.mjs → projects.mjs → settings.mjs) is imported inside open().
import { createHash } from 'node:crypto';
import { E2B_DEFAULT_TEMPLATE, CONTROL_REQUEST_TIMEOUT_MS, FILE_REQUEST_TIMEOUT_MS, STATUS_REQUEST_TIMEOUT_MS, DEFAULT_E2B_MAX_SANDBOXES,
  DEFAULT_E2B_MAX_WAIT_MIN, e2bConnection, e2bPreflight, redactKey } from '../e2b-config.mjs';
import { renderProjectDockerfile, e2bBaseVersion, pinnedClaudeCodeVersion } from './e2b-template.mjs';

const named = (err, sdk, name) => (typeof sdk?.[name] === 'function' && err instanceof sdk[name])
  || err.name === name || err.constructor?.name === name;
/** An SDK error that proves the sandbox no longer exists: envd calls on a killed sandbox
 *  raise SandboxNotRunningError, control-plane calls SandboxNotFoundError (e2b d.ts). */
export function isSandboxGone(err, sdk = null) {
  return !!err && (named(err, sdk, 'SandboxNotFoundError') || named(err, sdk, 'SandboxNotRunningError'));
}
/** State unknown or a network problem (a dropped SSH tunnel looks like this): not proof of loss. */
export function isSandboxUnreachable(err, sdk = null) {
  return !!err && named(err, sdk, 'SandboxUnreachableError');
}
/** Sync presence check (the server's 409 path): import.meta.resolve throws when absent. */
export function e2bInstalled() {
  try { import.meta.resolve('e2b'); return true; } catch { return false; }
}

// An E2B template name, optionally with a tag (Template.build accepts 'name:tag').
export const TEMPLATE_RE = /^[a-z0-9][a-z0-9_-]{0,62}(:[a-z0-9][a-z0-9._-]{0,62})?$/;
const BUILD_CPU = 2;
const BUILD_MEMORY_MB = 4096;   // docker/e2b/build.mjs parseArgs defaults
const E2B_CLOUD_API = 'https://api.e2b.app';

/** The E2B server a template lives on: its API URL (the SDK's default from E2B_DOMAIN, else E2B Cloud) and the API
 *  key's team. The key counts because an SSH tunnel to a remote server and a local one can share localhost:3000.
 *  `id` holds a key hash, `label` only the redacted key (the run log's hint). */
export function e2bServerIdentity(env = process.env) {
  let url = String(env.E2B_API_URL || '').trim() || (env.E2B_DOMAIN ? `https://api.${env.E2B_DOMAIN}` : E2B_CLOUD_API);
  try { const u = new URL(url); url = `${u.origin}${u.pathname.replace(/\/+$/, '')}`; } catch { /* kept as written */ }
  const key = String(env.E2B_API_KEY || '');
  const fingerprint = key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : 'none';
  return { id: `${url}#${fingerprint}`, label: `${url === E2B_CLOUD_API ? 'E2B Cloud' : url} (key ${redactKey(key)})` };
}

/** A project template is the base template plus tools, so it gets the base's size on this server (docker/e2b/build.mjs
 *  --cpu/--memory-mb), read from GET /templates; BUILD_CPU/BUILD_MEMORY_MB when the base is missing or unreadable. */
async function baseTemplateSize(sdk, conn, onLog) {
  const base = (conn.template || E2B_DEFAULT_TEMPLATE).split(':')[0];
  const fallback = `using ${BUILD_CPU} vCPU, ${BUILD_MEMORY_MB} MB`;
  try {
    const client = new sdk.ApiClient(new sdk.ConnectionConfig({ ...conn.opts, requestTimeoutMs: CONTROL_REQUEST_TIMEOUT_MS }));
    const res = await client.api.GET('/templates');
    if (!Array.isArray(res?.data)) throw new Error(res?.error?.message || `the API answered ${res?.response?.status}`);
    const t = res.data.find((x) => (x.aliases || []).includes(base) || (x.names || []).some((n) => n === base || n.endsWith(`/${base}`)));
    if (!Number.isInteger(t?.cpuCount) || !Number.isInteger(t?.memoryMB)) { onLog(`${base} is not on this server; ${fallback}`); return { cpuCount: BUILD_CPU, memoryMB: BUILD_MEMORY_MB }; }
    onLog(`sized like ${base} on this server: ${t.cpuCount} vCPU, ${t.memoryMB} MB`);
    return { cpuCount: t.cpuCount, memoryMB: t.memoryMB };
  } catch (err) {
    onLog(`could not read ${base}'s size (${err?.message || err}); ${fallback}`);
    return { cpuCount: BUILD_CPU, memoryMB: BUILD_MEMORY_MB };
  }
}

/** The client over one SDK + connection (e2b-config.mjs e2bConnection). `mock`: the SDK is the loopback fake. */
export function e2bClient(sdk, conn, { mock = false } = {}) {
  const ctl = () => ({ ...conn.opts, requestTimeoutMs: CONTROL_REQUEST_TIMEOUT_MS });
  const handle = (sb) => ({ id: sb.sandboxId, pathPrefix: sb.pathPrefix || '', box: sb });
  const all = async (pager) => { const out = []; while (pager.hasNext) out.push(...await pager.nextItems()); return out; };
  return {
    create: async ({ environment, tags, timeoutMs }) => handle(await sdk.Sandbox.create(environment, { ...ctl(), metadata: tags, timeoutMs })),
    connect: async (id) => handle(await sdk.Sandbox.connect(id, ctl())),
    info: (id) => sdk.Sandbox.getInfo(id, ctl()),
    list: async (tags) => (await all(sdk.Sandbox.list({ ...conn.opts, query: { metadata: tags } })))
      .map((i) => ({ id: i.sandboxId, tags: i.metadata || {} })),
    countRunning: async ({ timeoutMs } = {}) => (await all(sdk.Sandbox.list({ ...conn.opts,
      ...(timeoutMs ? { requestTimeoutMs: timeoutMs } : {}), query: { state: ['running'] } }))).length,
    // close() killed with ctl() (30 s request cap) already; the sweep and the harness's _dropSavedSandbox passed
    // plain conn.opts. One remove for all three: the sweep is raced at 30 s anyway, so only the cap's wording moves.
    remove: (id) => sdk.Sandbox.kill(id, ctl()),
    run: async (box, cmd, { background = false, cwd, env, user, timeoutMs, stdin, onStdout, onStderr } = {}) => {
      // The SDK's CommandHandle appends every chunk to its private _stdout/_stderr for the command's whole life. A
      // stdin handle is the long-lived model relay, whose stdout carries every request body: empty both after each
      // delivered chunk, or worca's memory grows by every body until V8's string limit drops the relay. The SDK calls
      // the callbacks with the handle as `this`, which also covers chunks delivered before commands.run resolves.
      // test/exec-env-fake.test.mjs fails if a pinned SDK upgrade renames the field.
      let handle = null;
      const drain = (self) => { const h = handle || self; if (h && typeof h._stdout === 'string') { h._stdout = ''; h._stderr = ''; } };
      const drained = (fn) => function (d) { try { return fn?.(d); } finally { drain(this); } };
      const out = stdin ? drained(onStdout) : onStdout; const err = stdin ? drained(onStderr) : onStderr;
      const r = await box.commands.run(cmd, {
        ...(background ? { background: true } : {}), ...(stdin ? { stdin: true } : {}), ...(cwd !== undefined ? { cwd } : {}), ...(env !== undefined ? { envs: env } : {}),
        ...(user ? { user } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(out ? { onStdout: out } : {}), ...(err ? { onStderr: err } : {}) });
      if (stdin) { handle = r; drain(r); }
      return r;
    },
    readFile: async (box, path) => Buffer.from(await box.files.read(path, { format: 'bytes', requestTimeoutMs: FILE_REQUEST_TIMEOUT_MS })),
    writeFile: (box, path, data) => box.files.write(path, new Blob([data]), { requestTimeoutMs: FILE_REQUEST_TIMEOUT_MS }),
    setTimeout: (box, ms) => box.setTimeout(ms),
    classifyError: (err) => (isSandboxGone(err, sdk) ? 'gone' : isSandboxUnreachable(err, sdk) ? 'unreachable' : null),
    describe: () => `key ${conn.keyHint}`,
    /** worca-agent + the spec's tools as ONE single-stage Dockerfile (design §18, decision D6). */
    async buildEnvironment(spec, { name, onLog = () => {} }) {
      // The mock-mode fake (e2b-fake.mjs) has no Template API: say so rather than suggest an install.
      if (mock) throw new Error('E2B templates cannot be built in mock mode (the loopback fake has no Template API)');
      if (typeof sdk.Template !== 'function' || typeof sdk.Template.build !== 'function') {
        throw new Error('this e2b SDK cannot build templates (no Template API); install e2b@2.56.0');
      }
      const version = pinnedClaudeCodeVersion();
      const tpl = sdk.Template().fromDockerfile(renderProjectDockerfile(spec, { version }));
      const size = await baseTemplateSize(sdk, conn, onLog);
      const info = await sdk.Template.build(tpl, name, { ...conn.opts, ...size,
        onBuildLogs: (e) => onLog(String(e?.message ?? e)) });
      return { name: info?.name || name, id: info?.templateId ?? null, buildId: info?.buildId ?? null,
        specHash: spec.hash, baseVersion: e2bBaseVersion({ version }) };
    },
  };
}

// fetch hides why it failed in `cause` ('fetch failed' + ECONNREFUSED, a bad port, a TLS error).
const errText = (err) => { const why = err?.cause?.code || err?.cause?.message; return `${err?.message || err}${why ? ` (${why})` : ''}`; };

/** The live status of the E2B server `env` points at (backend.mjs status): one running-sandbox list, capped at
 *  STATUS_REQUEST_TIMEOUT_MS. A 401 is a refused key; anything else that fails is unreachable. Never throws. */
async function e2bStatus({ env = process.env, mock = false } = {}) {
  const server = mock ? 'the loopback fake (mock mode)' : e2bServerIdentity(env).label;
  if (!mock && !env.E2B_API_KEY) return { state: 'not-configured', server, error: "E2B_API_KEY is not set in the worca server's environment" };
  let sdk;
  try { const { loadE2b } = await import('../e2b-sdk.mjs'); sdk = await loadE2b({ mock }); }
  catch (err) { return { state: 'not-configured', server, error: errText(err) }; }
  try {
    const running = await e2bClient(sdk, e2bConnection(env), { mock }).countRunning({ timeoutMs: STATUS_REQUEST_TIMEOUT_MS });
    return { state: 'connected', server, running };
  } catch (err) {
    return { state: err && named(err, sdk, 'AuthenticationError') ? 'key-refused' : 'unreachable', server, error: errText(err) };
  }
}

const FROM = { project: 'the project setting', build: "the project's build", env: 'WORCA_E2B_TEMPLATE', default: 'the default' };

export const e2bBackend = Object.freeze({
  name: 'e2b',
  label: 'E2B sandbox',
  title: 'E2B',
  environmentNoun: 'template',
  workDir: '/tmp/worca-e2b',
  capabilities: Object.freeze({ pause: false, buildEnvironment: true,
    defaultMaxConcurrent: DEFAULT_E2B_MAX_SANDBOXES, defaultMaxWaitMin: DEFAULT_E2B_MAX_WAIT_MIN }),
  limitSettings: Object.freeze({ maxConcurrent: 'e2bMaxSandboxes', maxWaitMin: 'e2bMaxWaitMin' }),
  secretEnv: /^(E2B_|WORCA_E2B_)/,
  projectFields: Object.freeze([Object.freeze({ key: 'template', label: 'E2B template',
    hint: 'an E2B template name (lowercase letters, digits, - and _, optional :tag)', validate: (v) => TEMPLATE_RE.test(v) })]),
  // e2bPreflight also runs the generic remotePreflight; the harness de-duplicates (A9), so the 409 text is today's.
  preflight: (ctx) => e2bPreflight({ ...ctx, sdkInstalled: e2bInstalled }),
  configured: (env = process.env) => !!env.E2B_API_KEY && e2bInstalled(),
  async open({ mock = false, env = process.env } = {}) {
    const { loadE2b } = await import('../e2b-sdk.mjs');
    return e2bClient(await loadE2b({ mock }), e2bConnection(env), { mock });
  },
  /** Fallback order (clarify template-precedence): project setting → build record → WORCA_E2B_TEMPLATE → worca-agent.
   *  `build` is null when it was made on another server (project-env.mjs usableBuild). */
  resolveEnvironment({ config = {}, build = null, env = process.env } = {}) {
    const pick = (name, source) => ({ name, source, from: FROM[source] });
    if (typeof config.template === 'string' && config.template) return pick(config.template, 'project');
    if (typeof build?.name === 'string' && build.name) return pick(build.name, 'build');
    if (env.WORCA_E2B_TEMPLATE) return pick(env.WORCA_E2B_TEMPLATE, 'env');
    return pick(E2B_DEFAULT_TEMPLATE, 'default');
  },
  serverIdentity: (env = process.env) => e2bServerIdentity(env),
  status: (o) => e2bStatus(o),
  baseVersion: () => e2bBaseVersion(),
  environmentName: (projectKey) => e2bEnvironmentName(projectKey),
});

/** `worca-agent-<projectKey>`, at most 63 chars (TEMPLATE_RE): a long slug is cut, its `-<8 hex>` hash kept. */
export function e2bEnvironmentName(projectKey) {
  const name = `${E2B_DEFAULT_TEMPLATE}-${projectKey}`;
  if (name.length <= 63) return name;
  const hash = projectKey.slice(-9);                                        // '-' + 8 hex (store.mjs PROJECT_KEY_RE)
  return `${name.slice(0, 63 - hash.length).replace(/-+$/, '')}${hash}`;
}
