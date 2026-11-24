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
 * Each test is good or bad (or 'none' when it has nothing to count). Planted mistakes, Asked again and Longer is not better are
 * strict: one miss, one change or one fooled criterion is a problem. Order swapped and Proof for every verdict are shares: good from
 * AGREE_MIN (80%, the people test's bar), as board 13 draws 17 of 18 pairs and 214 of 216 proofs as Good (verdicts without proof
 * are not counted anyway), bad below it (Task 23 fix round 1).
 * P4-M4's early states: `state` is 'no-criteria' (no criteria and no exact check made from one), 'no-answers' (criteria wait for
 * answers and nobody answered yet) or 'ready';
 * `colleagues` is false until Part 5 brings their blind reviews, so tile 1's sub-line is "of N answers" (n).
 */
export function trustReportModel({ criteria = [], rounds = [], pairs = [], proofs = { found: 0, of: 0 }, lastAt = null, costUsd = 0, exactChecks = 0 }) {
  // Trust is per criterion words and model, so criteria shared by several examples (same `trustKey`) count their answers once.
  const once = new Map();
  criteria.forEach((c, i) => { if (c.trust) once.set(c.trustKey != null ? c.trustKey : `row${i}`, c.trust); });
  const n = [...once.values()].reduce((s, t) => s + t.n, 0);
  const agree = [...once.values()].reduce((s, t) => s + t.agree, 0);
  let caught = 0; let of = 0; const missedOn = [];
  for (const r of rounds) {
    // Review I1: a mock round's blind plant (it cannot know the criterion) counts only when the person said Worca was wrong on it.
    const planted = r.cards.filter((c) => c.planted && (!c.blind || c.answer === false));
    const miss = planted.filter((c) => c.met === true && c.answer !== true).length;   // met on a planted mistake, unless the person said that is right
    of += planted.length; caught += planted.length - miss;
    if (miss) missedOn.push(r.criterionText);
  }
  const sameRounds = rounds.filter((r) => r.same.of > 0);   // a round whose repeats did not run says nothing
  const padRounds = rounds.filter((r) => r.padding.of > 0);
  const again = sameRounds.filter((r) => r.same.n === r.same.of).length;
  const fooled = padRounds.filter((r) => r.padding.n < r.padding.of).length;
  const pairsSame = pairs.filter((p) => p.winner && p.winner !== 'unsure').length;
  const state = (ok, any) => (!any ? 'none' : ok ? 'good' : 'bad');
  // Order and proof pass from AGREE_MIN (board 13) only from ANSWERS_NEEDED samples, as the people test; with fewer, every miss counts.
  const share = (ok, of) => ok === of || (of >= ANSWERS_NEEDED && ok >= AGREE_MIN * of);
  const tests = [
    { key: 'planted', state: state(caught === of, of), caught, of, missedOn },
    { key: 'again', state: state(again === sameRounds.length, sameRounds.length), n: again, of: sameRounds.length },
    { key: 'order', state: state(share(pairsSame, pairs.length), pairs.length), n: pairsSame, of: pairs.length },
    { key: 'longer', state: state(fooled === 0, padRounds.length), fooled },
    { key: 'proof', state: state(share(proofs.found, proofs.of), proofs.of), n: proofs.found, of: proofs.of },
    // User decision 5: 1 to 9 answers are 'waiting' (the line shows the real numbers and what Worca needs), never good or bad.
    { key: 'people', state: n > 0 && n < ANSWERS_NEEDED ? 'waiting' : state(n > 0 && agree / n >= AGREE_MIN, n >= ANSWERS_NEEDED), n, agree, pct: pct(agree, n) },
  ];
  // A criterion shared by several examples (one trust key) is one thing to do; its first example opens Check the checker.
  const seen = new Set();
  const first = criteria.filter((c, i) => { const key = c.trustKey != null ? c.trustKey : `row${i}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const todoOf = (kind, s) => first.filter((c) => c.trust && c.trust.state === s)
    .map((c) => ({ kind, exampleId: c.exampleId, exampleName: c.exampleName, criterionId: c.criterionId, text: c.text }));
  const todo = [...todoOf('fix', 'unreliable'), ...todoOf('confirm', 'confirm')];
  // "Criteria you can trust" counts as board 1's card (checkingCounts): each criterion with a model by its trust mark, and each exact
  // check made from a criterion (`exactChecks`, the `said` checks) as reliable. A criterion an exact check could replace still counts
  // by its own mark, though its row shows only the violet suggestion (user decision 2): its AI checking is what this page tests.
  const k = checkingCounts([...criteria.map((c) => c.trust), ...Array.from({ length: exactChecks }, () => ({ state: 'exact' }))]);
  // Fix round 1: an exact-only workflow is ready (board 1's card shows for it); the blue box only when criteria wait for answers.
  return { state: !criteria.length && !exactChecks ? 'no-criteria' : n === 0 && k.waiting ? 'no-answers' : 'ready', colleagues: false,
    tiles: { agree: { n, agree }, planted: { caught, of, missedOn }, trusted: { n: k.reliable, of: k.total, unreliable: k.unreliable, waiting: k.waiting } },
    tests, todo, lastAt, costUsd };
}
