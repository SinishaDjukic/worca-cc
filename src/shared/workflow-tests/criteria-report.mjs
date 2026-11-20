// src/shared/workflow-tests/criteria-report.mjs — Part 4's report models (plans/workflow-tests-part4-plan.md D99; boards 1, 5, 12; Task 16
// adds board 13). Pure and browser-safe: the server computes, the pages format.
import { finishedTry } from './criteria-verdicts.mjs';
import { ANSWERS_NEEDED, AGREE_MIN } from './criteria.mjs';

/** D99: one row per criterion of each example, and per automatic check made from a criterion (`said`), with met counts per side. */
export function byCriterionModel({ examples = [], hasA = true, tries = [] }) {
  const done = tries.filter((t) => t.status === 'passed' || t.status === 'failed');
  const rows = [];
  for (const ex of examples) {
    const mine = done.filter((t) => t.exampleId === ex.id);
    const items = [
      ...(ex.criteria || []).map((c) => ({ key: `k:${c.id}`, label: c.text, exact: false, trust: (ex.trust || {})[c.id] || null,
        pick: (v) => (v.criteria || []).find((x) => x.id === c.id) })),
      ...(ex.checks || []).filter((k) => k.said).map((k) => ({ key: `c:${k.id}`, label: k.said, exact: true, trust: { state: 'exact', decides: true },
        pick: (v) => (v.checks || []).find((x) => x.id === k.id) })),
    ];
    for (const it of items) {
      const count = (side) => {
        let met = 0; let of = 0;
        for (const t of mine.filter((x) => x.side === side)) {
          const r = t.verdict ? it.pick(t.verdict) : null;
          if (r && (r.met === true || r.met === false)) { of += 1; if (r.met) met += 1; }
        }
        return { met, of };
      };
      const a = hasA ? count('a') : null;
      const b = count('b');
      let diff = null;
      if (a && a.of && b.of) {
        const d = b.met / b.of - a.met / a.of;
        if (Math.abs(d) * Math.min(a.of, b.of) >= 1 - 1e-9) diff = d > 0 ? 'better' : 'worse';   // at least one try's worth
      }
      // N8: a criterion not checked on every finished try (I6's `uneven`) decides nothing here either, as in Compare; the row says so.
      // Review (a): a criterion no finished try has a counted verdict for (the limit or the cap left it unchecked everywhere) is marked too.
      const uneven = mine.some((t) => { const r = t.verdict ? it.pick(t.verdict) : null; return !!(r && r.uneven); })
        || (!it.exact && mine.some(finishedTry) && !b.of && !(a && a.of));   // the same finishedTry as notCheckedEverywhere
      const decides = !!(it.trust && it.trust.decides) && !uneven;
      rows.push({ key: `${ex.id}|${it.key}`, label: it.label, exampleName: ex.name, exact: it.exact, trust: it.trust, a, b,
        changed: decides ? diff : null, unreliableChange: !decides && !uneven && !!diff, uneven });
    }
  }
  const allMet = (r) => r.b.of > 0 && r.b.met === r.b.of && (!r.a || (r.a.of > 0 && r.a.met === r.a.of));
  const plainTrust = (r) => r.trust && (r.trust.state === 'reliable' || r.trust.state === 'exact');
  const collapsed = (r) => !r.changed && !r.unreliableChange && !r.uneven && allMet(r) && plainTrust(r);
  const rank = (r) => (r.changed === 'worse' ? 0 : r.changed === 'better' ? 1 : 2);
  const shown = rows.filter((r) => !collapsed(r)).map((r, i) => ({ r, i })).sort((x, y) => rank(x.r) - rank(y.r) || x.i - y.i).map((x) => x.r);
  return { rows: shown, more: rows.length - shown.length };
}

/** Boards 1 and 5: how many criteria are reliable (exact checks count as reliable), unreliable, or wait for answers. */
export function checkingCounts(trusts) {
  const list = (trusts || []).filter(Boolean);
  const is = (...s) => list.filter((t) => s.includes(t.state)).length;
  return { total: list.length, reliable: is('reliable', 'exact'), unreliable: is('unreliable'), waiting: is('confirm', 'collecting') };
}

const pct = (a, n) => (n ? Math.round((a / n) * 100) : 0);
/**
 * Board 13. Agreement: people's answers over every criterion (pairs never count, D96). The board's words are in criteria-text.mjs.
 * P4-M4's early states: `state` is 'no-criteria' (nothing to trust yet), 'no-answers' (criteria, but nobody answered) or 'ready';
 * `colleagues` is false until Part 5 brings their blind reviews, so tile 1's sub-line is "of N answers" (n).
 */
export function trustReportModel({ criteria = [], rounds = [], pairs = [], proofs = { found: 0, of: 0 }, lastAt = null, costUsd = 0 }) {
  // Trust is per criterion words and model, so criteria shared by several examples (same `trustKey`) count their answers once.
  const once = new Map();
  criteria.forEach((c, i) => { if (c.trust) once.set(c.trustKey != null ? c.trustKey : `row${i}`, c.trust); });
  const n = [...once.values()].reduce((s, t) => s + t.n, 0);
  const agree = [...once.values()].reduce((s, t) => s + t.agree, 0);
  let caught = 0; let of = 0; const missedOn = [];
  for (const r of rounds) {
    const planted = r.cards.filter((c) => c.planted);
    const miss = planted.filter((c) => c.met === true && c.answer !== true).length;   // met on a planted mistake, unless the person said that is right
    of += planted.length; caught += planted.length - miss;
    if (miss) missedOn.push(r.criterionText);
  }
  const sameRounds = rounds.filter((r) => r.same.of > 0);   // a round whose repeats did not run says nothing
  const padRounds = rounds.filter((r) => r.padding.of > 0);
  const again = sameRounds.filter((r) => r.same.n === r.same.of).length;
  const fooled = padRounds.filter((r) => r.padding.n < r.padding.of).length;
  const pairsSame = pairs.filter((p) => p.winner && p.winner !== 'unsure').length;
  const count = (s) => criteria.filter((c) => c.trust && c.trust.state === s).length;
  const state = (ok, any) => (!any ? 'none' : ok ? 'good' : 'bad');
  const tests = [
    { key: 'planted', state: state(caught === of, of), caught, of, missedOn },
    { key: 'again', state: state(again === sameRounds.length, sameRounds.length), n: again, of: sameRounds.length },
    { key: 'order', state: state(pairsSame === pairs.length, pairs.length), n: pairsSame, of: pairs.length },
    { key: 'longer', state: state(fooled === 0, padRounds.length), fooled },
    { key: 'proof', state: state(proofs.found === proofs.of, proofs.of), n: proofs.found, of: proofs.of },
    { key: 'people', state: state(pct(agree, n) >= AGREE_MIN * 100, n >= ANSWERS_NEEDED), n, agree, pct: pct(agree, n) },
  ];
  const todo = [
    ...criteria.filter((c) => c.trust && c.trust.state === 'unreliable').map((c) => ({ kind: 'fix', exampleId: c.exampleId, criterionId: c.criterionId, text: c.text })),
    ...criteria.filter((c) => c.trust && c.trust.state === 'confirm').map((c) => ({ kind: 'confirm', exampleId: c.exampleId, criterionId: c.criterionId, text: c.text })),
  ];
  return { state: !criteria.length ? 'no-criteria' : n === 0 ? 'no-answers' : 'ready', colleagues: false,
    tiles: { agree: { n, agree }, planted: { caught, of, missedOn }, trusted: { n: count('reliable'), of: criteria.length, unreliable: count('unreliable'),
      waiting: count('confirm') + count('collecting') } }, tests, todo, lastAt, costUsd };
}
