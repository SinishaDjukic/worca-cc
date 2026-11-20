// src/core/workflow-tests/judge.mjs — Part 4 (plans/workflow-tests-part4-plan.md D88–D91): one no-tools model call with Worca's own
// system prompt, through the Requirements helper call (the interview's callModel path: interviewCallOptions 'round'), and the question
// asked with it: is a criterion met. It uses Worca's normal model routing (the model's env, the credential broker), so the account
// that pays is the one that pays for that model in a run. A failure of the call comes back as an `error` code (NOT_CHECKED); it throws only if reading the spending limit or booking fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { helperCall as realHelperCall } from '../helper-call/index.mjs';
import { interviewCallOptions } from '../requirements/interview.mjs';
import { userClaudeSignIn } from '../claude-user-settings.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { budgetStatus } from '../cost-budget.mjs';
import { worcaHome } from '../projects.mjs';
import { judgeSystemPrompt, fenceTag, SUBJECT_MAX, CONTEXT_MAX, clipText, judgePrompt, parseJudgeReply, proofFound, mockJudgement } from './judge-prompt.mjs';

export const JUDGE_TIMEOUT_MS = 120_000;
/** D88: an empty folder of Part 4's own, so no project's settings, skills or CLAUDE.md load into a call. */
export function judgeScratch() {
  const d = join(worcaHome(), 'tmp', 'workflow-tests', 'judge');
  mkdirSync(d, { recursive: true });
  return d;
}
export const firstLine = (e) => String((e && e.message) || e).split(/\r?\n/)[0].slice(0, 300);

export const JUDGE_DEFAULTS = Object.freeze({
  helperCall: (args) => realHelperCall(args),
  userSignIn: () => userClaudeSignIn(),
  mock: () => mockEnabled({}),
  budget: () => budgetStatus(),
  scratch: () => judgeScratch(),
  timeoutMs: JUDGE_TIMEOUT_MS,
});

/** D88: one call. Resolves `{ text, costUsd, costKind }`; a failed call rejects with what it spent on the error (helperCall's rule). */
export async function modelCall({ model, system, prompt, signal = null }, d = {}) {
  const x = { ...JUDGE_DEFAULTS, ...d };
  const cwd = x.scratch();
  const claudeOptions = interviewCallOptions('round', { cwd, prompt, model, systemPrompt: system, noSessionPersistence: true },
    { keepUserSettings: !!x.userSignIn() });
  const r = await x.helperCall({ engine: 'claude', model, cwd, prompt, timeoutMs: x.timeoutMs, signal, claudeOptions });
  return { text: r.text || '', costUsd: Number(r.costUsd) || 0, costKind: r.costKind || 'billed' };
}

/** D89–D91: is `criterion` met by `subject` (the result, D90)? `context`: the example's files and request. */
export async function judgeCriterion({ criterion, subject, context = '', model, mock = false, signal = null, book = () => {} }, d = {}) {
  const x = { ...JUDGE_DEFAULTS, ...d };
  const t0 = Date.now();
  let cost = 0;
  const done = (r) => ({ met: null, reason: null, proof: null, proofFound: false, error: null, ...r, costUsd: Math.round(cost * 1e6) / 1e6, ms: Date.now() - t0 });
  if (typeof subject !== 'string' || !subject.trim()) return done({ error: 'no-result' });
  if (mock || x.mock()) {
    const m = mockJudgement(criterion, subject);
    return proofFound(m.proof, subject) ? done({ met: m.verdict === 'met', reason: m.reason, proof: m.proof, proofFound: true })
      : done({ reason: m.reason, proof: m.proof, error: 'no-proof' });
  }
  const s = clipText(subject, SUBJECT_MAX);
  const tag = fenceTag();
  const prompt = judgePrompt({ criterion, result: s.text, context: clipText(context, CONTEXT_MAX).text, cut: s.cut, tag });
  const system = judgeSystemPrompt(tag);
  let last = { error: 'unreadable' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const b = x.budget();
    if (b && b.blocked) return done({ error: 'limit' });
    let r;
    try {
      r = await modelCall({ model, system, prompt, signal }, x);
    } catch (e) {
      const spent = Number(e && e.costUsd) || 0;
      cost += spent;
      if (spent > 0) book(spent, (e && e.costKind) || 'billed');
      return done({ error: 'failed', detail: firstLine(e) });
    }
    cost += r.costUsd;
    if (r.costUsd > 0 || r.costKind === 'unknown') book(r.costUsd, r.costKind);   // P4-Q17: an unknown cost books a $0 row
    const p = parseJudgeReply(r.text);
    if (!p) { last = { error: 'unreadable' }; continue; }
    if (proofFound(p.proof, subject)) return done({ met: p.verdict === 'met', reason: p.reason, proof: p.proof, proofFound: true });
    last = { error: 'no-proof', reason: p.reason, proof: p.proof };   // P4-Q7: asked once more, then not counted
  }
  return done(last);
}
