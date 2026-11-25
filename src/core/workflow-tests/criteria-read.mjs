// src/core/workflow-tests/criteria-read.mjs — Part 4 reads (plans/workflow-tests-part4-plan.md D95, D98, D99): trust per criterion key and
// model; Task 9 adds the tries with their criteria and Compare's notes. No model calls here.
import { trustOf } from '../../shared/workflow-tests/criteria.mjs';
import * as cs from './criteria-store.mjs';
import { mainResult, readTryPatch } from './result.mjs';
import { CHANGES_HEADING } from './judge-prompt.mjs';
import * as store from './store.mjs';
import { compareModel } from '../../shared/workflow-tests/compare.mjs';
import { byCriterionModel, checkingCounts, trustReportModel } from '../../shared/workflow-tests/criteria-report.mjs';
import { prepare } from '../db.mjs';
import { ratesFor } from '../helper-call/cost.mjs';
import { estimateCost } from '../config.mjs';
import { criterionResult, withCriteria, unreliableOnly, notCheckedEverywhere, finishedTry } from '../../shared/workflow-tests/criteria-verdicts.mjs';

/** D95. `memo` (a Map) keeps one read per key and model inside one page's read. */
export function trustFor(workflowId, fp, model, memo = null) {
  const k = `${fp}|${model}`;
  if (memo && memo.has(k)) return memo.get(k);
  const t = trustOf({ roundDone: cs.roundDone(workflowId, fp, model), answers: cs.answersFor(workflowId, fp, model) });
  if (memo) memo.set(k, t);
  return t;
}

/** Fix round 3 (final review M7): the codes that name the test that wrote the row ("this test reached its cost limit"; board 59 B:
 *  "you stopped the check"). */
const OWN_TEST_ERRORS = Object.freeze(['cap', 'limit', 'stopped']);
/**
 * D98: tries as the pages read them: with their criteria (the example's current ones, checked by its current model). `runId` = the
 * test the page shows: a 'cap' or 'limit' row another test wrote (a newer test that reused this try) reads as not checked yet there.
 */
export function withCriteriaFor(workflowId, tries, { withAnswers = false, by = null, runId = null } = {}) {
  if (!tries.length) return tries;
  const examples = new Map();
  const exOf = (id) => { if (!examples.has(id)) examples.set(id, store.readExample(workflowId, id)); return examples.get(id); };
  const js = new Map(cs.tryJudgements(tries.map((t) => t.id)).map((j) => [`${j.tryId}|${j.fp}|${j.model}`, j]));
  const memo = new Map();
  return withCriteria(tries, (t) => {
    const ex = exOf(t.exampleId);
    const model = ex && ex.judge ? ex.judge.model : null;
    if (!ex || !model || !ex.criteria.length) return null;
    return ex.criteria.map((c) => {
      const fp = cs.criterionFp(c.text);
      const row = js.get(`${t.id}|${fp}|${model}`) || null;
      const j = row && OWN_TEST_ERRORS.includes(row.error) && (runId == null || row.testRunId !== Number(runId)) ? null : row;
      // I9: the side by side shows the viewer's earlier Agree / Disagree (by = actorOf(req); '' without identities).
      return criterionResult(c, j, trustFor(workflowId, fp, model, memo), { finished: finishedTry(t),
        ...(withAnswers && j ? { answer: cs.answerOf(j.id, by) } : {}) });
    });
  });
}

/**
 * P4-M5: the criteria not checked on every finished try, with why. 'new': no try of the run has any judgement of the criterion's
 * current words (it was added or changed after the test); 'unchecked': otherwise (the limit, the cap, a stop or a failed call left it).
 * The run records no criteria at its start, so the end of every test (and boot, for a test a restart cut short) writes a no-cost
 * row for each criterion it left unchecked (criteria-runner.mjs leaveUnchecked). That sweep reads the criteria as they are at the
 * END of the test, and rows belong to tries, not tests: a criterion added during a test, or added between two tests that reuse a
 * try, reads 'unchecked' here, not 'new'. An exact rule needs a snapshot of the criteria on the run (a schema rung; not now).
 * Final review M7, the same cause: the row's code ('cap', 'limit', 'failed') is the state at the end of the test that wrote it. A
 * newer test that reuses an older test's try writes its own end state on that try, so the older test can show "Not checked: this
 * test reached its cost limit" when only the newer one did; and boot writes 'failed' for every test a restart cut short, also one
 * that had reached its cap. Fix round 3: rows record their test (test_run_id); withCriteriaFor words 'cap' and 'limit' only on that
 * test, and boot records 'cap' for a test at its own cost limit. The band above Compare uses the viewed test's own cost.
 * An example with both gets one entry for each reason.
 */
export function reasonOfCriterion(tryIds) {
  const asked = new Set(cs.tryJudgements(tryIds).map((j) => j.fp));
  return (label) => (asked.has(cs.criterionFp(label)) ? 'unchecked' : 'new');
}
export function notCheckedOf(input) {
  const reasonOf = reasonOfCriterion(input.tries.map((t) => t.id));
  return notCheckedEverywhere(input.tries, input.examples).flatMap((n) => ['new', 'unchecked']
    .map((reason) => ({ ...n, reason, criteria: n.criteria.filter((l) => reasonOf(l) === reason) })).filter((e) => e.criteria.length));
}

/** D98, P4-M5: Compare's notes. `input` = compareModel's input whose tries came through withCriteriaFor. */
export function compareNotes(input) {
  const notChecked = notCheckedOf(input);   // I6
  if (!input.a) return { unreliableOnly: [], notChecked };
  const shadow = compareModel({ ...input, tries: input.tries.map((t) => (t.shadowStatus ? { ...t, status: t.shadowStatus } : t)) });
  return { unreliableOnly: unreliableOnly(compareModel(input), shadow), notChecked };
}

/** The trust of each criterion of an example (its current model); exact checks made from a criterion count as 'exact'. */
export function trustOfExample(ex, memo = new Map()) {
  const model = ex.judge ? ex.judge.model : null;
  const out = {};
  for (const c of ex.criteria || []) out[c.id] = model ? trustFor(ex.workflowId, cs.criterionFp(c.text), model, memo) : null;
  return out;
}
/** Boards 1 and 5: the counts over these examples (all of the workflow when `exampleIds` is null). */
export function checkingOf(workflowId, exampleIds = null) {
  const memo = new Map();
  const exs = store.listExamples(workflowId).filter((e) => !exampleIds || exampleIds.includes(e.id));
  return checkingCounts(exs.flatMap((e) => [...Object.values(trustOfExample(e, memo)), ...(e.checks || []).filter((k) => k.said).map(() => ({ state: 'exact' }))]));
}
/** Board 12. `run` = the test (store.readTestRun shape). A row not checked everywhere says why (`reason`, as Compare's notes do). */
export function byCriterionOf(workflowId, run) {
  const memo = new Map();
  const examples = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter(Boolean)
    .map((e) => ({ id: e.id, name: e.name, criteria: e.criteria, checks: e.checks, trust: trustOfExample(e, memo) }));
  const tries = withCriteriaFor(workflowId, store.triesOfRun(run.id), { runId: run.id });
  const m = byCriterionModel({ examples, hasA: run.a != null, tries });
  const reasonOf = reasonOfCriterion(tries.map((t) => t.id));
  const rows = m.rows.map((r) => (r.uneven ? { ...r, reason: r.exact ? 'unchecked' : reasonOf(r.label) } : r));
  return { ...m, rows, counts: checkingOf(workflowId, run.exampleIds), checkUsd: checkUsdOf(workflowId, run) };
}

/** Whether a finished try still misses a criterion of its example (never asked, or the last answer hit the limit or failed). */
export function needsCriteriaJudging(example, t) {
  const model = example && example.judge ? example.judge.model : null;
  if (!model || !finishedTry(t)) return 0;
  return (example.criteria || []).filter((c) => cs.needsJudging(t.id, cs.criterionFp(c.text), model)).length;
}
/** The price of one check per model, asked once per helper call (each read is a ledger query). null = not known. */
const priceMemo = () => { const m = new Map(); return (model) => { if (!m.has(model)) m.set(model, judgeCallUsd(model)); return m.get(model); }; };
/**
 * What checking the criteria these finished tries still miss would cost, each at its own example's model: 0 only when nothing is
 * missing (or the tries are mock: a mock check is free); null when something is missing and its price is not known (never $0).
 * `pairs` = [{ ex, t }]. Shared by "Check them on these tries" and the estimate of reused tries.
 */
export function missingChecksUsd(pairs, price = priceMemo()) {
  let usd = 0;
  for (const { ex, t } of pairs) {
    if (!ex || !t || t.mock) continue;
    const n = needsCriteriaJudging(ex, t);
    if (!n) continue;
    const one = price(ex.judge.model);
    if (one === null) return null;
    usd += n * one;
  }
  return usd;
}
/** P4-M5, board 4: what "Check them on these tries" would cost for this test. */
export function checkUsdOf(workflowId, run) {
  const examples = new Map();
  const pairs = [];
  for (const t of store.triesOfRun(run.id)) {
    if (t.status !== 'passed' && t.status !== 'failed') continue;
    if (!examples.has(t.exampleId)) examples.set(t.exampleId, store.readExample(workflowId, t.exampleId));
    pairs.push({ ex: examples.get(t.exampleId), t });
  }
  return missingChecksUsd(pairs);
}
/**
 * Board 4, one side of a test: what checking its criteria costs per example (that example's criteria x its model's price), with
 * every try new (`fresh`) or with the reusable tries kept (`withReuse`: the new ones, plus the checks the kept ones still miss).
 * `items` = [{ ex, kept }] for every example to try; `mock` = a mock test, whose checks are free. null = a price is not known.
 */
export function sideCheckPlan(items, tries, { mock = false } = {}) {
  if (mock) return { fresh: 0, withReuse: 0 };
  const price = priceMemo();
  let fresh = 0;
  let withReuse = 0;
  for (const { ex, kept } of items) {
    const n = ex.judge ? (ex.criteria || []).length : 0;
    if (!n) continue;
    const one = price(ex.judge.model);
    const newTries = Math.max(0, tries - kept.length);
    // An unknown price makes the new tries unknown; tries that are all kept (and fully checked) need no price.
    fresh = one === null || fresh === null ? null : fresh + tries * n * one;
    if (newTries) withReuse = one === null || withReuse === null ? null : withReuse + newTries * n * one;
  }
  const missing = missingChecksUsd(items.flatMap(({ ex, kept }) => kept.map((t) => ({ ex, t }))), price);
  return { fresh, withReuse: withReuse === null || missing === null ? null : withReuse + missing };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Whether the criteria phase asks the pair question (judgePairs, Task 14). */
const PAIRS_ASKED = true;
/** Board 4: what one check of a criterion costs on `model`: its own last 20, else a typical call (6000 tokens in, 250 out) at its price. */
export function judgeCallUsd(model, { rates = (m) => ratesFor('claude', m), estimate = estimateCost } = {}) {
  // The ledger has no try or criterion column, so one row is priced as one check (a check the judge asked twice books two rows,
  // so a per-row median errs a little LOW for repeated checks, never high). M6: an 'unknown'-cost row is a $0 that is not a price; if any of the recent rows
  // is one, the price is not known (null), never a median pulled down to $0.
  const rows = prepare(`SELECT amount_usd AS u, cost_kind AS k FROM wf_test_judge_ledger WHERE purpose = 'try' AND model = ? ORDER BY id DESC LIMIT 20`).all(model);
  if (rows.some((r) => r.k === 'unknown')) return null;
  const own = rows.map((r) => Number(r.u));
  if (own.length) return median(own);
  const priced = model ? rates(model) : null;
  return priced ? estimate({ input_tokens: 6000, output_tokens: 250 }, priced) : null;
}
/** Board 4: what one pair costs (2 calls, P4-Q8) on `model`: twice the median of its own last 20 'pair' ledger rows; with none yet, twice the
 *  price of a criterion check (judgeCallUsd), the nearest known price. Any recent 'unknown' pair row makes it not known (null), never $0. */
export function pairUsd(model) {
  const rows = prepare(`SELECT amount_usd AS u, cost_kind AS k FROM wf_test_judge_ledger WHERE purpose = 'pair' AND model = ? ORDER BY id DESC LIMIT 20`).all(model);
  if (rows.some((r) => r.k === 'unknown')) return null;
  if (rows.length) return 2 * median(rows.map((r) => Number(r.u)));
  const one = judgeCallUsd(model);
  return one === null ? null : 2 * one;
}
/** Board 4: the pair question's price: one pair per chosen example that has a judge model and criteria or a result you liked (what
 *  judgePairs asks); null when no chosen example gets one. The checks themselves are priced per side (sideCheckPlan). */
export function criteriaPlanOf(workflowId, exampleIds = [], { hasA = false, mock = false } = {}) {
  const exs = store.listExamples(workflowId).filter((e) => (!exampleIds.length || exampleIds.includes(e.id)) && e.judge && (e.criteria.length || cs.readLiked(e.id)));
  if (!exs.length) return null;
  if (mock || !PAIRS_ASKED || !hasA) return { pairsUsd: 0 };   // a mock test checks for free
  const memo = new Map();
  const prices = exs.map((e) => { if (!memo.has(e.judge.model)) memo.set(e.judge.model, pairUsd(e.judge.model)); return memo.get(e.judge.model); });
  return { pairsUsd: prices.some((u) => u === null) ? null : prices.reduce((sum, u) => sum + u, 0) };
}

/** M9: at most `max` bytes of `text` as UTF-8, cut before a character, never inside one (putLiked refuses broken UTF-8). */
const utf8Clip = (text, max) => {
  const b = Buffer.from(text);
  if (b.length <= max) return b;
  let end = max;
  while (end > 0 && (b[end] & 0xc0) === 0x80) end -= 1;
  return b.subarray(0, end);
};
/** D101: a past run's or a try's result as the example's result you liked; a project example keeps the diff too (board 32's name). */
export async function likedFromPipeline(example, pipelineId, { readMain = mainResult, readPatch = readTryPatch, at = null } = {}) {
  const m = await readMain(pipelineId);
  if (typeof m.text !== 'string' || !m.text.trim()) throw store.testError('this run left no result to keep', 'BAD_REQUEST');
  if (!example.project) { cs.putLiked(example.id, { kind: 'text', name: m.name || 'result.md', data: utf8Clip(m.text, cs.LIKED_MAX), fromPipeline: pipelineId }); return; }
  const p = await readPatch(pipelineId, cs.LIKED_MAX);
  const files = p && p.patch ? (p.patch.match(/^diff --git /gm) || []).length : 0;
  const date = new Date(at || Date.now());
  const on = Number.isNaN(date.getTime()) ? '' : ` on ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const text = p && p.patch ? `${m.text}\n\n${CHANGES_HEADING}\n${p.patch}` : m.text;
  cs.putLiked(example.id, { kind: 'changes', name: `Changes from the run${on} · ${files} ${files === 1 ? 'file' : 'files'}`,
    data: utf8Clip(text, cs.LIKED_MAX), fromPipeline: pipelineId });
}

/** D100: the pair answer of an example's first tries, for the side by side (P4-M6); null without one. */
export function pairOf(tA, tB, { by = null } = {}) {
  if (!tA || !tB) return null;
  const j = cs.pairJudgement(tA.id, tB.id);
  if (!j || !j.winner) return null;
  return { judgementId: j.id, winner: j.winner, reason: j.reason, question: j.variant && j.variant.question === 'liked' ? 'liked' : 'better', answer: cs.answerOf(j.id, by) };
}

/** Board 13 (D95-D100): the trust report of a workflow. `checker` = the routes' instance, for its `view`. */
export function trustReportOf(workflowId, { checker }) {
  const memo = new Map();
  const examples = store.listExamples(workflowId);
  const live = new Set();   // `${fp}|${model}` of every criterion as it stands: only these count (old words and old models do not)
  const liveEx = new Set(); // `${exampleId}|${model}`
  const criteria = examples.flatMap((e) => {
    const t = trustOfExample(e, memo);
    const model = e.judge ? e.judge.model : null;
    if (model) liveEx.add(`${e.id}|${model}`);
    return e.criteria.map((c) => {
      const key = model ? `${cs.criterionFp(c.text)}|${model}` : null;
      if (key) live.add(key);
      return { exampleId: e.id, exampleName: e.name, criterionId: c.id, text: c.text, trust: t[c.id], trustKey: key };
    });
  });
  const rounds = cs.latestRounds(workflowId).filter((r) => live.has(`${r.fp}|${r.model}`)).map((r) => {
    const v = checker.view(r, { anyone: true });   // I9: whoever answered a card, not only the viewer
    return { criterionText: v.criterion, cards: v.cards, same: v.auto.same, padding: v.auto.padding, at: r.finishedAt, cost: v.costUsd };
  });
  const pairs = cs.pairJudgements(workflowId, liveEx).map((j) => ({ winner: j.winner, swapped: j.variant ? j.variant.swapped : null }));
  const lastAt = rounds.map((r) => r.at).filter(Boolean).sort().at(-1) || null;
  // Task 23: the exact checks made from a criterion count in "Criteria you can trust" as on board 1's card (checkingOf).
  const exactChecks = examples.reduce((s, e) => s + (e.checks || []).filter((k) => k.said).length, 0);
  return trustReportModel({ criteria, rounds, pairs, proofs: cs.tryProofCounts(workflowId, live), lastAt, costUsd: rounds.reduce((s, r) => s + r.cost, 0), exactChecks });
}
