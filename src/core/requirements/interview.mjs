// src/core/requirements/interview.mjs
// Runs the interview (plans/requirements-design.md §4): one orientation pass that may read the code
// through the classifier's repo look (D7), then rounds that are single tool-less model calls. One job
// per feature at a time; a job never throws out — a failure becomes an `error` turn and the feature goes
// back to the product owner. Spend is checked before every call and booked after it (D9).
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { normalizingOnEvent } from '../engines/claude-events.mjs';
import { resolveModelEnv, resolveModelCost, listModels } from '../config.mjs';
import { safeParseJson } from '../protocol.mjs';
import { budgetStatus, recordRequirementsCostDelta } from '../cost-budget.mjs';
import { openRepoLook, openWorkspaceRepoLook } from '../auto/repo-look.mjs';
import { gitAvailable } from '../git-available.mjs';
import { tx } from '../db.mjs';
import { REPO_LOOK_TOOLS, REPO_LOOK_MAX_TURNS, REPO_LOOK_TIMEOUT_MS } from '../auto/classify.mjs';
import { worcaHome, listProjects } from '../projects.mjs';
import { utilityModelFor } from '../settings-cascade.mjs';
import { withRole } from '../model-roles.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { RequirementsError, MAX_ROUNDS, LIMITS, clip } from './spec.mjs';
import { unaskedRejections, unaskedFiles } from './ready.mjs';
import {
  requireFeature, getFeature, updateFeature, appendTurn, listTurns, getContext, addFeatureCost, listFeatures, usableBrief, listAttachments,
} from './store.mjs';
import { renderBriefForPrompt } from './brief.mjs';
import {
  ROUND_SYSTEM_PROMPT, ORIENTATION_SYSTEM_PROMPT, buildRoundPrompt, buildOrientationPrompt, applyRound,
  normalizeOrientation, mockRoundReply, RoundError, removedCriteria, pendingRound,
} from './round.mjs';
import { readsSettled, queueUnread, promptFiles, isReading, filesPending } from './attachment-job.mjs';
import { isStarting, STARTING_MESSAGE } from './starting.mjs';

export const ROUND_TIMEOUT_MS = 180_000;
const DEFAULTS = Object.freeze({
  runClaudeImpl: runClaude, listModels, listProjects, workspaceTarget,
  openLook: openRepoLook, openWorkspaceLook: openWorkspaceRepoLook, budget: () => budgetStatus(), onChange: () => {},
  userSignIn: () => userSignInLogged(),
  // Model roles (D3): an unset interview slot takes the everyday role.
  interviewSlot: () => withRole(utilityModelFor('claude', 'requirementsInterview'), 'claude', 'requirementsInterview'),
});

// Keys of the user settings' `env` block that sign Claude Code in or route its traffic (A1.1 D6).
const SIGN_IN_ENV_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_EXTRA_CA_CERTS', 'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
]);
const isSignInEnvKey = (k) => SIGN_IN_ENV_KEYS.has(k) || /^https?_proxy$/i.test(k) || k.startsWith('ANTHROPIC_')
  || k.startsWith('CLAUDE_CODE_USE_') || k.startsWith('AWS_');

/**
 * Whether the user-level Claude Code settings carry sign-in or network configuration (A1.1 D6): a
 * non-empty `apiKeyHelper`, `awsAuthRefresh` or `awsCredentialExport`, or an `env` block with CLAUDE_CODE_OAUTH_TOKEN,
 * CLAUDE_CODE_USE_* (Vertex, Bedrock, Foundry...), AWS_*, CLOUD_ML_REGION, GOOGLE_APPLICATION_CREDENTIALS,
 * CLAUDE_CODE_CLIENT_CERT / _KEY, ANTHROPIC_*, HTTP(S)_PROXY (either case) or NODE_EXTRA_CA_CERTS. Then an interview keeps all setting sources, since
 * `--setting-sources project` would drop that file and the call would not be signed in. The file is the
 * one the CLI reads: `settings.json` in CLAUDE_CONFIG_DIR, else in `<home>/.claude` (as
 * skills-registry/host.mjs). A MISSING file (ENOENT / ENOTDIR), a blank one, or valid JSON that is not an object means false
 * (hermetic); a file that exists but cannot be read or parsed means true (keep user settings, A2's behaviour). Never throws.
 * Not seen: a model profile's modelEnv can set CLAUDE_CONFIG_DIR / HOME for the child, which moves the file the CLI
 * reads; this guard looks at the server's own environment only.
 */
export function userClaudeSignIn({ env = process.env, home, read = (p) => readFileSync(p, 'utf8') } = {}) {
  try {
    const dir = typeof env?.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim()
      ? env.CLAUDE_CONFIG_DIR.trim() : join(home ?? homedir(), '.claude');   // homedir() can throw: inside the try
    let raw;
    try { raw = String(read(join(dir, 'settings.json'))); } catch (err) {
      return !(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'));   // missing: hermetic; unreadable: keep
    }
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;   // a leading BOM is tolerated
    if (!text.trim()) return false;   // a blank file holds no sign-in: hermetic
    let s;
    try { s = JSON.parse(text); } catch { return true; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    for (const key of ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']) if (typeof s[key] === 'string' && s[key] !== '') return true;
    const e = s.env;
    return !!e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).some(isSignInEnvKey);
  } catch { return false; }
}

let signInLogged = false;
/** The default `userSignIn`: the check, and the first time it keeps the user settings, one log line. */
function userSignInLogged() {
  const keep = userClaudeSignIn();
  if (keep && !signInLogged) {
    signInLogged = true;
    console.warn('[worca] requirements: user Claude settings carry or may carry sign-in; keeping them for interviews');
  }
  return keep;
}

/** At most this many requirements jobs (looks and rounds, across all features) run at once. */
export const MAX_JOBS = 4;
const jobs = new Map();
export const isBusy = (seq) => jobs.has(Number(seq));
/** A8 D2: the longest round 1 waits for the reads of a new feature's files. */
export const ROUND1_WAIT_MS = 360_000;
const waitingReads = new Set();   // features whose create job waits for its reads: not counted against MAX_JOBS
const activeJobs = () => jobs.size - waitingReads.size;
let slotWaiters = [];   // resolvers woken whenever a slot may have come free: a job ended or started waiting
function slotFreed() { const w = slotWaiters; slotWaiters = []; for (const r of w) r(); }
/** A waiting job leaves the waiting set once a slot is free, checked again (synchronously) at every slotFreed. */
async function takeSlot(seq) {
  await null;   // startJob has registered the job (and its waiting mark) by now
  while (activeJobs() >= MAX_JOBS) await new Promise((r) => { slotWaiters.push(r); });
  waitingReads.delete(seq);
}
/** `p`, or nothing once `ms` have passed. */
const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t)); };
/** Throws BUSY when MAX_JOBS jobs are running (a create waiting for its files' reads does not count): checked before
 *  anything is written for a new job. */
export function assertCapacity() {
  if (activeJobs() >= MAX_JOBS) throw new RequirementsError('BUSY', 'Worca is working on several features; try again in a moment.');
}
/** Resolves when the feature's current job (if any) has finished. Tests and the routes' callers await it. */
export const settled = (seq) => jobs.get(Number(seq)) || Promise.resolve();

const message = (err) => (err && err.message ? err.message : String(err));
const scratchDir = () => { const d = join(worcaHome(), 'tmp', 'requirements'); mkdirSync(d, { recursive: true }); return d; };

/** D8: the first plain (not [1m]) Opus in the catalog, which lists the newest first. */
export async function requirementsModel(list = listModels) {
  try {
    const m = (await list(null)).find((x) => x && /^claude-opus-/.test(x.id) && !x.id.includes('['));
    return m ? m.id : undefined;
  } catch { return undefined; }
}

export const DEFAULT_INTERVIEW_EFFORT = 'medium';

/**
 * A1.1 D2: the model and effort of an interview call. The stored `requirementsInterview` pair counts for
 * its model only while the catalog still lists it (a failing catalog read: it counts); otherwise the
 * default Opus applies, with the default effort unless the pair names one. Unset = the default pair.
 * `source` is 'settings' when a stored model or effort was used. Never throws.
 */
export async function interviewModel(deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  let slot = {};
  try { slot = d.interviewSlot() || {}; } catch { slot = {}; }
  let stored = null;
  if (typeof slot.model === 'string' && slot.model) {
    stored = slot.model;   // a failing catalog read: it counts as stored
    try {
      const want = slot.model.toLowerCase();
      const hit = (await d.listModels(null)).find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === want);
      stored = hit ? hit.id : null;   // the catalog's spelling, so label and cost lookups agree
    } catch { /* keep it */ }
  }
  const model = stored || await requirementsModel(d.listModels);
  const effort = slot.effort || (stored ? null : DEFAULT_INTERVIEW_EFFORT);
  return { model: model ?? null, effort: effort || null, source: stored || slot.effort ? 'settings' : 'default' };
}

/** `job.kind` says what is running ('look' or 'round'): an error turn records it so retry re-runs the right thing.
 *  `waiting` (A8 D2): the job starts outside MAX_JOBS and takes a slot itself (takeSlot) before it calls a model. */
function startJob(seq, d, fn, by, kind = 'round', { waiting = false } = {}) {
  seq = Number(seq);
  if (jobs.has(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  assertCapacity();
  const p = (async () => {
    const job = { kind };
    try { await fn(job); }
    catch (err) {
      try { failTurn(seq, { code: err?.code || 'FAILED', message: message(err), job: job.kind }, by, failedStatus(seq, job.kind)); }
      catch (e) { console.error('requirements: could not record the failure:', message(e)); }
    } finally {
      jobs.delete(seq);
      waitingReads.delete(seq);
      slotFreed();
      // A8 D8: a job that kept Worca's own follow-up from starting (a look or a round while a read ended) lets it start now.
      // No loop: a round that carried every file leaves none unasked, and a follow-up never starts while a read is pending.
      if (!filesPending({ type: 'feature', id: seq })) maybeFollowUpFiles(seq, d);
      notify(d, seq);
    }
  })();
  jobs.set(seq, p);
  if (waiting) waitingReads.add(seq);
  return p;
}

function notify(d, seq) {
  try { d.onChange(seq); }
  catch (e) { console.error('requirements: onChange failed:', message(e)); }
}

const isArchived = (seq) => getFeature(seq)?.status === 'archived';

/** The one way a failure is recorded: an error turn (with whatever the failed work cost, booked too), then the status. */
function failTurn(seq, { code, message: msg, job, costUsd = 0, model = null }, by, status) {
  const turnId = appendTurn(seq, { kind: 'error', payload: { code, message: msg, job }, model: model || null, costUsd: costUsd || null }, { by });
  charge(seq, turnId, costUsd, model);
  setStatus(seq, status, by);
}

/** Writes a status, but never over an archive that happened while the job ran. */
function setStatus(seq, status, by, extra = {}) {
  const now = getFeature(seq);
  updateFeature(seq, { ...extra, status: now && now.status === 'archived' ? 'archived' : status }, { by });
}

function assertBudget(d) {
  const b = d.budget();
  if (b && b.blocked) {
    throw new RequirementsError('BUDGET', `The spending limit${b.totalLimitUsd != null ? ` of $${b.totalLimitUsd}` : ''} is reached for this period. The interview continues when the limit resets or is raised.`);
  }
}

/** The cost on the feature and its ledger row, in one transaction: both or neither (the brief's book() does the same). */
function charge(seq, turnId, costUsd, model) {
  if (!(costUsd > 0)) return;
  tx(() => {
    addFeatureCost(seq, costUsd);
    recordRequirementsCostDelta({ featureSeq: seq, turnId, amountUsd: costUsd, model: model || null });
  });
}

const CALL_KINDS = Object.freeze({
  look: () => ({ systemPrompt: ORIENTATION_SYSTEM_PROMPT, tools: REPO_LOOK_TOOLS, maxTurns: REPO_LOOK_MAX_TURNS }),
  round: () => ({ systemPrompt: ROUND_SYSTEM_PROMPT, tools: [], maxTurns: null }),
});
const CALL_KEYS = new Set(['cwd', 'prompt', 'model', 'systemPrompt', 'tools', 'allowedTools', 'maxTurns', 'effort', 'permissionRules', 'readGuard', 'noSessionPersistence']);

/**
 * The runClaude options of one interview call, without `signal` / `onEvent` (design §9, the lane contract).
 * `kind` is 'look' or 'round'; systemPrompt, tools, allowedTools, maxTurns and effort override that kind's defaults.
 * Two overrides of their own, emitted only when given (A8, plans/requirements-a8-design.md D3): `permissionRules`
 * (a file read's and the brief look's deny rules) and `readGuard` (the one file a read may open, file-read-guard.mjs),
 * which when present at all must be an absolute path: an empty or relative value throws instead of meaning "no guard".
 * A third, `noSessionPersistence: true` (D15: file reads, asks and the brief look), asks Claude Code to keep no session
 * transcript of the call; any other value emits nothing, so the other calls' options stay as they were.
 * Every call, whatever the overrides, replaces Claude Code's system prompt with Worca's and turns slash
 * commands off; it also loads only the project's setting sources (no user plugins, hooks or skills,
 * A1.1 D6) unless `keepUserSettings` (the user settings carry sign-in: `userClaudeSignIn`).
 * The measurement tool builds its calls through this too, so what it measures is what the interview sends.
 */
export function interviewCallOptions(kind, args = {}, { keepUserSettings = false } = {}) {
  if (!Object.hasOwn(CALL_KINDS, kind)) throw new TypeError(`interviewCallOptions: unknown kind ${JSON.stringify(kind)}`);
  for (const k of Object.keys(args)) if (!CALL_KEYS.has(k)) throw new TypeError(`interviewCallOptions: unknown option "${k}"`);
  const guarded = Object.hasOwn(args, 'readGuard');
  if (guarded && (typeof args.readGuard !== 'string' || !isAbsolute(args.readGuard))) {
    throw new TypeError('interviewCallOptions: readGuard must be the absolute path of the one file the call may read');
  }
  const def = CALL_KINDS[kind]();
  const { cwd, prompt, model } = args;
  const pick = (k) => (args[k] !== undefined ? args[k] : def[k]);
  const tools = pick('tools');
  if (!Array.isArray(tools)) throw new TypeError('interviewCallOptions: tools must be an array');
  // A8 §9: a file read allows one Read rule naming its copy; without the override the allow list is the tools, as before.
  const allowed = args.allowedTools !== undefined ? args.allowedTools : tools;
  if (!Array.isArray(allowed)) throw new TypeError('interviewCallOptions: allowedTools must be an array');
  const maxTurns = pick('maxTurns');
  return {
    cwd, systemPrompt: pick('systemPrompt'), systemPromptMode: 'replace', prompt, model, modelEnv: resolveModelEnv(model),
    allowedTools: [...allowed], tools: [...tools], strictMcpConfig: true,
    ...(keepUserSettings ? {} : { settingSources: ['project'] }), disableSlashCommands: true,
    ...(maxTurns ? { maxTurns } : {}),
    ...(args.effort ? { effort: args.effort } : {}),
    ...(args.permissionRules ? { permissionRules: args.permissionRules } : {}), ...(guarded ? { readGuard: args.readGuard } : {}),
    ...(args.noSessionPersistence === true ? { noSessionPersistence: true } : {}),
    permissionMode: 'acceptEdits',
    spawnKind: 'aux',   // credential broker: a short-lived token, as pr-description.mjs
  };
}

/**
 * One interview call (A1.1 §9): the built options plus a timeout, the caller's `signal` (A8: a removed file stops its
 * read) and the cost of every `result`. Resolves to `{ text, costUsd, events }`, plus `readGuardDecisions` when the
 * runner returned them (a guarded read, file-read-guard.mjs). `events` are the call's normalized events, one shape
 * only (engines/claude-events.mjs), so a read can check that the guard decided every tool call the stream shows.
 * A failed call throws with the money already spent on it as `costUsd`.
 */
export async function callModel(d, { kind, cwd, prompt, model, timeoutMs, signal = null, ...overrides }) {
  // Read per call, so a changed user settings file applies without a restart (D6).
  const keepUserSettings = !!(d.userSignIn || DEFAULTS.userSignIn)();
  const options = interviewCallOptions(kind, { cwd, prompt, model, ...overrides }, { keepUserSettings });
  const ctrl = new AbortController();
  // A8: the read job stops a read whose file was removed; the caller's signal aborts this call's own controller.
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  let costUsd = 0;
  const events = [];
  try {
    const res = await d.runClaudeImpl({
      ...options, signal: ctrl.signal,
      onEvent: normalizingOnEvent((e) => {
        events.push(e);
        if (e.type !== 'result' || e.costUsd == null) return;
        const c = resolveModelCost(model, Number(e.costUsd), e.usage ?? null);
        if (Number.isFinite(c)) costUsd += c;
        else if (Number.isFinite(Number(e.costUsd))) costUsd += Number(e.costUsd);
      }),
    });
    return { text: res?.text || '', costUsd, events, ...(Array.isArray(res?.readGuardDecisions) ? { readGuardDecisions: res.readGuardDecisions } : {}) };
  } catch (err) {
    // Money may already be spent when a call fails: the error carries it so the caller books it.
    const out = timedOut
      ? Object.assign(new Error(`Worca got no reply within ${Math.round(timeoutMs / 1000)} seconds. Try again.`), { code: 'TIMEOUT' })
      : (err instanceof Error ? err : new Error(String(err)));
    out.costUsd = costUsd;
    throw out;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function openLookFor(f, d, signal) {
  const base = scratchDir();
  if (f.scopeType === 'project') {
    const p = (await d.listProjects()).find((x) => x.key === f.scopeKey);
    return p && p.exists ? d.openLook(p.path, base, { signal }) : null;
  }
  const ws = await d.workspaceTarget(f.scopeKey);
  return ws && ws.members.length ? d.openWorkspaceLook(ws.members, base, { signal }) : null;
}

/** A7 D10: the scope's usable brief as the prompts carry it (provenance line first), or null. A8 D6: `documents`, the
 *  scope's documents as renderDocumentsForPrompt writes them, follow its sections. */
function briefFor(f, documents = '') {
  const b = usableBrief(f.scopeType, f.scopeKey);
  if (!b) return null;
  const day = String(b.madeAt).slice(0, 10);
  const src = (b.sources || [])[0];
  const provenance = f.scopeType === 'workspace'
    ? `Made from ${(b.sources || []).length} project${(b.sources || []).length === 1 ? '' : 's'} on ${day}.`
    : `Made from ${(src && src.branch) || 'HEAD'}${src && src.sha ? ` @ ${String(src.sha).slice(0, 7)}` : ''} on ${day}.`;
  return { id: b.id, madeAt: b.madeAt, text: renderBriefForPrompt(b.sections, { provenance, documents }) };
}

// Less time than this left after the checkout: the look fails as a timeout rather than starting a call it cannot finish.
const LOOK_MIN_CALL_MS = 1000;

/** D7: a short product-language summary of what exists, or why there is none. Never throws. With a brief
 *  this is A7's closer look (D11): it asks only for what the brief does not say, and for the area. */
async function orient(f, d, brief = null) {
  const ctx = getContext(f.scopeType, f.scopeKey);
  if (!ctx.lookAtCode) return { summary: '', files: [], skipped: 'off' };
  // No git on this machine: no checkout to read, so the look is skipped, recorded as 'no-git' so the page can say
  // why after git comes back (Look closer and the brief answer GIT_MISSING at the route, routes.mjs REQUIREMENTS_GIT_ROUTES).
  if (!gitAvailable()) return { summary: '', files: [], skipped: 'no-git' };
  if (mockEnabled({}) && brief) {
    return { summary: `[mock] A closer look: "${f.title}" needs something the brief does not describe yet.`, files: ['/tmp/mock/auto-look-0000abcd/README.md'], area: 'Orders', skipped: null };
  }
  if (mockEnabled({})) return { summary: `[mock] What exists around "${f.title}": orders, each with a status.`, files: [], skipped: null };
  let look = null;
  let model = null;
  // One deadline over checkout and call (as the brief job): the checkout is aborted at it, the call gets what is left.
  const deadline = Date.now() + REPO_LOOK_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPO_LOOK_TIMEOUT_MS);
  try {
    look = await openLookFor(f, d, ctrl.signal);
    if (!look) return { summary: '', files: [], skipped: 'no-repo' };
    const im = await interviewModel(d);
    model = im.model || undefined;
    if (isArchived(f.seq)) return { summary: '', files: [], skipped: 'archived' };
    const timeoutMs = deadline - Date.now();
    if (timeoutMs < LOOK_MIN_CALL_MS) throw Object.assign(new Error('Worca could not read the code in time. Try again.'), { code: 'TIMEOUT' });
    const { text, costUsd } = await callModel(d, {
      kind: 'look', cwd: look.cwd,
      prompt: buildOrientationPrompt({ feature: f, context: ctx.body, members: look.members || null, cwd: look.cwd, brief: brief ? brief.text : null }),
      model, ...(im.effort ? { effort: im.effort } : {}), timeoutMs,
    });
    return { ...normalizeOrientation(safeParseJson(text)), skipped: null, model: model || null, costUsd };
  } catch (err) {
    return { summary: '', files: [], skipped: 'failed', error: message(err), model, costUsd: Number(err?.costUsd) || 0 };
  } finally {
    clearTimeout(timer);
    if (look) await look.close();
  }
}

async function runOrientation(seq, d, by, { useBrief = false } = {}) {
  const f0 = requireFeature(seq);
  const brief = briefFor(f0, promptFiles(f0).documents);   // A8 D6: the closer look reads the brief's documents too
  // A7 D11: every stored look names the scope it was made for and the brief it was made against (null: none yet).
  // The scope cannot change while the look runs (header edits wait for the job), so it is read here.
  const stamp = { scopeType: f0.scopeType, scopeKey: f0.scopeKey, briefId: brief ? brief.id : null };
  // A7 D10: with a usable brief the automatic look is skipped, before any status, frame, budget check or call.
  if (useBrief && brief) {
    appendTurn(seq, { kind: 'orientation', payload: { summary: '', files: [], skipped: 'brief', error: null, briefMadeAt: brief.madeAt } }, { by });
    updateFeature(seq, { orientation: { summary: '', files: [], skipped: 'brief', briefMadeAt: brief.madeAt, ...stamp, at: new Date().toISOString() } }, { by });
    return;
  }
  setStatus(seq, 'looking', by);
  notify(d, seq);
  const f = requireFeature(seq);
  if (getContext(f.scopeType, f.scopeKey).lookAtCode && gitAvailable() && !mockEnabled({})) assertBudget(d);   // only when a call will follow
  const o = await orient(f, d, brief);
  if (o.skipped === 'archived') return;   // archived meanwhile: nothing was spent, nothing to record
  const turnId = appendTurn(seq, { kind: 'orientation', payload: { summary: o.summary, files: o.files, skipped: o.skipped, error: o.error || null },
    model: o.model || null, costUsd: o.costUsd || null }, { by });
  charge(seq, turnId, o.costUsd, o.model);
  updateFeature(seq, { orientation: { summary: o.summary, files: o.files, skipped: o.skipped, ...(brief && o.area ? { area: o.area } : {}), ...stamp,
    at: new Date().toISOString() } }, { by });
}

/** `followUpFiles` (A8 D8): the ids of the files a follow-up asks about; one removed since is left out (none left: an
 *  ordinary round). */
async function runRound(seq, d, by, { final = false, followUp = null, followUpFiles = null } = {}) {
  if (isArchived(seq)) return;
  queueUnread(seq, d);   // A8 D5: files a spending limit stopped are read again once it allows
  setStatus(seq, 'thinking', by);
  notify(d, seq);
  const f = requireFeature(seq);
  const found = followUp ? f.spec.assumptions.filter((a) => followUp.includes(a.id) && a.status === 'rejected').map((a) => ({ id: a.id, text: a.text })) : [];
  const followItems = found.length ? found : null;   // none left rejected: an ordinary round
  const turns = listTurns(seq);
  const files = promptFiles(f);   // A8 D6: the feature's files and the scope's documents, as the prompts carry them
  const askFiles = Array.isArray(followUpFiles) ? files.rows.filter((r) => followUpFiles.includes(r.id)) : [];
  const fileNames = askFiles.length ? askFiles.map((r) => r.name) : null;   // removed since: an ordinary round
  const isFinal = final || (!followItems && !fileNames && f.rounds + 1 >= MAX_ROUNDS);
  const brief = briefFor(f, files.documents);   // A7 D10: every round reads the scope's usable brief and records which one
  const seqs = { criteriaSeq: f.criteriaSeq, assumptionSeq: f.assumptionSeq, final: isFinal, removedCriteria: removedCriteria(turns), sources: files.sources };
  let applied = null;
  let model = null;
  let cost = 0;
  let lastErr = null;
  if (mockEnabled({})) {
    applied = applyRound(f.spec, mockRoundReply(f, isFinal, { followUp: followItems, followUpFiles: fileNames, sources: files.sources }), seqs);
  } else {
    const ctx = getContext(f.scopeType, f.scopeKey);
    const prompt = buildRoundPrompt({ feature: f, context: ctx.body, turns, final: isFinal, round: f.rounds + 1, followUp: followItems, brief: brief?.text,
      attachments: files.attachments, followUpFiles: fileNames });
    const im = await interviewModel(d);
    model = im.model || undefined;
    const effort = im.effort || undefined;
    const cwd = scratchDir();
    const fail = (code, msg) => failTurn(seq, { code, message: msg, job: 'round', costUsd: cost, model }, by, 'your_turn');
    try {
      for (let attempt = 1; attempt <= 2 && !applied; attempt += 1) {
        if (isArchived(seq)) { if (cost > 0) fail('ARCHIVED', 'The feature was archived before the next attempt.'); return; }
        assertBudget(d);   // before every call; an earlier attempt is already counted in `cost`
        const r = await callModel(d, { kind: 'round', cwd, prompt, model, ...(effort ? { effort } : {}), timeoutMs: ROUND_TIMEOUT_MS });
        cost += r.costUsd;
        try { applied = applyRound(f.spec, safeParseJson(r.text), seqs); }
        catch (err) { if (!(err instanceof RoundError)) throw err; lastErr = err; }
      }
    } catch (err) {
      // Everything spent so far (earlier attempts + the call that threw) is booked on the error turn.
      cost += Number(err?.costUsd) || 0;
      fail(err?.code || 'FAILED', message(err));
      return;
    }
  }
  if (!applied) {
    failTurn(seq, { code: 'BAD_REPLY', message: `Worca's reply could not be read (${lastErr.message}). Try again.`, job: 'round', costUsd: cost, model }, by, 'your_turn');
    return;
  }
  const turnId = appendTurn(seq, { kind: 'round', payload: { questions: applied.questions, note: applied.note, done: applied.done, final: isFinal,
    ...(followItems || fileNames ? { followUp: (followItems || []).map((a) => a.id) } : {}), ...(fileNames ? { followUpFiles: askFiles.map((r) => r.id) } : {}),
    ...(brief ? { brief: { id: brief.id, madeAt: brief.madeAt } } : {}),
    ...(files.carried.length ? { files: files.carried } : {}) },   // A8 D8: the files this round asked about (absent without any)
    model: model || null, costUsd: cost || null }, { by });
  charge(seq, turnId, cost, model);
  setStatus(seq, applied.done ? 'done' : 'your_turn', by, {
    spec: applied.spec, criteriaSeq: applied.criteriaSeq, assumptionSeq: applied.assumptionSeq, rounds: f.rounds + 1,
  });
}

function guard(seq) {
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', 'this feature is archived; restore it first');
  if (isBusy(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  assertCapacity();   // before an answers or finish turn is written for a job that could not start
  return f;
}

/** Orientation (D7), then round 1 unless `thenRound` is false ("Look again"). */
export function startOrientation(seq, { by = null, thenRound = true } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = guard(seq);
  // A7 D11: with the switch off an explicit look would overwrite the brief's skipped orientation with "off".
  if (!thenRound && !getContext(f.scopeType, f.scopeKey).lookAtCode && usableBrief(f.scopeType, f.scopeKey)) {
    throw new RequirementsError('CONFLICT', `Looking at the code is off for this ${f.scopeType === 'workspace' ? 'workspace' : 'project'}.`);
  }
  // A8 D2: round 1 waits for the reads of the files the feature was created with, at most ROUND1_WAIT_MS; then it runs
  // and lists a file still being read by name only. The waiting job does not count against MAX_JOBS (the feature is
  // busy meanwhile, as during any job: its status stays `looking` and the page says "Reading N files…"). The look before
  // it and round 1 after it each take a job slot only when one is free, so MAX_JOBS still bounds the model calls. Such a
  // job is outside MAX_JOBS from its start, so several creates in a row are all taken while their reads run.
  const waits = thenRound && listAttachments('feature', f.seq).some((r) => isReading(r.id));
  return startJob(seq, d, async (job) => {
    if (waits) await takeSlot(f.seq);
    await runOrientation(seq, d, by, { useBrief: thenRound });
    if (thenRound) {
      if (waits) {
        waitingReads.add(f.seq);
        slotFreed();
        try {
          await within(readsSettled({ type: 'feature', id: f.seq }), d.round1WaitMs ?? ROUND1_WAIT_MS);
          await takeSlot(f.seq);
        } finally { waitingReads.delete(f.seq); }
      }
      job.kind = 'round';
      await runRound(seq, d, by);
    } else setStatus(seq, restingStatus(seq), by);
  }, by, 'look', { waiting: waits });
}

/** Ask about the assumptions the product owner rejected and the files added or replaced since the interview finished
 *  (A2-D4, A8 D8): one extra round, past the round cap. `filesOnly`: Worca's own follow-up after the reads (D8). */
export function followUp(seq, { by = null, filesOnly = false } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = guard(seq);
  const turns = listTurns(seq);
  // The round waiting for answers comes first: its answers start the next round, which sees the rejection.
  if (f.status === 'your_turn' && pendingRound(turns)) throw new RequirementsError('CONFLICT', 'answer the questions waiting first');
  if (isStarting(seq)) throw new RequirementsError('BUSY', STARTING_MESSAGE);   // the run gets the spec as it is now
  const ids = filesOnly ? [] : unaskedRejections(f.spec, turns);
  // Only files whose text the prompt carries: one still being read (by name only) stays unasked for the follow-up after its read.
  const unasked = unaskedFiles(listAttachments('feature', f.seq), turns);
  const carried = unasked.length ? promptFiles(f).carried : [];
  const files = unasked.filter((id) => carried.includes(id));
  if (!ids.length && !files.length) {
    throw new RequirementsError('CONFLICT', unasked.length ? 'Worca is reading this file.' : 'nothing is waiting for a follow-up');
  }
  appendTurn(seq, { kind: 'followup', payload: { assumptions: ids, ...(files.length ? { files } : {}) } }, { by });
  return startJob(seq, d, () => runRound(seq, d, by, { followUp: ids, followUpFiles: files.length ? files : null }), by);
}

/** A8 D8: once a feature has nothing left to read or answer, files added or replaced after its interview finished get one
 *  short follow-up round, started by Worca when it can start (not busy, not archived, under MAX_JOBS, within the budget);
 *  otherwise the Decide panel offers it. Never throws. */
export function maybeFollowUpFiles(seq, deps = {}) {
  try {
    const d = { ...DEFAULTS, ...deps };
    const f = getFeature(seq);
    if (!f || f.status !== 'done' || isBusy(seq) || isStarting(seq) || activeJobs() >= MAX_JOBS) return false;
    if (!unaskedFiles(listAttachments('feature', f.seq), listTurns(seq)).length) return false;
    const b = d.budget();
    if (b && b.blocked) return false;
    followUp(seq, { by: null, filesOnly: true }, deps);
    return true;
  } catch { return false; }
}

/** Where a feature rests between jobs: done when its latest round said so, else the product owner's turn. */
function restingStatus(seq) {
  return listTurns(seq).filter((t) => t.kind === 'round').at(-1)?.payload.done ? 'done' : 'your_turn';
}

/** After a failed (or interrupted) job: a look leaves the interview where it was; a round hands the
 *  product owner the turn, since whatever started it (answers, Finish now) is still waiting for a round. */
const failedStatus = (seq, kind) => (kind === 'look' ? restingStatus(seq) : 'your_turn');

export function submitAnswers(seq, input = {}, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  guard(seq);
  const turns = listTurns(seq);
  const rt = turns.find((t) => t.kind === 'round' && t.id === Number(input.roundTurnId));
  if (!rt || !rt.payload.questions?.length) throw new RequirementsError('BAD_REQUEST', 'roundTurnId does not name a round with questions');
  const given = new Map((Array.isArray(input.answers) ? input.answers : []).filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));
  const answers = rt.payload.questions.map((q) => {
    const a = given.get(q.id) || {};
    const free = clip(a.text, LIMITS.item);
    const option = typeof a.option === 'string' && q.options.includes(a.option) ? a.option : '';
    const answer = free || option || (input.useRecommended ? (q.recommended || q.options[0]) : '');
    return { id: q.id, question: q.question, answer, recommended: !free && !option };
  });
  if (answers.some((a) => !a.answer)) throw new RequirementsError('BAD_REQUEST', 'answer every question, or use the recommended answers');
  const revises = turns.some((t) => t.kind === 'answers' && t.payload.roundTurnId === rt.id);
  appendTurn(seq, { kind: 'answers', payload: { roundTurnId: rt.id, revises, answers } }, { by });
  return startJob(seq, d, () => runRound(seq, d, by), by);
}

export function finishInterview(seq, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = guard(seq);
  if (f.status === 'done') throw new RequirementsError('CONFLICT', 'the interview is already finished');
  appendTurn(seq, { kind: 'finish', payload: {} }, { by });
  return startJob(seq, d, () => runRound(seq, d, by, { final: true }), by);
}

/** Try again after an error turn: the orientation when there is none yet, else the round (final when
 *  the product owner had asked to finish). */
export function retry(seq, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = guard(seq);
  const turns = listTurns(seq).filter((t) => t.kind !== 'file');   // A8: a file's turns never hide the error Try again answers
  if (turns.at(-1)?.kind !== 'error') throw new RequirementsError('CONFLICT', 'nothing to retry');
  const lastReal = turns.filter((t) => t.kind !== 'error').at(-1);
  if (!f.orientation) return startOrientation(seq, { by }, deps);
  if (turns.at(-1).payload.job === 'look') return startOrientation(seq, { by, thenRound: false }, deps);
  if (lastReal?.kind === 'followup') {
    return startJob(seq, d, () => runRound(seq, d, by, { followUp: lastReal.payload.assumptions, followUpFiles: lastReal.payload.files || null }), by);
  }
  return startJob(seq, d, () => runRound(seq, d, by, { final: lastReal?.kind === 'finish' }), by);
}

/** Boot sweep: a feature left looking/thinking by a restart gets an error turn naming the job that was cut
 *  short (so Try again re-runs that job: a look, not a paid round) and rests where a failed job of that kind would. */
export function recoverInterrupted() {
  let n = 0;
  for (const f of listFeatures({ archived: true })) {
    if ((f.status !== 'looking' && f.status !== 'thinking') || isBusy(f.seq)) continue;
    const job = f.status === 'looking' ? 'look' : 'round';
    const msg = job === 'look'
      ? 'The look at the code did not finish because Worca restarted. Try again.'
      : 'The last round did not finish because Worca restarted. Try again.';
    appendTurn(f.seq, { kind: 'error', payload: { code: 'INTERRUPTED', message: msg, job } });
    updateFeature(f.seq, { status: failedStatus(f.seq, job) });
    n += 1;
  }
  return n;
}
