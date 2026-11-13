// src/shared/workflow-tests/compare.mjs
// Comparing two versions on the same examples (plans/workflow-tests-part2-plan.md D28; canvas boards 1, 4, 5, 6, 20).
// Pure and browser-safe: the server computes the model, the pages format it. Better or worse is decided by tries
// passed (Basics and automatic checks only, D18). "In short" is put together from the fixed sentences of C2, never by AI.
import { fmtUsd, fmtUsdFine } from './checks.mjs';

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
  return use === ctx.liveVersionNo ? `${short} · in use` : short;
}

/** The tested version inside a sentence: "your v5 draft", "your draft", "v4". */
const bWords = (use, ctx) => {
  const s = useLabel(use, ctx);
  return use === 'draft' ? (s === 'Your draft' ? 'your draft' : `your ${s}`) : s;
};

/** "Your v5 draft compared with v4", "v5 compared with v4" (running, done and stopped alike, U-T8 F20); one try:
 *  "Trying once: <example>" while it runs (mode 'testing'), "Tried once: <example>" after. */
export function testTitle(run, ctx = {}, { mode = 'compare', exampleName = '' } = {}) {
  if (run.kind === 'once') return `${mode === 'testing' ? 'Trying' : 'Tried'} once: ${exampleName || 'an example'}`;
  const b = bWords(run.b, ctx);
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

/** How many of the given tries missed each Basic or check (label → count). */
function missCounts(list) {
  const counts = new Map();
  for (const t of list) {
    const v = t.verdict || {};
    for (const item of [...(v.basics || []), ...(v.checks || [])]) if (item && !item.met) counts.set(item.label, (counts.get(item.label) || 0) + 1);
  }
  return counts;
}

/** The Basic or check the given tries missed most often (ties: by label). */
function missedMost(list) {
  let best = null;
  for (const [label, k] of missCounts(list)) if (!best || k > best.k || (k === best.k && label < best.label)) best = { label, k };
  return best;
}

/** Every check the loser missed more often than the winner (D5, U-T5 F9): most missed first, ties by label. */
function missedMore(loserList, winnerList) {
  const w = missCounts(winnerList);
  const n = loserList.length;
  const out = [];
  for (const [label, k] of missCounts(loserList)) if (k / n > (w.get(label) || 0) / winnerList.length + 1e-9) out.push({ label, k, n });
  return out.sort((x, y) => y.k - x.k || (x.label < y.label ? -1 : 1));
}

const triesWord = (n) => (n === 1 ? 'try' : 'tries');
const kOfN = (m) => `${m.k} of ${m.n} ${triesWord(m.n)}`;
const namesText = (list) => {
  const parts = list.map((m) => `"${m.label}" (${kOfN(m)})`);
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};
const n1 = (x) => String(Math.round(x * 10) / 10);
const timesWord = (x) => (n1(x) === '1' ? 'time' : 'times');
const timesATry = (x) => `${n1(x)} ${timesWord(x)} a try`;

const avg = (list, f) => {
  const xs = list.map(f).filter((x) => typeof x === 'number' && Number.isFinite(x));
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
};
const costOf = (t) => Number(t.costUsd);
const timeOf = (t) => (t.verdict && t.verdict.facts ? t.verdict.facts.durationMs : null);
const sentOf = (t) => (t.verdict && t.verdict.facts ? Number(t.verdict.facts.sentBack || 0) : null);
const perTry = (list) => ({ n: list.length, cost: avg(list, costOf), time: avg(list, timeOf), sentBack: avg(list, sentOf) });

/** D5: how many a try before "cheaper / more expensive / faster / slower / sent back more" is true: a share of A and a floor. */
const DIFF_AT = { cost: { share: 0.2, floor: 0.01 }, time: { share: 0.2, floor: 10000 }, sentBack: { share: 0, floor: 0.5 } };

/**
 * The one rule for the tiles, "In short" and the rows. a, b = the average a try; nA, nB = the finished tries behind them.
 * Returns 'more' or 'less' (B against A), 'same' (a gap under the threshold), or null (cannot tell: under 2 finished tries
 * on a side, or no number). A $0 baseline has no share, so the absolute part alone decides.
 */
export function differs(kind, a, b, nA, nB) {
  const t = DIFF_AT[kind];
  if (!t || !(nA >= 2) || !(nB >= 2) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = b - a;
  if (Math.abs(d) < t.floor - 1e-9) return 'same';
  if (t.share && a > 0 && Math.abs(d) < a * t.share - 1e-9) return 'same';
  return d > 0 ? 'more' : 'less';
}
const diffOf = (a, b) => ({ cost: differs('cost', a.costPerTry, b.costPerTry, a.n, b.n), time: differs('time', a.timePerTry, b.timePerTry, a.n, b.n),
  sentBack: differs('sentBack', a.sentBack, b.sentBack, a.n, b.n) });

/** "Same result, but B costs 2.5× as much a try ($0.0500 against $0.0200), and is sent back for fixes 2 times a try, against 1." (F10) */
function sameButWhy(label, pa, pb) {
  const isDiff = (v) => v === 'more' || v === 'less';
  const cost = isDiff(differs('cost', pa.cost, pb.cost, pa.n, pb.n));
  const sent = isDiff(differs('sentBack', pa.sentBack, pb.sentBack, pa.n, pb.n));
  if (!cost && !sent) return null;
  const sentText = `is sent back for fixes ${timesATry(pb.sentBack)}, against ${n1(pa.sentBack)}`;
  if (!cost) return `Same result, but ${label} ${sentText}.`;
  const how = pa.cost > 0 ? `${fmtTimes(pb.cost / pa.cost)} as much` : (pb.cost > pa.cost ? 'more' : 'less');
  return `Same result, but ${label} costs ${how} a try (${fmtUsdFine(pb.cost)} against ${fmtUsdFine(pa.cost)})${sent ? `, and ${sentText}` : ''}.`;
}

/**
 * @param {{examples: Array<{id:number, name:string}>, a: {label:string}|null, b: {label:string},
 *   tries: Array<{side:'a'|'b', exampleId:number, status:string, costUsd:number, verdict:object|null}>}} input
 */
export function compareModel({ examples = [], a = null, b, tries = [] }) {
  const done = tries.filter((t) => FINISHED.has(t.status));
  const of = (side, exampleId = null) => done.filter((t) => t.side === side && (exampleId === null || t.exampleId === exampleId));
  const tally = (list) => ({ passed: list.filter((t) => t.status === 'passed').length, total: list.length });
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
    let missedList = [];
    let failsBoth = false;
    if (both) {
      const d = rate(rb) - rate(ra);
      failsBoth = rate(ra) < 0.5 && rate(rb) < 0.5;   // F8: neither version gets this one right, whatever the luck rule says
      result = failsBoth || Math.abs(d) < 1e-9 ? 'same' : d > 0 ? 'better' : 'worse';
      if (failsBoth) {
        const m = missedMost([...aT, ...bT]);
        why = m ? `Fails on both versions: "${m.label}" is missed most (${m.k} of ${aT.length + bT.length} ${triesWord(aT.length + bT.length)}). Look at the example or its checks.`
          : 'Fails on both versions. Look at the example or its checks.';
      } else if (result !== 'same') {
        luck = Math.abs(d) * Math.min(ra.total, rb.total) <= LUCK_MAX_DIFF + 1e-9;   // the smaller side decides: one try can't prove it
        const loser = result === 'worse' ? { label: b.label, list: bT, other: aT } : { label: a.label, list: aT, other: bT };
        missedList = missedMore(loser.list, loser.other);
        if (!luck && missedList.length) why = `${loser.label} missed ${namesText(missedList)}`;
      } else {
        why = sameButWhy(b.label, perTry(aT), perTry(bT));   // F10
      }
    }
    const every = (list, r) => list.length > 0 && r.passed === r.total;   // passed in every try
    const mixed = (r) => r.passed > 0 && r.passed < r.total;
    return { id: ex.id, name: ex.name, a: ra, b: rb, result, luck, why, missedList, failsBoth, passEveryA: every(aT, ra), passEveryB: every(bT, rb),
      mixedA: mixed(ra), mixedB: mixed(rb), drop: both ? rate(ra) - rate(rb) : 0 };
  });
  // Steadiness is compared only over examples with a result on both versions (a stopped test must not skew it).
  const counted = rows.filter((r) => (a ? r.result !== null : r.b.total > 0));
  const side = (s) => {
    const list = of(s);
    // With two versions the averages cover only the compared examples, so tries on an example the other side never finished can't skew them.
    const ids = new Set(counted.map((r) => r.id));
    const avgList = a ? list.filter((t) => ids.has(t.exampleId)) : list;
    const pt = perTry(avgList);
    return {
      passed: tally(list), n: pt.n, costPerTry: pt.cost, timePerTry: pt.time, sentBack: pt.sentBack,
      // F11: steady = passed in every try (an example that failed every try is steady, but not good news); mixed = some passed, some not.
      steady: { n: counted.filter((r) => (s === 'a' ? r.passEveryA : r.passEveryB)).length, of: counted.length },
      mixed: counted.filter((r) => (s === 'a' ? r.mixedA : r.mixedB)).length,
    };
  };
  const tiles = { a: a ? side('a') : null, b: side('b') };
  tiles.diff = tiles.a ? diffOf(tiles.a, tiles.b) : { cost: null, time: null, sentBack: null };
  const counts = { better: rows.filter((r) => r.result === 'better').length, worse: rows.filter((r) => r.result === 'worse').length,
    same: rows.filter((r) => r.result === 'same').length };
  const byDrop = (x, y) => y.drop - x.drop || (x.name < y.name ? -1 : 1);
  const worst = rows.filter((r) => r.result === 'worse').sort(byDrop)[0] || null;
  // Look at: the clear worse example with the most missed checks, then the biggest drop; equal ones are counted.
  const clear = rows.filter((r) => r.result === 'worse' && !r.luck)
    .sort((x, y) => y.missedList.length - x.missedList.length || byDrop(x, y));
  const top = clear[0] || null;
  const alike = top ? clear.filter((r) => r.missedList.length === top.missedList.length && Math.abs(r.drop - top.drop) < 1e-9).length - 1 : 0;
  const allCompared = rows.length > 0 && rows.every((r) => r.result !== null);
  const comparedRows = rows.filter((r) => r.result !== null);
  const ids = new Set(comparedRows.map((r) => r.id));
  const nothing = !!a && comparedRows.length > 0 && comparedRows.every((r) => r.failsBoth)
    ? { ...(missedMost(done.filter((t) => ids.has(t.exampleId))) || {}), n: done.filter((t) => ids.has(t.exampleId)).length } : null;
  // Final review M2: the examples both versions fail most tries of are counted as 'same' (F8) but said apart in "In short".
  const failsBoth = comparedRows.filter((r) => r.failsBoth).length;
  return {
    examples: rows, tiles, counts,
    // D38: with no example tried on both sides there is nothing to say ("gives the same results" would be untrue).
    inShort: a && counts.better + counts.worse + counts.same > 0 ? inShortSentences({ a, b, tiles, counts, worst, allCompared, nothing, failsBoth }) : [],
    look: a && top ? { exampleId: top.id, name: top.name, before: 'Look at ', after: `${alike > 0 ? ` (and ${alike} more like it)` : ''} before you share ${b.label}.` } : null,
  };
}

/** C2 (approved 2026-10-26, its three extra sentences included) with D5: the fixed sentences, each only when it applies and the rule of `differs` says so. */
function inShortSentences({ a, b, tiles, counts, worst, allCompared, nothing, failsBoth = 0 }) {
  const out = [];
  const { diff } = tiles;
  const adj = [];
  if (diff.cost === 'more' || diff.cost === 'less') adj.push(diff.cost === 'less' ? 'cheaper' : 'more expensive');
  if (diff.time === 'more' || diff.time === 'less') adj.push(diff.time === 'less' ? 'faster' : 'slower');
  const exs = (n) => (n === 1 ? '1 example' : `${n} examples`);
  const is = adj.length ? `is ${adj.join(' and ')}` : '';
  let first = true;   // an earlier sentence names the version: later ones say "It", otherwise the version label
  if (nothing) {   // F7: no example passes most tries on either side (final review M2: a few passed tries may)
    out.push('Neither version passes most tries of any example yet.');
    if (nothing.label) out.push(`Most often missed: "${nothing.label}" (${nothing.k} of ${nothing.n} ${triesWord(nothing.n)}).`);
    if (is) out.push(`${b.label} ${is} than ${a.label}.`);
    else first = false;   // nothing has named the version yet
  } else if (counts.better) out.push(is ? `${b.label} ${is}, and better on ${exs(counts.better)}.` : `${b.label} is better on ${exs(counts.better)}.`);
  else if (!counts.worse) {
    // Final review M2: with examples that fail on both, "the same results" counts only the others (there is one: not `nothing`).
    const same = failsBoth ? `on ${exs(counts.same - failsBoth)}` : allCompared ? 'on every example' : 'on the examples both versions finished';
    out.push(is ? `${b.label} ${is}, and gives the same results as ${a.label}${failsBoth ? ` ${same}` : ''}.` : `${b.label} gives the same results as ${a.label} ${same}.`);
  } else if (is) out.push(`${b.label} ${is}.`);
  else first = false;
  const subject = first ? 'It' : b.label;
  let named = first;   // some sentence above already names the version
  if (counts.worse >= 1) named = true;
  if (counts.worse === 1 && worst) {
    out.push(worst.missedList.length && !worst.luck
      ? `${subject} is worse on 1 example, ${worst.name}: it missed ${namesText(worst.missedList)}.`
      : `${subject} is worse on 1 example, ${worst.name}.`);
  } else if (counts.worse > 1) out.push(`${subject} is worse on ${counts.worse} examples.`);
  if (diff.sentBack === 'more' || diff.sentBack === 'less') {
    out.push(`${named ? 'It' : b.label} is sent back for fixes ${diff.sentBack} often: ${timesATry(tiles.b.sentBack)}, against ${n1(tiles.a.sentBack)}.`);
    named = true;
  }
  // F11: steadier only counts examples that passed every try; "vary more" only examples with mixed results.
  if (tiles.b.mixed > tiles.a.mixed) out.push(`${named ? 'Its' : `${b.label}'s`} results also vary more from try to try.`);
  else if (tiles.b.steady.n > tiles.a.steady.n) out.push(`${named ? 'Its' : `${b.label}'s`} results are also steadier from try to try.`);
  // Final review M2: last, so no "It" above can be read as the example.
  if (!nothing && failsBoth) {
    const one = failsBoth === 1;
    out.push(`On ${exs(failsBoth)} both fail most tries: look at ${one ? 'it' : 'them'} or ${one ? 'its' : 'their'} checks.`);
  }
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

/** A time that rounds to nothing (a test done in under half a second). */
export const UNDER_A_SECOND = 'under 1 s';

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 1) return UNDER_A_SECOND;
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
