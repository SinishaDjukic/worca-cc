// src/core/requirements/interview.mjs
// Runs the interview (plans/requirements-design.md §4): one orientation pass that may read the code
// through the classifier's repo look (D7), then rounds that are single tool-less model calls. One job
// per feature at a time; a job never throws out — a failure becomes an `error` turn and the feature goes
// back to the product owner. Spend is checked before every call and booked after it (D9).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { normalizingOnEvent } from '../engines/claude-events.mjs';
import { resolveModelEnv, resolveModelCost, listModels } from '../config.mjs';
import { safeParseJson } from '../protocol.mjs';
import { budgetStatus, recordRequirementsCostDelta } from '../cost-budget.mjs';
import { openRepoLook, openWorkspaceRepoLook } from '../auto/repo-look.mjs';
import { REPO_LOOK_TOOLS, REPO_LOOK_MAX_TURNS, REPO_LOOK_TIMEOUT_MS } from '../auto/classify.mjs';
import { worcaHome, listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { RequirementsError, MAX_ROUNDS, LIMITS, clip } from './spec.mjs';
import { unaskedRejections } from './ready.mjs';
import {
  requireFeature, getFeature, updateFeature, appendTurn, listTurns, getContext, addFeatureCost, listFeatures,
} from './store.mjs';
import {
  ROUND_SYSTEM_PROMPT, ORIENTATION_SYSTEM_PROMPT, buildRoundPrompt, buildOrientationPrompt, applyRound,
  normalizeOrientation, mockRoundReply, RoundError, removedCriteria, pendingRound,
} from './round.mjs';

const ROUND_TIMEOUT_MS = 180_000;
const DEFAULTS = Object.freeze({
  runClaudeImpl: runClaude, listModels, listProjects, workspaceTarget,
  openLook: openRepoLook, openWorkspaceLook: openWorkspaceRepoLook, budget: () => budgetStatus(), onChange: () => {},
});

/** At most this many requirements jobs (looks and rounds, across all features) run at once. */
export const MAX_JOBS = 4;
const jobs = new Map();
export const isBusy = (seq) => jobs.has(Number(seq));
/** Throws BUSY when MAX_JOBS jobs are running: checked before anything is written for a new job. */
export function assertCapacity() {
  if (jobs.size >= MAX_JOBS) throw new RequirementsError('BUSY', 'Worca is working on several features; try again in a moment.');
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

/** `job.kind` says what is running ('look' or 'round'): an error turn records it so retry re-runs the right thing. */
function startJob(seq, d, fn, by, kind = 'round') {
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
      notify(d, seq);
    }
  })();
  jobs.set(seq, p);
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

function charge(seq, turnId, costUsd, model) {
  if (!(costUsd > 0)) return;
  addFeatureCost(seq, costUsd);
  recordRequirementsCostDelta({ featureSeq: seq, turnId, amountUsd: costUsd, model: model || null });
}

const CALL_KINDS = Object.freeze({
  look: () => ({ systemPrompt: ORIENTATION_SYSTEM_PROMPT, tools: REPO_LOOK_TOOLS, maxTurns: REPO_LOOK_MAX_TURNS }),
  round: () => ({ systemPrompt: ROUND_SYSTEM_PROMPT, tools: [], maxTurns: null }),
});
const CALL_KEYS = new Set(['cwd', 'prompt', 'model', 'systemPrompt', 'tools', 'maxTurns', 'effort']);

/**
 * The runClaude options of one interview call, without `signal` / `onEvent` (design §9, the lane contract).
 * `kind` is 'look' or 'round'; systemPrompt, tools, maxTurns and effort override that kind's defaults.
 * The measurement tool builds its calls through this too, so what it measures is what the interview sends.
 */
export function interviewCallOptions(kind, args = {}) {
  if (!Object.hasOwn(CALL_KINDS, kind)) throw new TypeError(`interviewCallOptions: unknown kind ${JSON.stringify(kind)}`);
  for (const k of Object.keys(args)) if (!CALL_KEYS.has(k)) throw new TypeError(`interviewCallOptions: unknown option "${k}"`);
  const def = CALL_KINDS[kind]();
  const { cwd, prompt, model } = args;
  const pick = (k) => (args[k] !== undefined ? args[k] : def[k]);
  const tools = pick('tools');
  const maxTurns = pick('maxTurns');
  return {
    cwd, systemPrompt: pick('systemPrompt'), prompt, model, modelEnv: resolveModelEnv(model),
    allowedTools: [...tools], tools: [...tools], strictMcpConfig: true,
    ...(maxTurns ? { maxTurns } : {}),
    effort: args.effort !== undefined ? args.effort : 'medium', permissionMode: 'acceptEdits',
    spawnKind: 'aux',   // credential broker: a short-lived token, as pr-description.mjs
  };
}

export async function callModel(d, { kind, cwd, prompt, model, timeoutMs, ...overrides }) {
  const options = interviewCallOptions(kind, { cwd, prompt, model, ...overrides });
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  let costUsd = 0;
  try {
    const res = await d.runClaudeImpl({
      ...options, signal: ctrl.signal,
      onEvent: normalizingOnEvent((e) => {
        if (e.type !== 'result' || e.costUsd == null) return;
        const c = resolveModelCost(model, Number(e.costUsd), e.usage ?? null);
        if (Number.isFinite(c)) costUsd += c;
        else if (Number.isFinite(Number(e.costUsd))) costUsd += Number(e.costUsd);
      }),
    });
    return { text: res?.text || '', costUsd };
  } catch (err) {
    // Money may already be spent when a call fails: the error carries it so the caller books it.
    const out = timedOut
      ? Object.assign(new Error(`Worca got no reply within ${Math.round(timeoutMs / 1000)} seconds. Try again.`), { code: 'TIMEOUT' })
      : (err instanceof Error ? err : new Error(String(err)));
    out.costUsd = costUsd;
    throw out;
  } finally { clearTimeout(timer); }
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

/** D7: a short product-language summary of what exists, or why there is none. Never throws. */
async function orient(f, d) {
  const ctx = getContext(f.scopeType, f.scopeKey);
  if (!ctx.lookAtCode) return { summary: '', files: [], skipped: 'off' };
  if (mockEnabled({})) return { summary: `[mock] What exists around "${f.title}": orders, each with a status.`, files: [], skipped: null };
  let look = null;
  let model = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPO_LOOK_TIMEOUT_MS);
  try {
    look = await openLookFor(f, d, ctrl.signal);
    if (!look) return { summary: '', files: [], skipped: 'no-repo' };
    model = await requirementsModel(d.listModels);
    if (isArchived(f.seq)) return { summary: '', files: [], skipped: 'archived' };
    const { text, costUsd } = await callModel(d, {
      kind: 'look', cwd: look.cwd,
      prompt: buildOrientationPrompt({ feature: f, context: ctx.body, members: look.members || null }),
      model, timeoutMs: REPO_LOOK_TIMEOUT_MS,
    });
    return { ...normalizeOrientation(safeParseJson(text)), skipped: null, model: model || null, costUsd };
  } catch (err) {
    return { summary: '', files: [], skipped: 'failed', error: message(err), model, costUsd: Number(err?.costUsd) || 0 };
  } finally {
    clearTimeout(timer);
    if (look) await look.close();
  }
}

async function runOrientation(seq, d, by) {
  setStatus(seq, 'looking', by);
  notify(d, seq);
  const f = requireFeature(seq);
  if (getContext(f.scopeType, f.scopeKey).lookAtCode && !mockEnabled({})) assertBudget(d);   // only when a call will follow
  const o = await orient(f, d);
  if (o.skipped === 'archived') return;   // archived meanwhile: nothing was spent, nothing to record
  const turnId = appendTurn(seq, { kind: 'orientation', payload: { summary: o.summary, files: o.files, skipped: o.skipped, error: o.error || null },
    model: o.model || null, costUsd: o.costUsd || null }, { by });
  charge(seq, turnId, o.costUsd, o.model);
  updateFeature(seq, { orientation: { summary: o.summary, files: o.files, skipped: o.skipped, at: new Date().toISOString() } }, { by });
}

async function runRound(seq, d, by, { final = false, followUp = null } = {}) {
  if (isArchived(seq)) return;
  setStatus(seq, 'thinking', by);
  notify(d, seq);
  const f = requireFeature(seq);
  const found = followUp ? f.spec.assumptions.filter((a) => followUp.includes(a.id) && a.status === 'rejected').map((a) => ({ id: a.id, text: a.text })) : [];
  const followItems = found.length ? found : null;   // none left rejected: an ordinary round
  const isFinal = final || (!followItems && f.rounds + 1 >= MAX_ROUNDS);
  const turns = listTurns(seq);
  const seqs = { criteriaSeq: f.criteriaSeq, assumptionSeq: f.assumptionSeq, final: isFinal, removedCriteria: removedCriteria(turns) };
  let applied = null;
  let model = null;
  let cost = 0;
  let lastErr = null;
  if (mockEnabled({})) {
    applied = applyRound(f.spec, mockRoundReply(f, isFinal, { followUp: followItems }), seqs);
  } else {
    const ctx = getContext(f.scopeType, f.scopeKey);
    const prompt = buildRoundPrompt({ feature: f, context: ctx.body, turns, final: isFinal, round: f.rounds + 1, followUp: followItems });
    model = await requirementsModel(d.listModels);
    const cwd = scratchDir();
    const fail = (code, msg) => failTurn(seq, { code, message: msg, job: 'round', costUsd: cost, model }, by, 'your_turn');
    try {
      for (let attempt = 1; attempt <= 2 && !applied; attempt += 1) {
        if (isArchived(seq)) { if (cost > 0) fail('ARCHIVED', 'The feature was archived before the next attempt.'); return; }
        assertBudget(d);   // before every call; an earlier attempt is already counted in `cost`
        const r = await callModel(d, { kind: 'round', cwd, prompt, model, timeoutMs: ROUND_TIMEOUT_MS });
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
  const turnId = appendTurn(seq, { kind: 'round', payload: { questions: applied.questions, note: applied.note, done: applied.done, final: isFinal, ...(followItems ? { followUp: followItems.map((a) => a.id) } : {}) },
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
  guard(seq);
  return startJob(seq, d, async (job) => {
    await runOrientation(seq, d, by);
    if (thenRound) { job.kind = 'round'; await runRound(seq, d, by); }
    else setStatus(seq, restingStatus(seq), by);
  }, by, 'look');
}

/** Ask about the assumptions the product owner rejected since the last round: one extra round, past the round cap. */
export function followUp(seq, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = guard(seq);
  const turns = listTurns(seq);
  // The round waiting for answers comes first: its answers start the next round, which sees the rejection.
  if (f.status === 'your_turn' && pendingRound(turns)) throw new RequirementsError('CONFLICT', 'answer the questions waiting first');
  const ids = unaskedRejections(f.spec, turns);
  if (!ids.length) throw new RequirementsError('CONFLICT', 'no rejected assumption is waiting for a follow-up');
  appendTurn(seq, { kind: 'followup', payload: { assumptions: ids } }, { by });
  return startJob(seq, d, () => runRound(seq, d, by, { followUp: ids }), by);
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
  if (listTurns(seq).at(-1)?.kind !== 'error') throw new RequirementsError('CONFLICT', 'nothing to retry');
  const lastReal = listTurns(seq).filter((t) => t.kind !== 'error').at(-1);
  if (!f.orientation) return startOrientation(seq, { by }, deps);
  if (listTurns(seq).at(-1).payload.job === 'look') return startOrientation(seq, { by, thenRound: false }, deps);
  if (lastReal?.kind === 'followup') return startJob(seq, d, () => runRound(seq, d, by, { followUp: lastReal.payload.assumptions }), by);
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
