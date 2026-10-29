// src/core/plugin-shim.mjs
// Ephemeral child-process shim for task-source connector operations (spec §7.2).
// One spawn per op: the child (plugin-shim-child.mjs) imports the connector
// through <plugin>/current/, runs ONE op, writes ONE JSON frame to stdout, exits.
//   stdin  : { apiVersion, module, op, config, state, args }
//   stdout : { ok:true, result, stateDelta, logs }
//          | { ok:false, error:{ kind, message }, logs }
// Config+secrets+state travel via STDIN — never argv (visible in `ps`), never env
// (inherited by grandchildren). The child env is scrubbed to {PATH, HOME}, the
// proxy variables (never a proxy URL with credentials) and the CA bundle paths, so
// plugin X can never read plugin Y's secrets or the host environment. stateDelta
// is applied HOST-side via writePluginState (the child has no WORCA_HOME and
// never touches the store). WORCA_MOCK=1 short-circuits the spawn with canned
// per-op responses so smoke/tests run offline with zero plugins installed.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFlag } from './model-env.mjs';
import { PROXY_URL_NAMES, proxyUrlHasLogin } from './env-proxy.mjs';
import { WORCA_PLUGIN_API } from './plugin-api.mjs';
import { normalizeManifest, negotiatedApi } from './plugin-manifest.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs';
import { readPluginConfig, readPluginState, writePluginState, listProfileIds, DEFAULT_PROFILE } from './plugin-config.mjs';

const CHILD_PATH = fileURLToPath(new URL('./plugin-shim-child.mjs', import.meta.url));

/** Error kinds an op can surface (spec §11) plus the host-synthesized
 *  'unimplemented' (the connector lacks the op — distinct from an implemented
 *  op that CRASHED, because callers like the capabilities probe must default
 *  differently for the two); anything else normalizes to 'plugin'. */
const KINDS = new Set(['auth', 'rate-limit', 'network', 'plugin', 'timeout', 'protocol', 'unimplemented']);

export class PluginOpError extends Error {
  /**
   * @param {'auth'|'rate-limit'|'network'|'plugin'|'timeout'|'protocol'|'unimplemented'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.name = 'PluginOpError';
    this.kind = KINDS.has(kind) ? kind : 'plugin';
  }
}

// ── WORCA_MOCK=1: canned responses, never spawns ─────────────────────────────

let _mockResponses = null; // op -> value | (args) => value; null = defaults only

/** Tests: override/extend the canned per-op responses. Pass null to reset (A6: the mock ticket numbers restart at 123). */
export function setMockSourceResponses(map) {
  _mockResponses = map && typeof map === 'object' ? map : null;
  if (!_mockResponses) resetMockTickets();
}

const MOCK_TASKS = [
  { id: 'MOCK-1', title: 'Fix the login redirect', url: 'https://mock.test/MOCK-1', state: 'open', labels: ['bug'], updatedAt: '2026-07-12T00:00:00.000Z' },
  { id: 'MOCK-2', title: 'Add CSV export to reports', url: 'https://mock.test/MOCK-2', state: 'open', labels: ['feature'], updatedAt: '2026-07-12T00:00:00.000Z' },
];
// A6 (plans/requirements-a6-design.md §4, D19): the export ops' canned answers, so the Requirements browser proof runs
// offline. Tickets are numbered <project>-123, -124, … in one sequence; the fingerprint is the description's sha256 and
// ticketState returns the last one written.
let mockTicketNo = 123;
const mockFingerprints = new Map();
function resetMockTickets() { mockTicketNo = 123; mockFingerprints.clear(); }
const mockFingerprint = (text) => createHash('sha256').update(String(text ?? '')).digest('hex');
const mockUrl = (key) => `https://mock.test/browse/${key}`;
// A6.1 (plans/requirements-a61-design.md §4, D18): the import ops' canned answers, so the Requirements browser proof runs offline.
// People are made-up names; the fake token is the repo's test token. A download writes a tiny valid body to `dest`.
const MOCK_SEARCH = Object.freeze([
  { key: 'SHOP-124', title: 'Partial cancel for multi-item orders', type: 'Story', status: 'In progress', updatedAt: '2026-10-25T12:00:00.000Z' },
  { key: 'SHOP-123', title: 'Cancel an order before it ships', type: 'Story', status: 'To do', updatedAt: '2026-10-26T12:00:00.000Z' },
  { key: 'SHOP-131', title: 'Cancel button hidden on the mobile order page', type: 'Bug', status: 'To do', updatedAt: '2026-10-24T12:00:00.000Z' },
  { key: 'SHOP-98', title: 'Refund to store credit after a cancel', type: 'Story', status: 'Done', updatedAt: '2026-10-12T12:00:00.000Z' },
]);
const MOCK_TICKET_DESCRIPTION = [
  'When an order has several items and some have already shipped, customers cannot cancel the rest. Support does it by hand today, about 40 tickets a month.',
  '', 'Customers should be able to cancel the items that have not been picked up yet, from their order history.', '', '(image: packing-slip.png)', '',
  '## Acceptance criteria', '',
  '- A customer can cancel the items of an order that have not been picked up.',
  '- Shipped items stay on the order and cannot be cancelled.',
  '- The refund covers only the cancelled items, including their share of the shipping cost.',
].join('\n');
const MOCK_COMMENTS = Object.freeze([
  ['10231', 'Ann Example', 'person', '2026-10-21T09:30:00.000Z', 'Warehouse confirms items are picked per parcel, not per item. A parcel with two items is picked up as one.'],
  ['10232', 'Bo Example', 'person', '2026-10-22T10:05:00.000Z', 'The payment provider supports partial refunds on cards and PayPal; invoiced orders need a credit note.'],
  ['10233', 'Ann Example', 'person', '2026-10-23T08:40:00.000Z', 'Finance wants the shipping share pro rata by item price.'],
  ['10234', 'Jira Automation', 'app', '2026-10-23T09:00:00.000Z', 'Status changed to In progress.'],
  ['10235', 'Cy Example', 'person', '2026-10-24T14:20:00.000Z', "Support's reply macro for partial cancels is attached (support-macro.txt). Customers ask most about when the refund arrives."],
  ['10236', 'Bo Example', 'person', '2026-10-25T11:10:00.000Z', 'Sandbox for the refund API is ready; token ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
].map(([id, author, authorKind, created, body]) => Object.freeze({ id, author, authorKind, created, body })));
const MOCK_ATTACHMENTS = Object.freeze([
  ['10041', 'packing-slip.png', 'image/png', 860160], ['10042', 'partial-cancel-flow.pdf', 'application/pdf', 1258291],
  ['10043', 'support-macro.txt', 'text/plain', 4096],
  ['10044', 'refund-matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 98304],
  ['10045', 'pick-route-scan.pdf', 'application/pdf', 32505856],
].map(([id, name, mime, bytes]) => Object.freeze({ id, name, mime, bytes, created: '2026-10-21T09:00:00.000Z' })));
const MOCK_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const mockBody = (name) => (/\.png$/i.test(name) ? MOCK_PNG : /\.pdf$/i.test(name) ? Buffer.from('%PDF-1.7\n% Worca mock\n') : Buffer.from(`Mock text of ${name}.\n`));
const mockPasted = (s) => {
  const t = String(s || '').trim();
  if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(t)) return t.toUpperCase();
  const m = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(t);
  return m ? m[1].toUpperCase() : null;
};
const MOCK_DEFAULTS = {
  listTasks: () => ({ tasks: MOCK_TASKS.map((t) => ({ ...t })) }),
  getTask: (args) => ({
    ...MOCK_TASKS[0],
    id: args?.id || MOCK_TASKS[0].id,
    body: 'Mock task body.\n\n1. reproduce\n2. fix\n3. verify',
    meta: { mock: true },
  }),
  reportResult: () => ({ ok: true }),
  validateConfig: () => ({ ok: true }),
  // Write-back stays on (what a missing capabilities op defaulted to before A6), and the mock source can export and import.
  capabilities: () => ({ writeBack: true, export: true, import: true }),
  exportOptions: (args = {}) => ({
    projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }],
    ...(args.project ? { issueTypes: [{ value: '10001', label: 'Story' }, { value: '10002', label: 'Task' }, { value: '10003', label: 'Bug' }] } : {}),
    ...(args.project && args.issueType ? {
      priorities: [{ value: '1', label: 'Highest' }, { value: '2', label: 'High' }, { value: '3', label: 'Medium' }, { value: '4', label: 'Low' }],
      criteriaFields: [{ value: 'customfield_10070', label: 'Acceptance Criteria' }, { value: 'customfield_10071', label: 'Definition of Done' }],
    } : {}),
    doneStatus: 'Done',
  }),
  createTicket: (args = {}) => {
    const t = args.ticket || {};
    const key = `${t.project || 'MOCK'}-${mockTicketNo++}`;
    mockFingerprints.set(key, mockFingerprint(t.description));
    return { key, url: mockUrl(key), fingerprint: mockFingerprints.get(key) };
  },
  updateTicket: (args = {}) => {
    mockFingerprints.set(args.key, mockFingerprint(args.ticket && args.ticket.description));
    return { key: args.key, url: mockUrl(args.key), fingerprint: mockFingerprints.get(args.key) };
  },
  commentTicket: () => ({ ok: true }),
  ticketState: (args = {}) => ({ exists: true, url: mockUrl(args.key), fingerprint: mockFingerprints.get(args.key) ?? null }),
  findTicket: () => null,
  importOptions: () => ({ projects: [{ value: 'SHOP', label: 'SHOP — Shop web' }, { value: 'OPS', label: 'OPS — Operations' }] }),
  searchTickets: (args = {}) => {
    const pasted = mockPasted(args.search);
    const words = pasted ? [] : String(args.search || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = MOCK_SEARCH.filter((t) => (pasted ? t.key === pasted
      : (!args.project || t.key.startsWith(`${args.project}-`)) && words.every((w) => t.title.toLowerCase().includes(w))))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { tickets: hits.map((t) => ({ ...t, url: mockUrl(t.key) })) };
  },
  importTicket: (args = {}) => {
    const key = String(args.key || '').toUpperCase();
    if (key === 'SHOP-999') return { gone: true };
    const known = MOCK_SEARCH.find((t) => t.key === key);
    const fp = mockFingerprint(MOCK_TICKET_DESCRIPTION);
    if (!mockFingerprints.has(key)) mockFingerprints.set(key, fp);   // A6's edited check compares with the import's fingerprint
    return {
      key, url: mockUrl(key), title: known ? known.title : MOCK_SEARCH[0].title, description: MOCK_TICKET_DESCRIPTION, criteria: null,
      comments: MOCK_COMMENTS.map((c) => ({ ...c })), commentsTotal: 7, restrictedComments: 1, attachments: MOCK_ATTACHMENTS.map((a) => ({ ...a })),
      meta: { project: key.split('-')[0], projectName: 'Shop web', type: known && known.type === 'Bug' ? { id: '10003', name: 'Bug' } : { id: '10001', name: 'Story' },
        status: known ? known.status : 'In progress', priority: { id: '3', name: 'Medium' } },
      fingerprint: fp,
    };
  },
  downloadAttachment: async (args = {}) => {
    const a = MOCK_ATTACHMENTS.find((x) => x.id === String(args.id));
    if (!a) return { gone: true };
    if (a.bytes > Number(args.maxBytes || Infinity)) return { tooLarge: true, bytes: a.bytes };
    const ms = Number(process.env.WORCA_MOCK_DOWNLOAD_MS) || 0;   // the browser proof sees Downloading… (A6.1 D18)
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const body = mockBody(a.name);
    writeFileSync(args.dest, body, { flag: 'wx', mode: 0o600 });
    return { name: a.name, mime: a.mime, bytes: body.length };
  },
};

/** Same env-flag semantics as claude-runner.mjs#mockEnabled — one shared rule. */
function mockMode() {
  return envFlag('WORCA_MOCK', 'ORCH_MOCK');
}

async function mockCall(op, args) {
  const entry = _mockResponses && op in _mockResponses ? _mockResponses[op] : MOCK_DEFAULTS[op];
  if (entry === undefined) {
    // Mirror the real child's answer for an unimplemented op — Task 13's
    // capabilities tolerant-default keys on exactly this kind.
    throw new PluginOpError('unimplemented', `mock: no canned response for op "${op}"`);
  }
  try {
    return await (typeof entry === 'function' ? entry(args) : entry);
  } catch (err) {
    if (err instanceof PluginOpError) throw err;
    throw new PluginOpError(err?.kind || 'plugin', err?.message || String(err));
  }
}

// ── real path ──────────────────────────────────────────────────────────────────

/** Resolve lock entry + manifest task-source, mapping every failure to kind 'plugin'. */
function loadSource(plugin, sourceId) {
  const lock = readPluginsLock();
  const entry = lock[plugin];
  if (!entry) throw new PluginOpError('plugin', `plugin "${plugin}" is not installed`);
  if (entry.enabled === false) throw new PluginOpError('plugin', `plugin "${plugin}" is disabled — enable it on the Marketplace page`);
  const dir = pluginCurrentDir(plugin);
  let manifest;
  try {
    const norm = normalizeManifest(JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8')), { dir });
    if (!norm.ok) throw new Error(norm.errors.join('; '));
    manifest = norm.manifest;
  } catch (err) {
    throw new PluginOpError('plugin', `plugin "${plugin}": cannot read manifest — ${err.message}`);
  }
  const source = (manifest.taskSources || []).find((s) => s.id === sourceId);
  if (!source) throw new PluginOpError('plugin', `plugin "${plugin}" has no task source "${sourceId}"`);
  // Highest host API the manifest's range allows: an API-1 connector keeps
  // receiving apiVersion 1 after a host API bump (design §4.3).
  const apiVersion = negotiatedApi(manifest.engines?.worcaApi) ?? WORCA_PLUGIN_API;
  return { dir, source, apiVersion };
}

/** Child env: PATH + HOME (spec §7.2), the proxy variables and the CA bundle
 *  paths. Notably NOT WORCA_*, tokens, npm_*. Exported for the channel-worker
 *  supervisor (chat/channel-host.mjs), which spawns persistent children under the
 *  same rule. `env` is the host env to read (tests pass a plain object: a Windows
 *  process.env answers every casing of a name). */
export function scrubbedEnv(platform = process.platform, env = process.env) {
  const child = {};
  if (env.PATH) child.PATH = env.PATH;
  if (env.HOME) child.HOME = env.HOME;
  // The proxy and CA variables are connectivity config: the child routes its
  // fetch() through them (env-proxy.mjs), or it fails on a proxy-only network,
  // and a proxy that re-signs TLS needs its CA. A proxy URL with credentials is a
  // secret, though, so then NO proxy URL passes (one alone would half-route the
  // child): it goes direct, and worca says why (withheldProxyNotice). NO_PROXY
  // and the CA paths never carry one.
  const names = proxyUrlHasLogin(env) ? NO_PROXY_NAMES : [...PROXY_URL_NAMES, ...NO_PROXY_NAMES];
  for (const k of [...names, ...CA_NAMES]) if (env[k]) child[k] = env[k];
  // Windows has no HOME and a child cannot even start without SYSTEMROOT (Node
  // docs); the rest are the non-secret system vars node/npm need to resolve
  // temp dirs, the shell, and the .cmd/.exe lookup. Still no WORCA_*, tokens
  // or npm_* — the §7.2 rule is unchanged, only the platform baseline differs.
  if (platform === 'win32') {
    for (const k of WIN32_ENV_BASELINE) if (env[k]) child[k] = env[k];
  }
  return child;
}

const NO_PROXY_NAMES = ['NO_PROXY', 'no_proxy'];
/** The CA names engines/spawn.mjs SPAWN_ENV_BASE passes too: node reads the first,
 *  the tools a connector may run (gh, curl, git, Python) the rest. */
const CA_NAMES = ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE'];

let withheldProxyNoticed = false;

/** The warning, once per process, when scrubbedEnv() withholds the proxy URLs
 *  for their credentials; null otherwise (and after the first call). It names
 *  the variables only, never a value. The UI server prints it at boot, before
 *  any plugin spawn; every other process at its first one (warnWithheldProxy). */
export function withheldProxyNotice() {
  if (withheldProxyNoticed || !proxyUrlHasLogin()) return null;
  withheldProxyNoticed = true;
  return 'proxy: HTTP(S)_PROXY carries credentials, which plugin code never receives, and the corporate proxy is not running; plugin connectors and chat channels go direct';
}

/** Every plugin spawn calls this: withheldProxyNotice() on stderr, the process's
 *  own output. Never through the caller's logger, which can be a no-op (Ask's task
 *  lookups pass one) and would spend the once-per-process warning unseen. */
export function warnWithheldProxy() {
  const text = withheldProxyNotice();
  if (text) console.error(`worca: ${text}`);
}

/** Tests: the next withheldProxyNotice() fires again. */
export function _resetWithheldProxyNotice() {
  withheldProxyNoticed = false;
}

/** Non-secret Windows system vars a child needs to run at all (spec §7.2 note). */
export const WIN32_ENV_BASELINE = Object.freeze([
  'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
]);

/** The profile invariant, enforced in the shim itself so EVERY caller — the
 *  CLI's `worca plugin exec`, future workers — is safe by construction, not
 *  just the HTTP routes. Presence alone is not enough: a typo'd or deleted
 *  profile passes a presence check, silently runs against an EMPTY bucket
 *  (false "not configured" verdicts) and then persists state into a phantom
 *  bucket the DELETE route can never purge — so membership in the roster is
 *  checked here too. `allowLegacyDefault` is the ONE host-internal exception:
 *  write-back for a pipeline row that predates profiles targets the
 *  DEFAULT_PROFILE bucket, because that is where the pre-upgrade flat config
 *  migrated — i.e. the instance the task actually came from (sources.mjs). */
function assertProfileInvariant({ plugin, sourceId, source, profile, allowLegacyDefault }) {
  if (source.multiProfile === true) {
    if (!profile) {
      throw new PluginOpError('plugin',
        `task source "${plugin}/${sourceId}" has per-profile configuration — pass a profile (e.g. --profile <id>)`);
    }
    if (profile === DEFAULT_PROFILE) {
      if (!allowLegacyDefault) {
        throw new PluginOpError('plugin',
          `"${DEFAULT_PROFILE}" is the reserved shared bucket, not a profile of "${plugin}/${sourceId}" — pass a profile from the roster`);
      }
    } else if (!listProfileIds(plugin).includes(profile)) {
      throw new PluginOpError('plugin',
        `plugin "${plugin}" has no profile "${profile}" — create it on the Marketplace page (or POST /api/plugins/${plugin}/profiles) first`);
    }
  } else if (profile && profile !== DEFAULT_PROFILE) {
    throw new PluginOpError('plugin', `task source "${plugin}/${sourceId}" does not use profiles`);
  }
}

/**
 * Run ONE connector op in an ephemeral child. Resolves with the op result;
 * rejects with PluginOpError. `logger(level, msg)` is optional — connector
 * ctx.log lines route there (default: console.error, since stdout is the UI's).
 * `allowLegacyDefault` (host-internal, never surfaced to CLI/routes) lets the
 * legacy write-back path name DEFAULT_PROFILE on a multiProfile source — see
 * assertProfileInvariant.
 * @returns {Promise<any>}
 */
export async function callSource({ plugin, sourceId, op, args = {}, profile, timeoutMs = 30000, logger, allowLegacyDefault = false } = {}) {
  const log = typeof logger === 'function'
    ? logger
    : (level, msg) => console.error(`[plugin:${plugin}] ${level}: ${msg}`);
  // Which configuration of the source to run against (plugin-config.mjs
  // profiles). Absent -> DEFAULT_PROFILE, which is what every single-profile
  // source uses, so this parameter is invisible unless a plugin opts in.
  const prof = profile || DEFAULT_PROFILE;

  if (mockMode()) {
    // Canned responses, no spawn, no plugin needed. The profile invariant still
    // holds whenever the plugin IS installed (behavioral parity so mock runs
    // catch missing/typo'd profiles too); an uninstalled plugin — the offline
    // smoke's whole point — skips it. reportResult additionally records its
    // args into the plugin state — mirroring the real-child stateDelta path —
    // so the offline smoke (Task 19) can assert write-back ran.
    let mockSource = null;
    try { mockSource = loadSource(plugin, sourceId).source; } catch { mockSource = null; }
    if (mockSource) assertProfileInvariant({ plugin, sourceId, source: mockSource, profile, allowLegacyDefault });
    const r = await mockCall(op, args);
    if (op === 'reportResult') writePluginState(plugin, { lastReport: JSON.stringify(args) }, prof);
    return r;
  }

  const { dir, source, apiVersion } = loadSource(plugin, sourceId);
  assertProfileInvariant({ plugin, sourceId, source, profile, allowLegacyDefault });
  const payload = JSON.stringify({
    apiVersion,
    module: resolve(dir, source.module), // './'-relative, '..'-free (normalizeManifest)
    op,
    // The connector sees ONE profile's config/state and is told which — a
    // connector that keeps its own storage (jira-source hangs a $JTR_CONFIG_DIR
    // off it) needs the id, not just the values.
    profile: prof,
    config: readPluginConfig(plugin, source.configSchema, prof),
    state: readPluginState(plugin, prof),
    args,
  });

  warnWithheldProxy();

  const frame = await new Promise((resolveFrame, rejectFrame) => {
    // WORCA_PLUGIN_INSPECT=1 attaches the debugger to the connector child
    // (`worca plugin exec --inspect` sets it; spec §7.2 debuggability).
    const child = spawn(process.execPath,
      [...(process.env.WORCA_PLUGIN_INSPECT ? ['--inspect-brk'] : []), CHILD_PATH], {
      env: scrubbedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const killTimer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(killTimer); fn(v); } };
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.on('error', (err) => settle(rejectFrame, new PluginOpError('protocol', `plugin "${plugin}": spawn failed — ${err.message}`)));
    child.on('close', (code) => {
      if (timedOut) {
        return settle(rejectFrame, new PluginOpError('timeout', `plugin "${plugin}" op "${op}" exceeded ${timeoutMs}ms (child killed)`));
      }
      if (code !== 0) {
        return settle(rejectFrame, new PluginOpError('protocol',
          `plugin "${plugin}" op "${op}": child exited ${code}${stderr ? ` — ${stderr.slice(0, 400)}` : ''}`));
      }
      try {
        settle(resolveFrame, JSON.parse(stdout));
      } catch {
        settle(rejectFrame, new PluginOpError('protocol',
          `plugin "${plugin}" op "${op}": non-JSON on stdout (stdout is protocol-reserved; use ctx.log) — got: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.end(payload); // config/secrets/state via stdin only
  });

  for (const l of Array.isArray(frame.logs) ? frame.logs : []) {
    log(l?.level || 'info', String(l?.msg ?? ''));
  }
  if (!frame.ok) {
    throw new PluginOpError(frame.error?.kind || 'plugin', frame.error?.message || `plugin "${plugin}" op "${op}" failed`);
  }
  if (frame.stateDelta && typeof frame.stateDelta === 'object' && Object.keys(frame.stateDelta).length) {
    writePluginState(plugin, frame.stateDelta, prof); // host-side persist; child never touches the store
  }
  return frame.result;
}
