// src/shared/workflow-tests/compare.mjs
// Comparing two versions on the same examples (plans/workflow-tests-part2-plan.md D28; canvas boards 1, 4, 5, 6, 20).
// Pure and browser-safe: the server computes the model, the pages format it. Better or worse is decided by tries
// passed (Basics and automatic checks only, D18). "In short" is put together from the fixed sentences of C2, never by AI.
import { fmtUsd } from './checks.mjs';

export { fmtUsd };
export const LUCK_MAX_DIFF = 1;
/** The runner's limit (src/core/workflow-tests/runner.mjs MAX_PARALLEL, D36), for the time estimate. A test pins them equal. */
export const TRIES_AT_ONCE = 3;
const FINISHED = new Set(['passed', 'failed']);
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const low1 = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** How a version is named on the Tests pages. ctx = { liveVersionNo, latestVersionNo }. */
export function useLabel(use, ctx = {}, form = 'short') {
  if (use === 'draft') {
    const short = Number.isInteger(ctx.latestVersionNo) ? `v${ctx.latestVersionNo + 1} draft` : 'Your draft';
    if (form === 'short' || short === 'Your draft') return short;
    return form === 'select' ? `${short} · your changes` : `${short} · yours`;
  }
  const short = `v${use}`;
  if (form === 'short') return short;
  return use === ctx.liveVersionNo ? `${short} · the team uses it` : short;
}

/** The tested version inside a sentence: "your v5 draft", "your draft", "v4". */
const bWords = (use, ctx) => {
  const s = useLabel(use, ctx);
  return use === 'draft' ? (s === 'Your draft' ? 'your draft' : `your ${s}`) : s;
};

/** "Your v5 draft compared with v4", "Testing your v5 draft", "Tried once: <example>" / "Trying once: <example>". */
export function testTitle(run, ctx = {}, { mode = 'compare', exampleName = '' } = {}) {
  if (run.kind === 'once') return `${mode === 'testing' ? 'Trying' : 'Tried'} once: ${exampleName || 'an example'}`;
  const b = bWords(run.b, ctx);
  if (mode === 'testing') return `Testing ${b}`;
  const head = run.b === 'draft' ? cap1(b) : b;   // "Your v5 draft …", but "v5 compared with v4"
  return run.a == null ? head : `${head} compared with ${useLabel(run.a, ctx)}`;
}

export const latestTitle = (run, ctx = {}) => `Latest test: ${low1(testTitle(run, ctx))}`;

export const countsText = (examples, tries) =>
  `${examples} example${examples === 1 ? '' : 's'}, ${tries} ${tries === 1 ? 'try' : 'tries'} each`;

export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** The Basic or check the given tries missed most often (ties: by label). */
function missedMost(list) {
  const counts = new Map();
  for (const t of list) {
    const v = t.verdict || {};
    for (const item of [...(v.basics || []), ...(v.checks || [])]) if (item && !item.met) counts.set(item.label, (counts.get(item.label) || 0) + 1);
  }
  let best = null;
  for (const [label, k] of counts) if (!best || k > best.k || (k === best.k && label < best.label)) best = { label, k };
  return best;
}

const avg = (list, f) => {
  const xs = list.map(f).filter((x) => typeof x === 'number' && Number.isFinite(x));
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
};

/**
 * @param {{examples: Array<{id:number, name:string}>, a: {label:string}|null, b: {label:string},
 *   tries: Array<{side:'a'|'b', exampleId:number, status:string, costUsd:number, verdict:object|null}>}} input
 */
export function compareModel({ examples = [], a = null, b, tries = [] }) {
  const done = tries.filter((t) => FINISHED.has(t.status));
  const of = (side, exampleId = null) => done.filter((t) => t.side === side && (exampleId === null || t.exampleId === exampleId));
  const tally = (list) => ({ passed: list.filter((t) => t.status === 'passed').length, total: list.length });
  const steady = (list) => list.length > 0 && list.every((t) => t.status === list[0].status);
  const rate = (r) => r.passed / r.total;
  const rows = examples.map((ex) => {
    const aT = a ? of('a', ex.id) : [];
    const bT = of('b', ex.id);
    const ra = tally(aT);
    const rb = tally(bT);
    const both = !!a && ra.total > 0 && rb.total > 0;
    let result = null;
    let luck = false;
    let why = null;
    let missed = null;
    if (both) {
      const d = rate(rb) - rate(ra);
      result = Math.abs(d) < 1e-9 ? 'same' : d > 0 ? 'better' : 'worse';
      if (result !== 'same') {
        luck = Math.abs(d) * Math.min(ra.total, rb.total) <= LUCK_MAX_DIFF + 1e-9;   // the smaller side decides: one try can't prove it
        const loser = result === 'worse' ? { label: b.label, list: bT } : { label: a.label, list: aT };
        const m = missedMost(loser.list);
        if (m) missed = { label: m.label, k: m.k, n: loser.list.length };
        if (!luck && missed) why = `${loser.label} missed "${missed.label}" in ${missed.k} of ${missed.n} ${missed.n === 1 ? 'try' : 'tries'}`;
      }
    }
    return { id: ex.id, name: ex.name, a: ra, b: rb, result, luck, why, missed, steadyA: steady(aT), steadyB: steady(bT),
      drop: both ? rate(ra) - rate(rb) : 0 };
  });
  // Steadiness is compared only over examples with a result on both versions (a stopped test must not skew it).
  const counted = rows.filter((r) => (a ? r.result !== null : r.b.total > 0));
  const side = (s) => {
    const list = of(s);
    // With two versions the averages cover only the compared examples, so tries on an example the other side never finished can't skew them.
    const ids = new Set(counted.map((r) => r.id));
    const avgList = a ? list.filter((t) => ids.has(t.exampleId)) : list;
    return {
      passed: tally(list),
      costPerTry: avg(avgList, (t) => Number(t.costUsd)),
      timePerTry: avg(avgList, (t) => (t.verdict && t.verdict.facts ? t.verdict.facts.durationMs : null)),
      sentBack: avg(avgList, (t) => (t.verdict && t.verdict.facts ? Number(t.verdict.facts.sentBack || 0) : null)),
      steady: { n: counted.filter((r) => (s === 'a' ? r.steadyA : r.steadyB)).length, of: counted.length },
    };
  };
  const tiles = { a: a ? side('a') : null, b: side('b') };
  const counts = { better: rows.filter((r) => r.result === 'better').length, worse: rows.filter((r) => r.result === 'worse').length,
    same: rows.filter((r) => r.result === 'same').length };
  const byDrop = (x, y) => y.drop - x.drop || (x.name < y.name ? -1 : 1);
  const worst = rows.filter((r) => r.result === 'worse').sort(byDrop)[0] || null;
  const clearWorst = rows.filter((r) => r.result === 'worse' && !r.luck).sort(byDrop)[0] || null;
  const allCompared = rows.length > 0 && rows.every((r) => r.result !== null);
  return {
    examples: rows, tiles, counts,
    // D38: with no example tried on both sides there is nothing to say ("gives the same results" would be untrue).
    inShort: a && counts.better + counts.worse + counts.same > 0 ? inShortSentences({ a, b, tiles, counts, worst, allCompared }) : [],
    look: a && clearWorst ? { exampleId: clearWorst.id, name: clearWorst.name, before: 'Look at ', after: ` before you share ${b.label}.` } : null,
  };
}

/** C2 (approved 2026-10-26, its three extra sentences included): the fixed sentences, each only when it applies. Cheaper or faster = at least 10% less. */
function inShortSentences({ a, b, tiles, counts, worst, allCompared }) {
  const out = [];
  const adj = [];
  const ca = tiles.a.costPerTry; const cb = tiles.b.costPerTry;
  if (ca > 0 && cb !== null) { if (cb <= ca * 0.9) adj.push('cheaper'); else if (cb >= ca * 1.1) adj.push('more expensive'); }
  const ta = tiles.a.timePerTry; const tb = tiles.b.timePerTry;
  if (ta > 0 && tb !== null) { if (tb <= ta * 0.9) adj.push('faster'); else if (tb >= ta * 1.1) adj.push('slower'); }
  const exs = (n) => (n === 1 ? '1 example' : `${n} examples`);
  const is = adj.length ? `is ${adj.join(' and ')}` : '';
  let first = true;   // sentence 1 present: later sentences say "It", otherwise the version label
  if (counts.better) out.push(is ? `${b.label} ${is}, and better on ${exs(counts.better)}.` : `${b.label} is better on ${exs(counts.better)}.`);
  else if (!counts.worse) {
    const same = allCompared ? 'on every example' : 'on the examples both versions finished';
    out.push(is ? `${b.label} ${is}, and gives the same results as ${a.label}.` : `${b.label} gives the same results as ${a.label} ${same}.`);
  } else if (is) out.push(`${b.label} ${is}.`);
  else first = false;
  const subject = first ? 'It' : b.label;
  if (counts.worse === 1 && worst) {
    out.push(worst.missed && !worst.luck
      ? `${subject} is worse on 1 example, ${worst.name}: it missed "${worst.missed.label}" in ${worst.missed.k} of ${worst.missed.n} ${worst.missed.n === 1 ? 'try' : 'tries'}.`
      : `${subject} is worse on 1 example, ${worst.name}.`);
  } else if (counts.worse > 1) out.push(`${subject} is worse on ${counts.worse} examples.`);
  if (tiles.b.steady.n < tiles.a.steady.n) out.push('Its results also vary more from try to try.');
  else if (tiles.b.steady.n > tiles.a.steady.n) out.push('Its results are also steadier from try to try.');
  return out;
}

/**
 * The Test a version dialog's live estimate (board 4). plan = GET …/tests/plan; the reuse boxes decide what is tried.
 * Range ±5%/+15% (board: about $9.40 → "$9 to $11"); default cap = 1.5 × the estimate rounded up to $5, at least $5.
 */
export function estimateOf(plan, { reuseA = true, reuseB = false } = {}) {
  const left = (s, reuse) => (s ? Math.max(0, s.want - (reuse ? s.reusable : 0)) : 0);
  const toRun = { a: left(plan.a, reuseA), b: left(plan.b, reuseB) };
  const total = toRun.a + toRun.b;
  const cost = (s, n) => (n === 0 ? 0 : s && typeof s.perTryUsd === 'number' && Number.isFinite(s.perTryUsd) ? n * s.perTryUsd : null);
  const ca = cost(plan.a, toRun.a);
  const cb = cost(plan.b, toRun.b);
  const usd = ca === null || cb === null ? null : ca + cb;
  const minutes = typeof plan.perTryMs === 'number' && Number.isFinite(plan.perTryMs) && total
    ? Math.max(1, Math.ceil((Math.ceil(total / TRIES_AT_ONCE) * plan.perTryMs) / 60000)) : null;
  const capUsd = usd ? Math.max(5, Math.ceil((usd * 1.5) / 5) * 5) : 10;
  return { toRun, total, usd, low: usd === null ? null : usd * 0.95, high: usd === null ? null : usd * 1.15, minutes, capUsd };
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60); const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60); const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** B against A: "38% less", "20% more", "the same". */
export function pctDelta(a, b) {
  if (!(a > 0) || !Number.isFinite(b)) return '';
  const p = Math.round(((b - a) / a) * 100);
  return p === 0 ? 'the same' : p < 0 ? `${-p}% less` : `${p}% more`;
}

/** B against A, in half minutes from a minute up: "1½ min less", "30 s more", "the same" (under 5 s). */
export function durationDelta(aMs, bMs) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return '';
  const d = bMs - aMs;
  const abs = Math.abs(d);
  if (abs < 5000) return 'the same';
  const word = d < 0 ? 'less' : 'more';
  if (abs < 60000) return `${Math.round(abs / 1000)} s ${word}`;
  const halves = Math.round(abs / 30000);
  return `${Math.floor(halves / 2)}${halves % 2 ? '½' : ''} min ${word}`;
}

export function countDelta(a, b) {
  const d = b - a;
  return d === 0 ? 'the same' : d > 0 ? `${d} more` : `${-d} fewer`;
}

export const fmtTimes = (n) => (Number.isFinite(n) ? `${(Math.round(n * 10) / 10).toFixed(1)}×` : '');

/** "about $15", "of about $10", "stops at $15": whole dollars from $5 up, cents below (boards 4 and 20). */
export const aboutUsd = (n) => (n >= 5 ? `$${Math.round(n)}` : fmtUsd(n));

/** Whole dollars from $5 up ("$9 to $11"), cents below. */
export function fmtUsdRange(low, high) {
  if (high >= 5) return `$${Math.round(low)} to $${Math.round(high)}`;
  return `${fmtUsd(low)} to ${fmtUsd(high)}`;
}
