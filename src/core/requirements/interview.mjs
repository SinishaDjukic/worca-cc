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
import {
  requireFeature, updateFeature, appendTurn, listTurns, getContext, addFeatureCost, listFeatures,
} from './store.mjs';
import {
  ROUND_SYSTEM_PROMPT, ORIENTATION_SYSTEM_PROMPT, buildRoundPrompt, buildOrientationPrompt, applyRound,
  normalizeOrientation, mockRoundReply, RoundError,
} from './round.mjs';

const ROUND_TIMEOUT_MS = 180_000;
const DEFAULTS = Object.freeze({
  runClaudeImpl: runClaude, listModels, listProjects, workspaceTarget,
  openLook: openRepoLook, openWorkspaceLook: openWorkspaceRepoLook, budget: () => budgetStatus(), onChange: () => {},
});

const jobs = new Map();
export const isBusy = (seq) => jobs.has(Number(seq));
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

function startJob(seq, d, fn, by) {
  seq = Number(seq);
  if (jobs.has(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  const p = (async () => {
    try { await fn(); }
    catch (err) {
      appendTurn(seq, { kind: 'error', payload: { code: err?.code || 'FAILED', message: message(err) } }, { by });
      try { updateFeature(seq, { status: 'your_turn' }, { by }); } catch { /* deleted meanwhile */ }
    } finally {
      jobs.delete(seq);
      d.onChange(seq);
    }
  })();
  jobs.set(seq, p);
  return p;
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

async function callModel(d, { cwd, systemPrompt, prompt, model, tools, maxTurns = null, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let costUsd = 0;
  try {
    const res = await d.runClaudeImpl({
      cwd, systemPrompt, prompt, model, modelEnv: resolveModelEnv(model),
      allowedTools: [...tools], tools: [...tools], strictMcpConfig: true,
      ...(maxTurns ? { maxTurns } : {}),
      effort: 'medium', permissionMode: 'acceptEdits', signal: ctrl.signal,
      onEvent: normalizingOnEvent((e) => {
        if (e.type !== 'result' || e.costUsd == null) return;
        const c = resolveModelCost(model, Number(e.costUsd), e.usage ?? null);
        if (Number.isFinite(c)) costUsd += c;
      }),
    });
    return { text: res?.text || '', costUsd };
  } finally { clearTimeout(timer); }
}

async function openLookFor(f, d) {
  const base = scratchDir();
  if (f.scopeType === 'project') {
    const p = (await d.listProjects()).find((x) => x.key === f.scopeKey);
    return p && p.exists ? d.openLook(p.path, base) : null;
  }
  const ws = await d.workspaceTarget(f.scopeKey);
  return ws && ws.members.length ? d.openWorkspaceLook(ws.members, base) : null;
}

/** D7: a short product-language summary of what exists, or why there is none. Never throws. */
async function orient(f, d) {
  const ctx = getContext(f.scopeType, f.scopeKey);
  if (!ctx.lookAtCode) return { summary: '', files: [], skipped: 'off' };
  if (mockEnabled({})) return { summary: `[mock] What exists around "${f.title}": orders, each with a status.`, files: [], skipped: null };
  let look = null;
  try {
    look = await openLookFor(f, d);
    if (!look) return { summary: '', files: [], skipped: 'no-repo' };
    const model = await requirementsModel(d.listModels);
    const { text, costUsd } = await callModel(d, {
      cwd: look.cwd, systemPrompt: ORIENTATION_SYSTEM_PROMPT,
      prompt: buildOrientationPrompt({ feature: f, context: ctx.body, members: look.members || null }),
      model, tools: REPO_LOOK_TOOLS, maxTurns: REPO_LOOK_MAX_TURNS, timeoutMs: REPO_LOOK_TIMEOUT_MS,
    });
    return { ...normalizeOrientation(safeParseJson(text)), skipped: null, model: model || null, costUsd };
  } catch (err) {
    return { summary: '', files: [], skipped: 'failed', error: message(err) };
  } finally {
    if (look) await look.close();
  }
}

async function runOrientation(seq, d, by) {
  updateFeature(seq, { status: 'looking' }, { by });
  d.onChange(seq);
  assertBudget(d);
  const f = requireFeature(seq);
  const o = await orient(f, d);
  const turnId = appendTurn(seq, { kind: 'orientation', payload: { summary: o.summary, files: o.files, skipped: o.skipped, error: o.error || null },
    model: o.model || null, costUsd: o.costUsd || null }, { by });
  charge(seq, turnId, o.costUsd, o.model);
  updateFeature(seq, { orientation: { summary: o.summary, files: o.files, skipped: o.skipped, at: new Date().toISOString() } }, { by });
}

async function runRound(seq, d, by, { final = false } = {}) {
  updateFeature(seq, { status: 'thinking' }, { by });
  d.onChange(seq);
  assertBudget(d);
  const f = requireFeature(seq);
  const isFinal = final || f.rounds + 1 >= MAX_ROUNDS;
  const seqs = { criteriaSeq: f.criteriaSeq, assumptionSeq: f.assumptionSeq, final: isFinal };
  let applied = null;
  let model = null;
  let cost = 0;
  let lastErr = null;
  if (mockEnabled({})) {
    applied = applyRound(f.spec, mockRoundReply(f, isFinal), seqs);
  } else {
    const ctx = getContext(f.scopeType, f.scopeKey);
    const prompt = buildRoundPrompt({ feature: f, context: ctx.body, turns: listTurns(seq), final: isFinal, round: f.rounds + 1 });
    model = await requirementsModel(d.listModels);
    const cwd = scratchDir();
    for (let attempt = 1; attempt <= 2 && !applied; attempt += 1) {
      const r = await callModel(d, { cwd, systemPrompt: ROUND_SYSTEM_PROMPT, prompt, model, tools: [], timeoutMs: ROUND_TIMEOUT_MS });
      cost += r.costUsd;
      try { applied = applyRound(f.spec, safeParseJson(r.text), seqs); }
      catch (err) { if (!(err instanceof RoundError)) throw err; lastErr = err; }
    }
  }
  if (!applied) {
    const turnId = appendTurn(seq, { kind: 'error', payload: { code: 'BAD_REPLY', message: `Worca's reply could not be read (${lastErr.message}). Try again.` },
      model: model || null, costUsd: cost || null }, { by });
    charge(seq, turnId, cost, model);
    updateFeature(seq, { status: 'your_turn' }, { by });
    return;
  }
  const turnId = appendTurn(seq, { kind: 'round', payload: { questions: applied.questions, note: applied.note, done: applied.done, final: isFinal },
    model: model || null, costUsd: cost || null }, { by });
  charge(seq, turnId, cost, model);
  updateFeature(seq, {
    spec: applied.spec, criteriaSeq: applied.criteriaSeq, assumptionSeq: applied.assumptionSeq,
    rounds: f.rounds + 1, status: applied.done ? 'done' : 'your_turn',
  }, { by });
}

function guard(seq) {
  const f = requireFeature(seq);
  if (f.status === 'archived') throw new RequirementsError('CONFLICT', 'this feature is archived; restore it first');
  if (isBusy(seq)) throw new RequirementsError('BUSY', 'Worca is still working on this feature. Try again in a moment.');
  return f;
}

/** Orientation (D7), then round 1 unless `thenRound` is false ("Look again"). */
export function startOrientation(seq, { by = null, thenRound = true } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  guard(seq);
  return startJob(seq, d, async () => {
    await runOrientation(seq, d, by);
    if (thenRound) await runRound(seq, d, by);
    else updateFeature(seq, { status: restingStatus(seq) }, { by });
  }, by);
}

/** Where a feature rests between jobs: done when its latest round said so, else the product owner's turn. */
function restingStatus(seq) {
  return listTurns(seq).filter((t) => t.kind === 'round').at(-1)?.payload.done ? 'done' : 'your_turn';
}

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
  guard(seq);
  appendTurn(seq, { kind: 'finish', payload: {} }, { by });
  return startJob(seq, d, () => runRound(seq, d, by, { final: true }), by);
}

/** Try again after an error turn: the orientation when there is none yet, else the round (final when
 *  the product owner had asked to finish). */
export function retry(seq, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = guard(seq);
  const lastReal = listTurns(seq).filter((t) => t.kind !== 'error').at(-1);
  if (!f.orientation) return startOrientation(seq, { by }, deps);
  return startJob(seq, d, () => runRound(seq, d, by, { final: lastReal?.kind === 'finish' }), by);
}

/** Boot sweep: a feature left looking/thinking by a restart goes back to the product owner. */
export function recoverInterrupted() {
  let n = 0;
  for (const f of listFeatures({ archived: true })) {
    if ((f.status !== 'looking' && f.status !== 'thinking') || isBusy(f.seq)) continue;
    appendTurn(f.seq, { kind: 'error', payload: { code: 'INTERRUPTED', message: 'The last round did not finish because Worca restarted. Try again.' } });
    updateFeature(f.seq, { status: 'your_turn' });
    n += 1;
  }
  return n;
}
