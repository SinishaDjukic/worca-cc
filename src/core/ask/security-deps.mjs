// src/core/ask/security-deps.mjs
// The chat's security readers (docs/chat.md "Security and sandboxes"): the instance's security posture (the same rows as
// Settings › General › Security, src/core/security-posture.mjs), the execution environments with their readiness, slots
// and limits, a project's sandbox environment, and a run's sandbox state. The ONE module that reads them for the chat
// (tools.mjs imports nothing).
//
// Where they run: the live facts (the proxy's state, the slot queue, a run's "waiting for a slot") live in the worca
// server. The classic MCP child asks them over the per-turn proxy bridge (POST /api/ask/proxy, loopback only, one
// token per turn: proxy-deps.mjs); the relay (agent isolation) runs the tools in the server, so it reads them here.
// Nothing here returns a login, a hash, a token, a key or the value of a secret variable.
import { securityPosture, whereWorcaRuns, WHERE_LABEL } from '../security-posture.mjs';
import { describeExecEnvs, listExecBackends, getExecBackend, isExecEnvName } from '../exec-env/index.mjs';
import { currentSpecHash } from '../exec-env/box-image.mjs';
import { execEnvStatuses } from '../exec-env/status.mjs';
import { remotePreflight } from '../exec-env/policy.mjs';
import { projectExecEnvView } from '../exec-env/project-env.mjs';
import { latestBuildJob, publicBuildJob } from '../exec-env/build.mjs';
import { execEnvSetting, execEnvLimit, runRootMode } from '../settings.mjs';
import { readRemoteAccessConfig, isRemoteMode } from '../remote-access.mjs';
import { brokerEnabled } from '../broker-client.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { execEnvOfRow } from '../artifacts.mjs';
import { REMOTE_ENGINES } from '../../shared/exec-env.mjs';
import { validateEnvSpecChange, validateEnvBuild, validateSandboxConfig } from './env-proposal.mjs';
import { flagEnabled } from '../flags.mjs';
import { securityToolFamily } from './security-tools.mjs';

/** The docs the chat cites for these questions (by path, as it cites every doc). */
export const SECURITY_DOCS = Object.freeze(['docs/choose-a-setup.md', 'docs/security-overview.md', 'docs/hardened-box.md',
  'docs/local-sandbox.md', 'docs/e2b.md', 'docs/shared-instance.md', 'docs/environment-spec.md', 'docs/network-proxy.md']);

/** What an operator sets up and the chat never changes (rule 27). */
export const OPERATOR_ONLY_TEXT = 'The credential broker, agent users, the outbound allow-list and the box base image are set up by whoever runs this Worca (an operator), outside Worca: the chat cannot change them. See docs/security-overview.md and docs/hardened-box.md.';

/** The operator-managed proxy login (docs/network-proxy.md "A login the operator manages"). */
export const PROXY_MANAGED_TEXT = 'The proxy login is managed by the operator: nobody logs in or out from Worca. When the proxy rejects it, the operator must replace the login file (WORCA_EGRESS_LOGIN_FILE).';

const remoteModeOf = (env) => { try { return isRemoteMode(readRemoteAccessConfig(env)); } catch { return false; } };
const execEnvDefault = () => { try { return execEnvSetting() || 'local'; } catch { return 'local'; } };
const labelOf = (name) => describeExecEnvs().find((e) => e.name === name)?.label || name;
// A backend's server label can carry a redacted key ("E2B Cloud (key e2b_…abcd)"): never in a chat answer.
const cleanServer = (s) => (typeof s === 'string' ? s.replace(/\s*\(key [^)]*\)/gi, '').trim() || null : null);
const one = (s) => (typeof s === 'string' ? s.replace(/[\r\n]+/g, ' ').trim().slice(0, 400) : null);

/** proxyHost.chatStatus()'s shape → the fields securityPosture reads (proxyHost.status()'s): never the login itself. */
export function postureProxyOf(cs) {
  if (!cs || typeof cs !== 'object') return null;
  if (!cs.upstream || typeof cs.upstream === 'string') return { state: cs.state, error: cs.error || null, upstream: cs.upstream || null,
    login: cs.login && (cs.login.present || cs.login.label) ? { label: null } : null, managed: !!cs.managed, sidecar: !!cs.sidecar };
  return { state: cs.state, error: cs.error || null, upstream: cs.upstream.hostPort || null,
    login: cs.login && cs.login.present ? { label: null } : null, managed: !!cs.managed, sidecar: !!cs.sidecar };
}

/** The posture payload (GET /api/security/posture's), for the chat: no row carries a login label. */
export async function postureForChat({ env = process.env, proxyStatus = null } = {}) {
  let proxy = null;
  try { proxy = typeof proxyStatus === 'function' ? postureProxyOf(await proxyStatus()) : null; } catch { proxy = null; }
  const name = execEnvDefault();
  const p = securityPosture({ env, remoteMode: remoteModeOf(env), execEnvDefault: name, execEnvLabel: labelOf(name), proxy, specHashOf: currentSpecHash });
  return {
    where: p.where, whereLabel: p.whereLabel,
    rows: p.rows.map(({ id, label, status, value, detail, title }) => ({ id, label, status, value, detail,
      ...(title && id !== 'proxy' ? { title } : {}) })),
    execEnv: p.execEnv,
    ...(p.boxImage ? { boxImage: { state: p.boxImage.state, summary: p.boxImage.summary, reasons: p.boxImage.reasons, command: p.boxImage.command } } : {}),
    ...(proxy && proxy.managed ? { proxyManaged: PROXY_MANAGED_TEXT } : {}),
    changeFromChat: OPERATOR_ONLY_TEXT,
    docs: SECURITY_DOCS,
  };
}

const PROXY_WORD = { 'This machine': 'file', Sidecar: 'sidecar', Operator: 'operator-managed', Rejected: 'operator-managed', 'No proxy': 'none', 'No login': 'none' };
const NET_WORD = { Open: 'open', 'Allow-list': 'allow-list', 'Deny list': 'deny-list' };

/** The [worca context] security: line's facts, from a posture: "unknown" items are dropped. */
export function securityLineFacts(posture) {
  if (!posture || !Array.isArray(posture.rows)) return null;
  const row = (id) => posture.rows.find((r) => r.id === id) || null;
  const onOff = (r) => (r && (r.status === 'on' || r.status === 'off') ? r.status : null);
  const net = row('network'); const px = row('proxy');
  const ee = posture.execEnv || {};
  return {
    setup: posture.where === 'hardened' ? 'hardened-box' : posture.where,
    ...(onOff(row('broker')) ? { broker: onOff(row('broker')) } : {}),
    ...(onOff(row('agents')) ? { agentUsers: onOff(row('agents')) } : {}),
    ...(net && net.status !== 'unknown' && NET_WORD[net.value] ? { network: NET_WORD[net.value] } : {}),
    ...(px && px.status !== 'unknown' && PROXY_WORD[px.value] ? { proxyLogin: PROXY_WORD[px.value] } : {}),
    ...(ee.name ? { execEnv: ee.name, sandboxed: ee.sandboxed === true } : {}),
  };
}

// ── the secret vault (the secretVault flag; docs/secrets.md) ──
// Read with no OS key store call: where Worca runs, the flag, the counts by kind from the config files and the server's
// last status (last-status.mjs). Its modules load only with the flag on.
const VAULT_STATE_WORD = Object.freeze({ on: 'on', off: 'off', interrupted: 'migration-pending', locked: 'locked',
  unavailable: 'key-store-unavailable', unreadable: 'unreadable', container: 'not-available-in-container' });

/** The security: line's vault item: on | off | pending | container, or null with the flag off. Never throws. */
export async function vaultLineFact({ env = process.env } = {}) {
  try {
    if (!flagEnabled('secretVault')) return null;
    const { vaultUnavailableHere } = await import('../secrets/place.mjs');
    if (vaultUnavailableHere(env)) return 'container';
    const { secretCounts } = await import('../secrets/summary.mjs');
    const { totalOf } = await import('../../shared/secret-vault-view.mjs');
    const c = secretCounts();
    const inFiles = totalOf(c.files);
    return inFiles === 0 ? 'on' : totalOf(c.vault) > 0 ? 'pending' : 'off';
  } catch { return null; }
}

/**
 * get_secrets_status's answer: the vault's state in words, the key store's name, how many secrets of each kind are in
 * the vault and still in files, and the last check. Never a value, a secret's name, a key or a path into the key store.
 */
export async function secretsForChat({ env = process.env } = {}) {
  if (!flagEnabled('secretVault')) return { state: 'flag-off', docs: ['docs/secrets.md'] };
  const { vaultUnavailableHere } = await import('../secrets/place.mjs');
  const { vaultModel } = await import('../../shared/secret-vault-view.mjs');
  const changeFromChat = 'Turning the vault on, Check now, Reset and Export are the user\'s own steps: Settings › General › Secret vault, or worca secrets in a terminal. The chat changes nothing here.';
  if (vaultUnavailableHere(env)) {
    const m = vaultModel({ state: 'container' });
    return { state: VAULT_STATE_WORD.container, summary: m.value, detail: m.detail, changeFromChat, docs: ['docs/secrets.md', 'docs/credential-broker.md'] };
  }
  const { secretCounts } = await import('../secrets/summary.mjs');
  const { lastStatus } = await import('../secrets/last-status.mjs');
  const counts = secretCounts();
  const last = lastStatus();
  const m = vaultModel(last ? { state: last.state, vault: last.vault, label: last.label } : { state: 'ready', vault: 'unknown' }, counts);
  return { state: VAULT_STATE_WORD[m.state] || m.state, summary: m.value, detail: m.detail,
    ...(last && last.label ? { keyStore: last.label } : {}), inVault: counts.vault, inFiles: counts.files,
    lastCheck: last && last.checkedAt ? last.checkedAt : 'not checked yet (Settings › General › Secret vault checks it)',
    changeFromChat, docs: ['docs/secrets.md'] };
}

/** The header's facts for this message: the posture with the proxy state asked for at most `timeoutMs` (a sidecar
 *  that does not answer drops the proxy item, never the message). Never throws: null when nothing can be read. */
export async function askSecurityFacts({ env = process.env, proxyStatus = null, timeoutMs = 400 } = {}) {
  try {
    let timer;
    const bounded = typeof proxyStatus === 'function' ? () => Promise.race([Promise.resolve().then(proxyStatus),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); timer.unref?.(); })]).finally(() => clearTimeout(timer)) : null;
    const facts = securityLineFacts(await postureForChat({ env, proxyStatus: bounded }));
    const vault = facts ? await vaultLineFact({ env }) : null;
    return facts && vault ? { ...facts, vault } : facts;
  } catch { return null; }
}

/** The run state's sandbox fields (the run page's words), or null on a local run. `state` = orch.state. */
export function liveExecEnvView(state) {
  if (!state || typeof state !== 'object' || typeof state.execEnv !== 'string' || !state.execEnv || state.execEnv === 'local') return null;
  const review = Array.isArray(state.execEnvReview) ? state.execEnvReview.slice(0, 50).map((i) => ({ path: one(i && i.path), why: one(i && i.why) })) : [];
  return { name: state.execEnv, label: isExecEnvName(state.execEnv) ? labelOf(state.execEnv) : state.execEnv,
    ...(state.execEnvWaiting ? { waitingForSlot: true } : {}),
    ...(state.execEnvPreparing ? { preparing: one(String(state.execEnvPreparing)) } : {}),
    ...(state.execEnvWaitUntil ? { answerBy: String(state.execEnvWaitUntil) } : {}),
    ...(review.length ? { filesHeldForReview: review } : {}) };
}

/** Every execution environment: label, ready or why not, slots in use / cap, the wait limit, the default. */
export async function execEnvsForChat({ env = process.env, mock = mockEnabled(), statuses = null, remoteMode = remoteModeOf(env) } = {}) {
  let st = [];
  try { st = statuses ? await statuses() : await execEnvStatuses({ env, mock }); } catch { st = []; }
  const def = execEnvDefault();
  const where = whereWorcaRuns(env, { remoteMode });
  const local = { name: 'local', label: 'Local', default: def === 'local', ready: true, sandboxed: where !== 'native',
    note: where === 'native' ? 'Agents run on this machine as your user: not sandboxed.' : `Agents run inside this ${WHERE_LABEL[where].toLowerCase()}.` };
  const backends = listExecBackends().map((b) => {
    const s = (Array.isArray(st) ? st : []).find((x) => x && x.name === b.name);
    const srv = (s && Array.isArray(s.servers) && s.servers[0]) || {};
    const ready = srv.state === 'connected';
    return { name: b.name, label: b.label, default: def === b.name, ready, state: srv.state || 'unknown',
      ...(ready ? {} : { why: one(srv.error) || (srv.state ? `${b.title} is ${srv.state}` : `${b.title} could not be checked`) }),
      ...(cleanServer(srv.label) ? { server: cleanServer(srv.label) } : {}),
      slots: { inUse: Number.isFinite(srv.running) ? srv.running : null, cap: execEnvLimit(b, 'maxConcurrent'), waiting: Number(srv.waiting) || 0 },
      maxWaitMin: execEnvLimit(b, 'maxWaitMin'), environmentNoun: b.environmentNoun, canBuild: !!b.capabilities.buildEnvironment };
  });
  return { default: def, environments: [local, ...backends],
    limits: `A sandbox takes single git projects only, on ${REMOTE_ENGINES.join(', ')}; workspace runs, Folder projects and runs without a project stay Local; Bedrock, Vertex and Foundry models are refused.`,
    docs: ['docs/local-sandbox.md', 'docs/e2b.md', 'docs/choose-a-setup.md'] };
}

/** A project's sandbox environment: per backend its fields, the network mode, the spec, the build and whether it is
 *  current. Never a build log (it can quote anything) or a server label (it can carry a key fragment). */
export function projectEnvForChat(projectKey, { env = process.env } = {}) {
  const v = projectExecEnvView(projectKey, { jobFor: (b) => publicBuildJob(latestBuildJob(projectKey, b)), env });
  return {
    projectKey,
    spec: v.spec ? { tools: v.spec.tools || [], apt: v.spec.apt || [], hash: v.spec.hash || null, updatedAt: v.spec.updatedAt || null } : null,
    backends: v.backends.map((b) => {
      const net = (b.fields || []).find((f) => f.key === 'egress');
      return { name: b.name, label: b.label, environmentNoun: b.environmentNoun, canBuild: b.canBuild, buildName: b.buildName,
        network: net && net.value === 'allow' ? 'allow' : 'open',
        fields: (b.fields || []).filter((f) => f.key !== 'egress').map((f) => ({ key: f.key, label: f.label, value: f.value ?? null, hint: f.hint })),
        uses: b.effective ? { name: b.effective.name, from: b.effective.from } : null,
        build: b.build ? { name: b.build.name, builtAt: b.build.builtAt || null, current: !(b.stale && b.stale.stale),
          ...(b.stale && b.stale.stale ? { staleBecause: b.stale.reasons } : {}), ...(b.elsewhere ? { builtOnAnotherServer: true } : {}) } : null,
        ...(b.job ? { buildJob: { state: b.job.state, startedAt: b.job.startedAt, endedAt: b.job.endedAt, ...(b.job.error ? { error: one(b.job.error) } : {}) } } : {}) };
    }),
    docs: ['docs/environment-spec.md', 'docs/local-sandbox.md', 'docs/e2b.md'],
  };
}

/** The backend's own readiness for a run (Docker running, E2B configured, the engine's credential on the server): the
 *  run start's checks, here when a card is built. Errors only, never a value. Mock mode skips the backend part. */
export function execEnvPreflightErrors({ name, engine = 'claude', isWorkspace = false, workMode = 'git', env = process.env, mock = mockEnabled() } = {}) {
  if (!isExecEnvName(name) || name === 'local') return [];
  const b = getExecBackend(name);
  const ctx = { engine, isWorkspace, workMode, mock, env, brokerOn: (() => { try { return brokerEnabled(env); } catch { return false; } })(), runRootMode: runRootMode() };
  let own = { errors: [] };
  try { own = b.preflight(ctx); } catch (err) { own = { errors: [String(err && err.message ? err.message : err)] }; }
  return [...new Set([...remotePreflight({ title: b.title, ...ctx }), ...(own.errors || [])])];
}

/** The bridge's ops (ui/routes/chat/ask.mjs): the same answers the in-process readers give, in the server. */
export const SECURITY_BRIDGE_OPS = Object.freeze(['security-posture', 'exec-envs', 'project-env', 'run-exec-env', 'exec-preflight', 'secrets-status']);
export async function securityBridgeOp(op, body = {}, { proxyStatus = null, liveRun = () => null, env = process.env } = {}) {
  if (op === 'security-posture') return postureForChat({ env, proxyStatus });
  if (op === 'exec-envs') return execEnvsForChat({ env });
  if (op === 'project-env') return projectEnvForChat(String(body.projectKey || ''), { env });
  if (op === 'run-exec-env') { const live = liveRun(String(body.runId || '')); return liveExecEnvView(live && live.orch ? live.orch.state : null); }
  if (op === 'secrets-status') return secretsForChat({ env });
  if (op === 'exec-preflight') return execEnvPreflightErrors({ name: body.name, engine: body.engine || 'claude', isWorkspace: body.isWorkspace === true, workMode: body.workMode || 'git', env });
  throw new Error(`security: unknown op "${op}"`);
}

/** The bridge the classic child was handed this turn, or null (relay mode, an outside client). */
export function securityBridge({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let cfg = null;
  try { cfg = JSON.parse(env.WORCA_ASK_PROXY || 'null'); } catch { cfg = null; }
  const token = typeof env.ASK_PROXY_TOKEN === 'string' ? env.ASK_PROXY_TOKEN : '';
  if (!(cfg && typeof cfg.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(cfg.url) && token)) return null;
  return async (op, body = {}) => {
    const res = await fetchImpl(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worca-ask-proxy': token }, body: JSON.stringify({ ...body, op }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `worca answered HTTP ${res.status}`);
    return j.result;
  };
}

/** The sandbox preflight propose_run runs when it builds a card (proposal.mjs execEnvReady): through the bridge in the
 *  classic child (its env holds no backend key), in this process otherwise (the server, the relay). */
export function defaultExecEnvReady({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async (ctx) => {
    const bridge = securityBridge({ env, fetchImpl });
    if (bridge) { try { const r = await bridge('exec-preflight', ctx); return Array.isArray(r) ? r : []; } catch { return []; } }
    return execEnvPreflightErrors({ ...ctx, env });
  };
}

/** The tools' bundle (security-tools.mjs reads `deps.security`). `proxyStatus` / `liveRun` are the relay's in-process
 *  hooks (deps.proxy.status, deps.proxy.liveRun); the bridge wins when this turn has one. */
export function defaultSecurityDeps({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const bridge = securityBridge({ env, fetchImpl });
  const liveOf = async (runId, liveRun) => {
    if (bridge) return bridge('run-exec-env', { runId });
    const live = typeof liveRun === 'function' ? liveRun(runId) : null;
    return liveExecEnvView(live && live.orch ? live.orch.state : null);
  };
  return {
    // The tool family (security-tools.mjs) tools.mjs adds, and the cards' validators (validate only: the parent turn
    // re-validates and mints the card).
    toolFamilies: [securityToolFamily],
    envProposals: { validateSpecChange: validateEnvSpecChange, validateBuild: validateEnvBuild, validateSandboxConfig },
    security: {
      posture: ({ proxyStatus = null } = {}) => (bridge ? bridge('security-posture') : postureForChat({ env, proxyStatus })),
      execEnvs: () => (bridge ? bridge('exec-envs') : execEnvsForChat({ env })),
      projectEnv: (projectKey) => (bridge ? bridge('project-env', { projectKey }) : projectEnvForChat(projectKey, { env })),
      // The secret vault (the secretVault flag): the tool is listed only while it is on; the server answers it.
      secretsEnabled: () => { try { return flagEnabled('secretVault'); } catch { return false; } },
      secrets: () => (bridge ? bridge('secrets-status') : secretsForChat({ env })),
    },
    // get_run's sandbox fields (tools.mjs): where a run executed (its row) and, while it is live, its state.
    // A live run's state names its sandbox before its row does (the row records it at the resume point or the end).
    runExecEnvOf: async (row, deps = {}) => {
      if (!row || !row.id) return null;
      let live = null;
      try { live = await liveOf(row.id, deps && deps.proxy ? deps.proxy.liveRun : null); } catch { live = null; }
      if (live) return live;
      let name = null;
      try { name = execEnvOfRow(row); } catch { name = null; }
      return name && name !== 'local' ? { name, label: isExecEnvName(name) ? labelOf(name) : name } : null;
    },
  };
}
