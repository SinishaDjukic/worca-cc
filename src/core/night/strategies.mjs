// src/core/night/strategies.mjs
// Pure decision rules. The only side effect is the injected `analyze` call.
import { BLOCKING, SEVERITIES, normalizeSeverity } from '../../shared/graph/verdict.mjs';

const realOpts = (q) => (Array.isArray(q?.options) ? q.options.filter((o) => typeof o === 'string' && o.trim()) : []);

/** Weights threshold (confidence ≥ minConfidence, lead over the runner-up ≥ minMargin). */
export function weightsVerdict(q, cfg) {
  const opts = realOpts(q);
  const conf = Array.isArray(q?.confidence) && q.confidence.length === opts.length ? q.confidence : null;
  const idx = conf && typeof q.recommended === 'string' ? opts.indexOf(q.recommended) : -1;
  if (idx < 0) return { met: false, confidence: null, margin: null };
  const c = conf[idx];
  const runnerUp = Math.max(0, ...conf.filter((_, k) => k !== idx));
  const margin = c - runnerUp;
  return { met: c >= cfg.minConfidence && margin >= cfg.minMargin, confidence: c, margin, choice: opts[idx] };
}

/** Normalized weighted score (0-100) per option from 0-10 criterion scores. */
export function weightedTotals(scores, criteria, options) {
  const wsum = Object.values(criteria).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const o of options) {
    const s = scores?.[o] || {};
    let t = 0;
    for (const [k, w] of Object.entries(criteria)) t += w * (Number.isFinite(s[k]) ? Math.min(10, Math.max(0, s[k])) : 0);
    out[o] = Math.round((t / (wsum * 10)) * 100);
  }
  return out;
}

/** The option with the fewest irreversible effects: highest `reversible` score, ties → higher total, then order. */
export function mostReversible(options, scores, totals) {
  const r = (x) => (Number.isFinite(scores?.[x]?.reversible) ? scores[x].reversible : -1);
  let best = options[0];
  for (const o of options.slice(1)) {
    if (r(o) > r(best) || (r(o) === r(best) && (totals[o] ?? 0) > (totals[best] ?? 0))) best = o;
  }
  return best;
}

/**
 * Decide ONE clarify/questions question.
 * @param {object} q normalized question ({options, confidence?, recommended?})
 * @param {object} cfg resolved night config
 * @param {{analyze?:(q)=>Promise<object>}} env
 * @returns {Promise<{id, choice, strategy, confidence, scores, rationale, reversible, flagged}>}
 */
export async function decideQuestion(q, cfg, { analyze } = {}) {
  const opts = realOpts(q);
  // The question's own words ride along: the run page lists each answer under the question it answers.
  const asked = typeof q.question === 'string' && q.question.trim() ? { question: q.question.trim().slice(0, 500) } : {};
  const base = { id: q.id, ...asked, scores: null, reversible: null };
  if (!opts.length) return { ...base, choice: '', strategy: 'none', confidence: null, rationale: 'free-text question; worca cannot answer it', flagged: true };
  const w = weightsVerdict(q, cfg);
  if (cfg.strategy === 'weights' || (cfg.strategy === 'mixed' && w.met)) {
    return w.met
      ? { ...base, choice: w.choice, strategy: 'weights', confidence: w.confidence, rationale: `the agent recommended this at ${w.confidence}%, well ahead of the next option`, flagged: false }
      : { ...base, choice: opts[0], strategy: 'weights', confidence: w.confidence, rationale: 'the agent was not sure enough; first option taken', flagged: true };
  }
  let a;
  try {
    if (typeof analyze !== 'function') throw new Error('analysis not configured');
    a = await analyze(q);
    if (!a || typeof a !== 'object') throw new Error('empty analysis');
  } catch (err) {
    const fallback = w.choice || opts[0];
    return { ...base, choice: fallback, strategy: 'analysis', confidence: null, rationale: `could not weigh the options (${err?.message || err}); ${w.choice ? "took the agent's recommendation" : 'first option taken'}`, flagged: true };
  }
  const scores = a.scores && typeof a.scores === 'object' ? a.scores : {};
  const totals = weightedTotals(scores, cfg.criteria, opts);
  const conf = Number.isFinite(a.confidence) ? Math.round(a.confidence) : 0;
  const valid = opts.includes(a.choice);
  const pick = valid ? a.choice : opts.reduce((b, o) => (totals[o] > totals[b] ? o : b), opts[0]);
  if (conf >= cfg.minConfidence) {
    const rationale = valid ? String(a.rationale || '')
      : `the review picked "${String(a.choice).slice(0, 80)}", which is not an option; took the best-scored option. ${String(a.rationale || '')}`.trim();
    return { ...base, choice: pick, strategy: 'analysis', confidence: conf, scores, rationale, reversible: a.reversible === true, flagged: !valid };
  }
  // Both sources agree (the analysis picked the option the clarifier recommended): take it, flagged, even under the
  // confidence bar. A low confidence alone is no reason to swap an agreed answer for a different one.
  if (valid && pick === q.recommended) {
    return { ...base, choice: pick, strategy: 'analysis', confidence: conf, scores,
      rationale: `the agent was not sure enough, but it picked the option the clarifier recommended. ${String(a.rationale || '')}`.trim(),
      reversible: a.reversible === true, flagged: true };
  }
  // User decision "never park": continue with the most reversible option, flagged.
  const rev = mostReversible(opts, scores, totals);
  return { ...base, choice: rev, strategy: 'analysis', confidence: conf, scores,
    rationale: `the agent was not sure enough; took the option easiest to undo. ${String(a.rationale || '')}`.trim(),
    reversible: true, flagged: true };
}

/** Extra fix rounds for every issue the review loop blocks on (critical AND major), read the way the loop reads them. */
export function gateRule({ issues = [], extraUsed = 0 }, cfg) {
  const sev = issues.map((i) => normalizeSeverity(i?.severity)).filter((s) => BLOCKING.has(s));
  if (!sev.length) return { decision: 'continue', flagged: false, reason: 'no critical or major issues left, continuing' };
  const n = sev.length;
  const counts = SEVERITIES.filter((s) => BLOCKING.has(s)).map((s) => [sev.filter((x) => x === s).length, s]).filter(([c]) => c);
  const left = `${counts.map(([c, s]) => `${c} ${s}`).join(' and ')} issue${n === 1 ? '' : 's'} left`;
  if (extraUsed < cfg.maxExtraCycles) return { decision: 'another', flagged: false, reason: `${left}, one more fix round` };
  if (!cfg.maxExtraCycles) return { decision: 'continue', flagged: true, reason: `${left}; Away mode adds no extra fix rounds, continuing` };
  return { decision: 'continue', flagged: true, reason: `${left} but the extra fix rounds are used up; continuing` };
}

export function workflowRule({ proposal, budget }) {
  const payload = { decision: 'accept', name: proposal?.name, nodes: {} };
  const tight = budget && budget.cap > 0 && budget.spent >= 0.8 * budget.cap;
  return { payload, flagged: !!tight, reason: tight ? `workflow accepted; ${Math.round((budget.spent / budget.cap) * 100)}% of the away spend cap used` : 'workflow accepted as proposed' };
}

export function recoveryRule({ attempts, max }) {
  return attempts < max ? { decision: 'retry', flagged: false } : { decision: 'pause', flagged: true };
}
