// src/shared/shape/feature-log.mjs — Shaper s2: the feature card's step log (D7) and the receipt words it shares with
// ui/public/shape/step-receipt.mjs (D8). Pure and browser-safe (B2: the Care words come from feature-record.mjs): the server builds the log from durable rows (the run
// harness's audit lines, the clarify row, the feature row); the browser names a receipt with the same words.
import { verifyLogEntries } from './verifier.mjs';
import { careRecordLine } from './feature-record.mjs';
import { SKIP_LINES } from './prototype.mjs';
import { STOP_DONE_RE } from './run-stops.mjs';
import { reqChangeLogText } from './req-change.mjs';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

export const clarifyText = (k) => (k ? `Clarify · ${plural(k, 'answer')}` : 'Clarify · no answers');
export const planApprovedText = (rounds) => (rounds > 0 ? `Plan approved · after ${plural(rounds, 'round')} of changes` : 'Plan approved');
export const splitText = (n) => (n < 2 ? 'Planned as one run' : `Split into ${n} runs`);
export const gateText = (d) => (d === 'another' ? 'Another cycle started' : 'Accepted as is');
export const NOT_SPLIT_TEXT = 'Not split · planned as one run';
/** The receipt of an agreed Requirements step (the step card's and, B1, the one card's log row). */
export const REQUIREMENTS_AGREED = 'Requirements agreed';
/** Shaper small runs B1 (D7): the one card's split receipt; the count lives in its state line. */
export const RUNS_APPROVED = 'Runs approved';
const KEPT_RE = / · (\d+) objections? kept\)/;
/** Small runs B4 (D20): the approved Split's words, with the open objections a person kept. */
export const runsApprovedText = (kept = 0) => (kept > 0 ? `${RUNS_APPROVED} · ${kept} objection${kept === 1 ? '' : 's'} kept` : RUNS_APPROVED);
/** Small runs B4 (D20): what an outline ask's audit line adds after its round (" · 2 objections kept", parsed back by
 *  KEPT_RE), and the count the pending-question stub keeps for it. '' and {} for every other ask. */
export const outlineKeptNote = (stub, decision, value) => (decision === 'approve' && value?.openObjections === 'kept' && stub?.open > 0
  ? ` · ${stub.open} objection${stub.open === 1 ? '' : 's'} kept` : '');
export const outlineKeptStub = (plan) => (plan?.challenge?.open > 0 ? { open: plan.challenge.open } : {});
/** Shaper small runs C1: the Prototype step's log lines (the audit line is the same words plus a full stop). */
export const PROTOTYPE_CONFIRMED = 'Prototype confirmed by you';
/** `rebuilt`: the build that follows a remark (same count and cost, its own words). */
export const prototypeBuiltText = (n, costUsd = 0, rebuilt = false) =>
  `Prototype ${rebuilt ? 'rebuilt with your remark' : "built by Design's agents"} · ${plural(n, 'screen')} · $${(Number(costUsd) || 0).toFixed(2)}`;
export const remarkUpdatedText = (remark, id) => `Your remark: “${remark}” → ${id} updated`;
const PROTO_RES = [/^Prototype (?:built by Design's agents|rebuilt with your remark) · \d+ screens? · \$\d+\.\d{2}$/, /^Your remark: “.*” → R-[a-z]{1,8}-\d+ updated$/s];
/** A Prototype log line (C1), or null. */
export function parsePrototypeLine(text) {
  const t = String(text || '').replace(/\.$/, '');
  if (t === PROTOTYPE_CONFIRMED || Object.values(SKIP_LINES).includes(t) || PROTO_RES.some((re) => re.test(t))) return { kind: 'prototype', text: t };
  return null;
}
const AWAY_KEPT_TEXT = 'Plan kept as written · by Away mode · please check';
export function replanText(indexes) {
  const xs = [...indexes].sort((a, b) => a - b);
  if (!xs.length) return 'Re-planning';
  return xs.length === 1 ? `Re-planning run ${xs[0]}` : `Re-planning runs ${xs[0]}–${xs[xs.length - 1]}`;
}

/** Shaper s5 (D15): the base-merge line, named once (no run tag). */
export const baseMovedText = (base, run, files = 0) => (files > 0
  ? `${base} moved · run ${run} has conflicts with it in ${plural(files, 'file')}`
  : `${base} moved · run ${run} starts from it`);

/** Shaper s5 (D21): a fix round's outcome (src/core/pr-watch.mjs fixOutcome) as log words. */
const OUTCOME_REASON = Object.freeze({ 'conflict-markers': 'conflict markers left', 'no-change': 'nothing changed',
  'fix-failed': 'the fix run failed', 'push-refused': 'the push was refused' });
export function roundOutcomeText(o) {
  if (!o || typeof o !== 'object') return '';
  if (o.kind === 'pushed') return o.sha ? `pushed ${o.sha}` : 'pushed';
  if (o.kind === 'ended') return `nothing pushed: the PR was ${o.reason || 'closed'}`;
  return `nothing pushed: ${OUTCOME_REASON[o.reason] || String(o.reason || 'fix-failed').replace(/-/g, ' ')}`;
}
/** Shaper s5 (D16): a round's log line; an outcome, when there is one, takes the place of "stopped". */
export const roundText = (n, words, status = '', outcome = null) =>
  [`Round ${n}`, words, outcome ? roundOutcomeText(outcome)
    : status === 'stopped' || status === 'error' ? 'stopped' : ''].filter(Boolean).join(' · ');

/** git-sync.mjs baseMovedAudit's line: "Base `dev` moved: merged into `b` (3 commits)." or "...: conflicts in 2 files." */
const BASE_RE = /^Base `([^`]+)` moved: (?:merged into|conflicts in (\d+) files?)/;
export function parseBaseLine(text) {
  const m = BASE_RE.exec(String(text || ''));
  return m ? { base: m[1], files: m[2] ? Number(m[2]) : 0 } : null;
}

/** run-harness.mjs _auditDecision's lines: "Plan approval **approve** by ann." (the actor part is optional). */
const LINES = [['plan', /^Plan approval \*\*(\w+)\*\*/], ['requirements', /^Requirements approval \*\*(\w+)\*\*/], ['outline', /^Slice outline \*\*(\w+)\*\*/], ['gate', /^Gate \*\*(\w+)\*\*/],
  ['concern', /^Plan concern \*\*(\w+)\*\*/]];
const CARE_RE = /^Care \*\*(\w+)\*\* · Worca's pick \*\*(\w+)\*\*/;
export function parseDecisionLine(text) {
  const t = String(text || '');
  const c = CARE_RE.exec(t);
  // Shaper small runs B2 (D18): the Start step's Care line; `decision` is the position, `pick` Worca's.
  if (c) return { kind: 'care', decision: c[1], pick: c[2], ...(t.endsWith(' by night-mode.') ? { away: true } : {}) };
  for (const [kind, re] of LINES) {
    const m = re.exec(t);
    // Small runs B4 (D20): an approved Split names the objections it kept ("(round 1 · 2 objections kept)").
    const kept = kind === 'outline' ? KEPT_RE.exec(t) : null;
    if (m) return { kind, decision: m[1], ...(kept ? { kept: Number(kept[1]) } : {}), ...(t.endsWith(' by night-mode.') ? { away: true } : {}) };
  }
  return null;
}
const byAway = (text, d) => (d.away ? `${text} · by Away mode` : text);

/**
 * The answered steps, oldest first: { key, run: number|null, text, detail: string[] }.
 * @param {{clarify?: {questions: object[], answers: object[]}|null, origin?: string[], sliced?: boolean,
 *   runs?: Array<{index: number, events: string[]}>, slices?: Array<{index: number, title: string, goal: string, acceptance: string[]}>,
 *   replan?: number[]|null, rounds?: Array<{run: number, round: number, request: string, status: string, outcome?: object}>}} input
 *   `origin` = the planning run's audit texts (it is run 1 once sliced); `runs` = runs 2..N; `rounds` = the runs' rounds (s5).
 *   `oneCard` (Shaper small runs B1, D7): the one card's words, "Requirements agreed" and "Runs approved"; without it a
 *   requirements line reads as the plan approval it was before B1, and the split keeps splitText.
 */
export function buildDecisionLog({ clarify = null, origin = [], sliced = false, runs = [], slices = [], replan = null, rounds = [], oneCard = false, changes = [], verify = null } = {}) {
  const out = [];
  const front = [];
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
      const b = run ? parseBaseLine(text) : null;
      if (b) { out.push({ key: `${run}-${n}`, run: null, text: baseMovedText(b.base, run, b.files), detail: [] }); return; }
      const proto = oneCard ? parsePrototypeLine(text) : null;
      if (proto) { out.push({ key: `${run || 'p'}-${n}`, run, text: proto.text, detail: [] }); return; }
      // Small runs C3 (D14): a stop a person answered (run-stops.mjs stopDoneText), its own decision row.
      // The run shows once, in the row's span; the text drops its own "Run N: " (fit-2-1).
      if (STOP_DONE_RE.test(String(text || ''))) { out.push({ key: `${run || 'p'}-${n}`, run, text: String(text).replace(/^Run \d+: /, ''), detail: [] }); return; }
      const p = parseDecisionLine(text);
      if (!p) return;
      const d = p.kind === 'requirements' && !oneCard ? { ...p, kind: 'plan' } : p;
      const key = `${run || 'p'}-${n}`;
      if (d.kind === 'care') {
        // The Care is the feature's first fact (d-2: fixed after Start), so it leads the log.
        const care = { position: d.decision, worcaPick: d.pick === 'none' ? null : d.pick, chosenBy: d.decision === d.pick ? 'default' : 'person' };
        front.push({ key: 'care', run: null, text: byAway(careRecordLine(care), d), detail: [] });
      } else if (d.kind === 'outline') {
        if (d.decision === 'approve' && sliced) out.push({ key, run: null, text: byAway(oneCard ? runsApprovedText(d.kept) : splitText(slices.length), d), detail: slices.map((s) => `${s.index} · ${s.title}`) });
        else if (d.decision === 'flat') out.push({ key, run: null, text: NOT_SPLIT_TEXT, detail: [] });
      } else if (d.kind === 'plan') {
        if (d.decision === 'revise') revises += 1;
        else if (d.decision === 'approve') { out.push({ key, run, text: byAway(planApprovedText(revises), d), detail: run ? goalOf(run) : [] }); revises = 0; }
      } else if (d.kind === 'requirements') {
        if (d.decision === 'approve') { out.push({ key, run, text: byAway(REQUIREMENTS_AGREED, d), detail: [] }); revises = 0; }
      } else if (d.kind === 'concern') {
        // A person's concern line stays silent. Away's approve is the plan's approval here, and it is one to check.
        if (d.decision === 'overridden' && d.away) { out.push({ key, run, text: AWAY_KEPT_TEXT, detail: [] }); revises = 0; }
      } else out.push({ key, run, text: gateText(d.decision), detail: [] });
    });
  };
  walk(origin, sliced ? 1 : null);
  for (const r of runs) walk(r.events || [], r.index);
  const byRun = new Map();
  for (const r of rounds) { const l = byRun.get(r.run) || []; l.push(r); byRun.set(r.run, l); }
  for (const [run, list] of [...byRun].sort((a, b) => a[0] - b[0])) {
    const s = sliceOf(run);
    out.push({ key: `round-${run}-1`, run, text: roundText(1, s ? s.title : ''), detail: [] });
    for (const r of list) out.push({ key: `round-${run}-${r.round}`, run, text: roundText(r.round, r.request, r.status, r.outcome), detail: [] });
  }
  // Small runs C4 (D17): a requirement change not on the feature card's notice (landed, superseded or `none`), oldest first.
  (Array.isArray(changes) ? changes : []).forEach((e) => { out.push({ key: `change-${e.at}-${e.id}`, run: null, text: reqChangeLogText(e), detail: [] }); });
  // Small runs C5 (D13): one receipt per Verifier check with a result (`verify` = the feature's outline.verify). `kind`
  // draws it as a .srows row, in the gap list's mark and text columns (owner direction d86d13181).
  // Slice 10 (D8): a check with `answeredBy` adds one line per answered gap after its receipt.
  for (const { key, text } of verifyLogEntries(verify)) out.push({ key, run: null, text, detail: [], kind: 'verify' });
  out.unshift(...front.slice(0, 1));
  if (replan && replan.length) {
    out.push({ key: 'replan', run: null, text: replanText(replan), detail: [...replan].sort((a, b) => a - b).map((i) => { const s = sliceOf(i); return s ? `${i} · ${s.title}` : String(i); }) });
  }
  return out;
}
