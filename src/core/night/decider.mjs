// src/core/night/decider.mjs
// Turn ONE open ask into the payload answer() expects + the decision record we store.
import { decideQuestion, gateRule, workflowRule, recoveryRule } from './strategies.mjs';
import { recoveryDelayMs } from '../recovery-backoff.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS } from '../failure-policy.mjs';
import { nightNeverDecides } from './config.mjs';

const agg = (decisions) => ({
  flagged: decisions.some((d) => d.flagged),
  confidence: decisions.every((d) => Number.isFinite(d.confidence)) ? Math.min(...decisions.map((d) => d.confidence)) : null,
  strategy: [...new Set(decisions.map((d) => d.strategy))].join('+'),
});

/** Top-level enum fields with no `default`: the ones the strategy decides. */
function formEnumQuestions(answerSchema) {
  const props = answerSchema?.properties && typeof answerSchema.properties === 'object' ? answerSchema.properties : {};
  return Object.entries(props)
    .filter(([, s]) => s && Array.isArray(s.enum) && s.enum.length && s.default === undefined && s.enum.every((v) => typeof v === 'string'))
    .map(([k, s]) => ({ id: k, question: s.title || s.description || k, options: s.enum,
      ...(Array.isArray(s['x-confidence']) ? { confidence: s['x-confidence'] } : {}) }));
}

/** ONE analysis call per ask: the first question triggers it for all of them. */
function memoAnalyze(analyze, questions) {
  let p = null;
  return async (one) => { p ||= analyze(questions); const byId = await p; return byId?.[one.id]; };
}

/**
 * @param {object} q the ask as _ask received it
 * @param {{config, analyze?, gateCyclesUsed?, budget?, sleep?}} env
 *   `analyze(questions)` resolves to {[questionId]: analysis}; a missing entry reads as
 *   "analysis unavailable".
 * @returns {Promise<{payload:object, record:object}|null>} null = this kind waits for the user
 */
export async function decideAsk(q, env) {
  const { config } = env;
  if (nightNeverDecides(config, q)) return null;
  switch (q.kind) {
    case 'clarify': case 'questions': {
      const analyze = env.analyze ? memoAnalyze(env.analyze, q.questions || []) : undefined;
      const ds = [];
      for (const one of q.questions || []) ds.push(await decideQuestion(one, config, { analyze }));
      return { payload: { answers: ds.map((d) => ({ id: d.id, choice: d.choice })) },
        record: { ...agg(ds), choice: ds.map((d) => d.choice).join(' | '), questions: ds,
          rationale: ds.map((d) => `${d.id}: ${d.rationale}`).join('\n'), reversible: ds.every((d) => d.reversible !== false) } };
    }
    case 'form': {
      const values = { ...(q.autoValues || {}) };
      const qs = formEnumQuestions(q.answerSchema);
      const analyze = env.analyze && qs.length ? memoAnalyze(env.analyze, qs) : undefined;
      const ds = [];
      for (const one of qs) { const d = await decideQuestion(one, config, { analyze }); values[one.id] = d.choice; ds.push(d); }
      return { payload: { form: q.form, version: q.version, values },
        record: { ...(ds.length ? agg(ds) : { flagged: false, confidence: null, strategy: 'defaults' }), choice: JSON.stringify(values).slice(0, 500), questions: ds,
          rationale: ds.length ? ds.map((d) => `${d.id}: ${d.rationale}`).join('\n') : 'the form\'s default values' } };
    }
    case 'gate': {
      const g = gateRule({ issues: q.issues || [], extraUsed: env.gateCyclesUsed ? env.gateCyclesUsed(q.wireId) : 0 }, config);
      return { payload: { decision: g.decision }, record: { choice: g.decision, strategy: 'rule', confidence: null, flagged: g.flagged, rationale: g.reason,
        reversible: g.decision === 'another', meta: { wireId: q.wireId, deliveryNo: q.deliveryNo } } };
    }
    case 'workflow': {
      const w = workflowRule({ proposal: q.workflow, budget: env.budget || null });
      return { payload: w.payload, record: { choice: 'accept', strategy: 'rule', confidence: null, flagged: w.flagged, rationale: w.reason, reversible: true } };
    }
    case 'recovery': {
      const cls = q.recovery?.cls || 'unknown';
      // Retries already spent on THIS node execution (the orchestrator's 1-based failed attempt),
      // the same budget --yes gets — never a run-wide count, so one flaky step cannot exhaust another's.
      const attempts = Math.max(0, (Number(q.recovery?.attempt) || 1) - 1);
      const r = recoveryRule({ attempts, max: RECOVERY_MAX_AUTO_ATTEMPTS });
      if (r.decision === 'retry' && env.sleep) await env.sleep(recoveryDelayMs({ cls, attempt: attempts + 1 }));
      return { payload: { decision: r.decision }, record: { choice: r.decision, strategy: 'rule', confidence: null, flagged: r.flagged,
        rationale: r.decision === 'retry' ? `retry ${attempts + 1} of ${RECOVERY_MAX_AUTO_ATTEMPTS} after a pause` : `the step failed ${attempts + 1} times; worca does not retry further while you are away`, reversible: true, meta: { cls } } };
    }
    case 'plan': return null;   // a plan approval always waits for a person (shape-it-first D2)
    default: return null;
  }
}
