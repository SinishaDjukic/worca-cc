// src/shared/shape/feature-log.mjs — Shaper s2: the feature card's step log (D7) and the receipt words it shares with
// ui/public/shape/step-receipt.mjs (D8). Pure, no imports: the server builds the log from durable rows (the run
// harness's audit lines, the clarify row, the feature row); the browser names a receipt with the same words.
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

export const clarifyText = (k) => (k ? `Clarify · ${plural(k, 'answer')}` : 'Clarify · no answers');
export const planApprovedText = (rounds) => (rounds > 0 ? `Plan approved · after ${plural(rounds, 'round')} of changes` : 'Plan approved');
export const splitText = (n) => (n < 2 ? 'Planned as one run' : `Split into ${n} runs`);
export const gateText = (d) => (d === 'another' ? 'Another cycle approved' : 'Continued with what you have');
export const NOT_SPLIT_TEXT = 'Not split · planned as one run';
export function replanText(indexes) {
  const xs = [...indexes].sort((a, b) => a - b);
  if (!xs.length) return 'Re-planning';
  return xs.length === 1 ? `Re-planning run ${xs[0]}` : `Re-planning runs ${xs[0]}–${xs[xs.length - 1]}`;
}

/** run-harness.mjs _auditDecision's lines: "Plan approval **approve** by ann." (the actor part is optional). */
const LINES = [['plan', /^Plan approval \*\*(\w+)\*\*/], ['outline', /^Slice outline \*\*(\w+)\*\*/], ['gate', /^Gate \*\*(\w+)\*\*/]];
export function parseDecisionLine(text) {
  const t = String(text || '');
  for (const [kind, re] of LINES) { const m = re.exec(t); if (m) return { kind, decision: m[1] }; }
  return null;
}

/**
 * The answered steps, oldest first: { key, run: number|null, text, detail: string[] }.
 * @param {{clarify?: {questions: object[], answers: object[]}|null, origin?: string[], sliced?: boolean,
 *   runs?: Array<{index: number, events: string[]}>, slices?: Array<{index: number, title: string, goal: string, acceptance: string[]}>,
 *   replan?: number[]|null}} input  `origin` = the planning run's audit texts (it is run 1 once sliced); `runs` = runs 2..N.
 */
export function buildDecisionLog({ clarify = null, origin = [], sliced = false, runs = [], slices = [], replan = null } = {}) {
  const out = [];
  const qs = clarify && Array.isArray(clarify.questions) ? clarify.questions : [];
  const as = clarify && Array.isArray(clarify.answers) ? clarify.answers : [];
  if (qs.length && as.length) {
    const byId = new Map(as.map((a) => [String(a && a.id), a]));
    const choice = (a) => (a && typeof a.choice === 'string' ? a.choice.trim() : '');
    out.push({ key: 'clarify', run: null, text: clarifyText(as.filter((a) => choice(a)).length),
      detail: qs.map((q) => `${(q && q.question) || ''} → ${choice(byId.get(String(q && q.id))) || '—'}`) });
  }
  const sliceOf = (i) => slices.find((s) => s.index === i) || null;
  const goalOf = (i) => { const s = sliceOf(i); return s ? [s.goal ? `Goal: ${s.goal}` : '', ...(s.acceptance || []).map((a) => `✓ ${a}`)].filter(Boolean) : []; };
  const walk = (events, run) => {
    let revises = 0;
    events.forEach((text, n) => {
      const d = parseDecisionLine(text);
      if (!d) return;
      const key = `${run || 'p'}-${n}`;
      if (d.kind === 'outline') {
        if (d.decision === 'approve' && sliced) out.push({ key, run: null, text: splitText(slices.length), detail: slices.map((s) => `${s.index} · ${s.title}`) });
        else if (d.decision === 'flat') out.push({ key, run: null, text: NOT_SPLIT_TEXT, detail: [] });
      } else if (d.kind === 'plan') {
        if (d.decision === 'revise') revises += 1;
        else if (d.decision === 'approve') { out.push({ key, run, text: planApprovedText(revises), detail: run ? goalOf(run) : [] }); revises = 0; }
      } else out.push({ key, run, text: gateText(d.decision), detail: [] });
    });
  };
  walk(origin, sliced ? 1 : null);
  for (const r of runs) walk(r.events || [], r.index);
  if (replan && replan.length) {
    out.push({ key: 'replan', run: null, text: replanText(replan), detail: [...replan].sort((a, b) => a - b).map((i) => { const s = sliceOf(i); return s ? `${i} · ${s.title}` : String(i); }) });
  }
  return out;
}
