// src/core/workflow-tests/checker.mjs — Check the checker (plans/workflow-tests-part4-plan.md D97, board 11). A round takes a good result,
// plants three mistakes, has the example's model check the four results (each asked twice more, and once with filler), and waits for the
// person's Right / Wrong on the four. Rounds run in the background; the page polls GET …/checker/:round.
import { mockEnabled } from '../claude-runner.mjs';
import { recordTestJudgeCost, budgetStatus as realBudgetStatus } from '../cost-budget.mjs';
import { judgeCriterion as realJudge, modelCall as realModelCall, firstLine } from './judge.mjs';
import { subjectOfTry } from './criteria-runner.mjs';
import { mainResult, readTryPatch } from './result.mjs';
import { exampleSourcesText } from './sources-text.mjs';
import { padded, deterministicPlants, copySystemPrompt, copyPrompt, parseCopyReply, copyProblem, changedExcerpt, splitChanges, usableProof, PLANT_COPIES,
  PLANT_RESULT_MAX, COPY_TIMEOUT_MS, CARD_EXCERPT_MAX } from './planted.mjs';
import { SUBJECT_MAX, CHANGES_HEADING, fenceTag } from './judge-prompt.mjs';
import { rewordCriterion } from './suggest.mjs';
import * as store from './store.mjs';
import * as cs from './criteria-store.mjs';
import { NOT_CHECKED, NO_SOURCE_TEXT, NO_PASSED_TRY_TEXT, LIMIT_TEXT, ROUND_NOT_FINISHED_TEXT, TOO_LONG_TEXT } from '../../shared/workflow-tests/criteria-text.mjs';
import { useLabel } from '../../shared/workflow-tests/compare.mjs';
import { liveVersionNo, latestVersion } from '../workflow-revisions.mjs';
import { findPipelineRowById } from '../artifacts.mjs';

/** P4-M3's empty state, board 59 A's (tried, no try passed), the limit refusal and (user decision 2026-11-22) a result too long to break:
 *  shared words, so the page can tell the 422s apart. */
export { NO_SOURCE_TEXT, NO_PASSED_TRY_TEXT, LIMIT_TEXT, TOO_LONG_TEXT };
const EXCERPT_MAX = CARD_EXCERPT_MAX;
const clip = (s) => { const t = String(s ?? '').trim(); return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX - 1)}…` : t; };

/** D97: the result you liked, else the newest passed try of the example (a real one before a mock one), else the run it came from when
 *  the person called it good. `mock`: the text came from a mock try (I14: the round then runs on the mock, never paid). */
export async function goodResultOf(example, { subjectOf = (t) => subjectOfTry(t), readMain = mainResult, readPatch = readTryPatch } = {}) {
  const liked = cs.readLiked(example.id);
  if (liked && liked.text.trim()) {
    return { kind: 'liked', text: liked.text, label: 'From the result you liked', mock: !!liked.fromPipeline && store.mockPipeline(liked.fromPipeline) };
  }
  const passed = store.triesForExample(example.id).filter((t) => t.status === 'passed' && t.pipelineId);
  const best = passed.find((t) => !t.mock) || passed[0];
  if (best) { const text = await subjectOf(best); if (text.trim()) return { kind: 'try', tryId: best.id, text, label: 'From a real result', mock: !!best.mock }; }
  if (example.from && example.from.verdict === 'good') {
    const m = await readMain(example.from.pipelineId);
    // Fix round 7 (review M4): a project example's run is checked with its diff under CHANGES_HEADING, as its tries are (subjectOfTry).
    const p = m.text && m.text.trim() && example.project ? await readPatch(example.from.pipelineId, SUBJECT_MAX) : null;
    const text = p && p.patch ? `${m.text}\n\n${CHANGES_HEADING}\n${p.patch}` : m.text;
    if (m.text && m.text.trim()) return { kind: 'run', pipelineId: example.from.pipelineId, text, label: 'From a real result', mock: store.mockPipeline(example.from.pipelineId) };
  }
  return null;
}

/** Board 59 A: some try of the example failed and none passed (review M3: a passed try with no text is not "no try passed yet"); a try
 *  that did not finish is not one. */
const triedOnce = (example) => { const ts = store.triesForExample(example.id); return !ts.some((t) => t.status === 'passed') && ts.some((t) => t.status === 'failed'); };

/** `deps.changed(round)`: called when a round's making ends, ready or failed (the routes send the changed frame). */
export function createChecker(deps = {}) {
  const d = { judgeCriterion: realJudge, modelCall: realModelCall, mock: () => mockEnabled({}), book: recordTestJudgeCost, budgetStatus: realBudgetStatus,
    subjectOf: (t) => subjectOfTry(t), contextOf: (ex) => exampleSourcesText(ex), inline: false, ...deps };
  const making = new Set();   // `${exampleId}|${criterionId}` of the rounds being made now

  /** One copy call: the spending limit read before it, its cost booked. `{ copy, why }` (copyProblem's reason, 'failed' for a call that
   *  threw), or `{ fail }` at the limit. */
  async function copyCall(round, criterion, text, plants, proof, book, still = null) {
    const b = d.budgetStatus();
    if (b && b.blocked) return { fail: NOT_CHECKED.limit };
    const tag = fenceTag();
    let r = null;
    try {
      r = await d.modelCall({ model: round.model, system: copySystemPrompt(tag, { still: !!still }),
        prompt: copyPrompt({ criterion: criterion.text, result: text, ways: plants.map((p) => p.how), tag, still }) }, { timeoutMs: COPY_TIMEOUT_MS });
    } catch (e) { if (Number(e && e.costUsd) > 0 || (e && e.costKind === 'unknown')) book(Number(e.costUsd) || 0, e.costKind || 'billed'); }
    // Outside the try (final review M1): a booking that fails after a paid call surfaces and fails the round, never goes unnoticed.
    if (r && (r.costUsd > 0 || r.costKind === 'unknown')) book(r.costUsd, r.costKind);   // P4-Q17: an unknown cost books a $0 row
    const copy = r ? parseCopyReply(r.text, tag) : null;
    return { copy, why: r ? copyProblem(text, copy, plants, { proof }) : 'failed' };
  }

  /** User decision 2026-11-21: the three broken copies, one model call each, every call booked (purpose 'checker') and the spending limit
   *  read before it. User decision 2026-11-22: only the written text is sent and broken (`split.text`); each plant is the broken text plus
   *  the unchanged changes (`split.changes`). A weak copy (it still holds `proof`) is asked for once more, and that call gets the proof
   *  (fix round 7, review I3); weak again, or any other problem (copyProblem), ends the round, since fewer than three good copies cannot
   *  make one; no free plants stand in for it. */
  async function plantCopies(round, criterion, split, book, proof) {
    if (split.text.length > PLANT_RESULT_MAX) return { fail: ROUND_NOT_FINISHED_TEXT };   // start() refuses it first (TOO_LONG_TEXT)
    const plants = [];   // { how, text }: the copies of the written text
    for (let i = 0; i < PLANT_COPIES; i += 1) {
      let got = await copyCall(round, criterion, split.text, plants, proof, book);
      if (got.why === 'weak') {
        console.warn(`[workflow-tests] check-the-checker round ${round.id}: broken copy ${i + 1} still holds the proof, asked once more`);
        got = await copyCall(round, criterion, split.text, plants, proof, book, proof);
      }
      if (got.fail) return got;
      if (got.why) {
        console.warn(`[workflow-tests] check-the-checker round ${round.id}: broken copy ${i + 1} not used (${got.why})`);
        return { fail: ROUND_NOT_FINISHED_TEXT };
      }
      plants.push({ how: got.copy.how, text: got.copy.text });
    }
    return { plants: plants.map((p) => ({ how: p.how, text: p.text + split.changes, excerpt: changedExcerpt(split.text, p.text, EXCERPT_MAX) })) };
  }

  /** User decision 2026-11-22: the passage that proves the criterion on the good result, to tell a weak copy: the good result's own earlier
   *  verdict of this criterion (a try's, met with its proof found; this round's model first), else this round's real card; null when none
   *  is met with a proof of PROOF_MIN characters in the written text (usableProof): then no copy is checked for it. */
  function proofOfGood(round, good, realJ, text) {
    const earlier = good.kind === 'try' && good.tryId != null
      ? cs.tryJudgements([good.tryId]).filter((j) => j.fp === round.fp && j.met === true && j.proofFound)
        .sort((a, b) => Number(b.model === round.model) - Number(a.model === round.model))
      : [];
    for (const j of [...earlier, realJ]) {
      const p = j && j.met === true ? usableProof(j.proof, text) : null;
      if (p) return p;
    }
    return null;
  }

  async function make(round, ex, criterion, good) {
    // Every paid call of the round books through this one function, with purpose 'checker': the copy calls and each check.
    const book = (usd, costKind) => d.book({ workflowId: round.workflowId, exampleId: ex.id, roundId: round.id, purpose: 'checker', model: round.model, amountUsd: usd, costKind });
    const mock = d.mock() || good.mock === true;   // D91, I14: a mock try's text is only ever checked by the mock
    const context = d.contextOf(ex);
    const judge = (subject) => d.judgeCriterion({ criterion: criterion.text, subject, context, model: round.model, mock, book });
    const split = splitChanges(good.text);   // user decision 2026-11-22: the written text is broken, the diff kept
    // User decision 2026-11-22: the real card is checked first, so its proof can tell a weak copy. Its row is written with the others.
    const realJ = await judge(good.text);
    if (realJ.met === null) { cs.updateRound(round.id, { status: 'failed', detail: NOT_CHECKED[realJ.error] || NOT_CHECKED.failed }); return; }
    // A mock round pays nothing: Worca's own plants. A real round: the checking model's whole copies, never the free plants.
    const made = mock
      ? { plants: deterministicPlants(split.text).slice(0, PLANT_COPIES).map((p) => ({ ...p, text: p.text + split.changes })) }
      : await plantCopies(round, criterion, split, book, proofOfGood(round, good, realJ, split.text));
    if (made.fail) { cs.updateRound(round.id, { status: 'failed', detail: made.fail }); return; }
    const real = { how: null, excerpt: clip(good.text.split(/\n{2,}/).find((p) => p.trim() && !/^#/.test(p.trim())) || good.text), text: good.text };
    const cards = [real, ...made.plants];
    const save = (subject, purpose, card, variant, j) => cs.insertJudgement({ workflowId: round.workflowId, exampleId: ex.id, criterionId: criterion.id,
      fp: round.fp, model: round.model, purpose, roundId: round.id, card, variant, subject: purpose === 'real' || purpose === 'planted' ? subject.slice(0, SUBJECT_MAX) : null, j });
    const ask = async (subject, purpose, card, variant) => save(subject, purpose, card, variant, await judge(subject));
    const variantOf = (c) => ({ how: c.how, excerpt: clip(c.excerpt), ...(c.blind ? { blind: true } : {}) });
    const mainJs = [save(real.text, 'real', 0, variantOf(real), realJ)];
    for (const [i, c] of cards.entries()) if (i > 0) mainJs.push(await ask(c.text, 'planted', i, variantOf(c)));
    // A card with no verdict (limit, failed, no proof, unreadable) is not a verdict the person can answer: the round fails now,
    // before the repeats and filler are asked (no further paid calls); the calls already made stay booked.
    const bad = mainJs.find((j) => j.met === null);
    if (bad) { cs.updateRound(round.id, { status: 'failed', detail: NOT_CHECKED[bad.error] || NOT_CHECKED.failed }); return; }
    for (const [i, c] of cards.entries()) { await ask(c.text, 'again', i, null); await ask(c.text, 'again', i, null); }
    for (const [i, c] of cards.entries()) await ask(padded(c.text), 'padded', i, null);
    cs.updateRound(round.id, { status: 'ready' });
  }

  async function start({ workflowId, exampleId, criterionId, by = null }) {
    const ex = store.readExample(workflowId, exampleId);
    const criterion = ex && ex.criteria.find((c) => c.id === criterionId);
    if (!criterion) throw store.testError(`no criterion ${criterionId}`, 'NOT_FOUND');
    if (!ex.judge) throw store.testError('pick the AI model that checks your criteria first', 'BAD_REQUEST');
    const key = `${ex.id}|${criterion.id}`;
    if (making.has(key)) throw store.testError('Worca is already checking this criterion.', 'BUSY');
    const good = await goodResultOf(ex, d);
    if (!good) throw store.testError(triedOnce(ex) ? NO_PASSED_TRY_TEXT : NO_SOURCE_TEXT, 'NOT_READY');
    if (!(d.mock() || good.mock === true)) {
      // User decision 2026-11-22 (review I4): a written text over the planting limit is refused before a round: no failed round in the
      // history, no call, $0; a mock round plants for free and still runs. Then the total spending limit, refused up front.
      if (splitChanges(good.text).text.length > PLANT_RESULT_MAX) throw store.testError(TOO_LONG_TEXT, 'NOT_READY');
      const b = d.budgetStatus();
      if (b && b.blocked) throw store.testError(LIMIT_TEXT, 'NOT_READY');
    }
    if (making.has(key)) throw store.testError('Worca is already checking this criterion.', 'BUSY');   // goodResultOf awaited
    // Fix round 2 (N2): a delete during that await found no 'making' row: no round, no call, no row for a gone example. Synchronous
    // from here to createRound, so a later delete sees the round and is refused (store.deleteExample).
    if (!store.readExample(workflowId, ex.id)) throw store.testError(`no example ${exampleId}`, 'NOT_FOUND');
    making.add(key);
    let round;
    try {
      round = cs.createRound({ workflowId, exampleId: ex.id, criterionId: criterion.id, fp: cs.criterionFp(criterion.text), model: ex.judge.model,
        source: { criterionText: criterion.text, kind: good.kind, tryId: good.tryId ?? null, pipelineId: good.pipelineId ?? null, label: good.label, mock: !!good.mock }, by });
    } catch (e) { making.delete(key); throw e; }
    const job = make(round, ex, criterion, good)
      .catch((e) => {   // the error is logged, never shown: the page says board 58's sentence
        console.warn(`[workflow-tests] check-the-checker round ${round.id} failed: ${firstLine(e)}`);
        try { cs.updateRound(round.id, { status: 'failed', detail: ROUND_NOT_FINISHED_TEXT }); } catch { /* the round stays making until the next boot */ }
      })
      .finally(() => {
        making.delete(key);
        try { if (d.changed) d.changed(round); } catch { /* a frame only */ }   // final review M5: the round ended (ready or failed)
      });
    if (d.inline) await job;
    return cs.readRound(round.id);
  }

  /** Board 11, P4-M3: the good result's version (the Tests pages' label) and date, from the try or the run it came from. */
  function sourceOf(round, ex) {
    const s = round.source || {};
    let use = null;
    let at = null;
    if (s.kind === 'try' && s.tryId != null) {
      const t = store.readTry(s.tryId);
      if (t) { use = t.use; at = t.finishedAt || t.startedAt || null; }
    } else if (s.kind === 'run' && s.pipelineId) {
      use = ex && ex.from && ex.from.pipelineId === s.pipelineId ? ex.from.use : null;
      const row = findPipelineRowById(s.pipelineId);
      at = row && row.started_at ? row.started_at : null;
    }
    if (use == null && !at) return s;
    const latest = latestVersion(round.workflowId);
    const ctx = { liveVersionNo: liveVersionNo(round.workflowId), latestVersionNo: latest ? latest.versionNo : null };
    return { ...s, ...(use != null ? { useLabel: useLabel(use, ctx) } : {}), ...(at ? { at } : {}) };
  }

  /** `by`: the viewer's own answers (Check the checker). `anyone`: anyone's newest answer per card (the trust report, I9). */
  function view(round, { by = null, anyone = false } = {}) {
    const js = cs.roundJudgements(round.id);
    const main = js.filter((j) => j.purpose === 'real' || j.purpose === 'planted');
    const cards = main.map((j) => ({ judgementId: j.id, card: j.card, planted: j.variant && j.variant.how ? j.variant.how : null,
      excerpt: j.variant ? j.variant.excerpt : null, ...(j.variant && j.variant.blind ? { blind: true } : {}), met: j.met, reason: j.reason, answer: anyone ? cs.latestAnswerOf(j.id) : cs.answerOf(j.id, by) }));
    // An errored repeat or filler check (no verdict) is left out of the totals.
    const reps = main.map((m) => ({ m, r: js.filter((j) => j.purpose === 'again' && j.card === m.card && j.met !== null) })).filter((x) => x.r.length > 0);
    const same = reps.filter((x) => x.r.every((j) => j.met === x.m.met)).length;
    const pads = main.map((m) => ({ m, p: js.find((j) => j.purpose === 'padded' && j.card === m.card && j.met !== null) })).filter((x) => x.p);
    const pad = pads.filter((x) => x.p.met === x.m.met).length;
    const left = cards.filter((c) => c.answer === null).length;
    const ex = store.readExample(round.workflowId, round.exampleId);
    const criterion = ex ? ex.criteria.find((c) => c.id === round.criterionId) : null;
    const ranOn = typeof round.source.criterionText === 'string' ? round.source.criterionText : (criterion ? criterion.text : null);
    const changed = !!criterion && cs.criterionFp(criterion.text) !== round.fp;
    return { round, exampleName: ex ? ex.name : null, criterion: ranOn, ...(changed ? { textChanged: true } : {}), source: sourceOf(round, ex), cards, left,
      auto: { same: { n: same, of: reps.length }, padding: { n: pad, of: pads.length }, proof: { n: main.filter((j) => j.proofFound).length, of: main.length } },
      costUsd: cs.roundSpentUsd(round.id), againUsd: cs.roundSpentUsd(round.id, { purpose: 'checker' }), costUnknown: cs.roundCostUnknown(round.id), canUse: round.status === 'done' };   // P4-Q17
  }

  /** D96, D97: Right (true) or Wrong (false) on one card; the round is done when all four are answered. */
  async function answer(round, judgementId, right, { by = null } = {}) {
    const j = cs.readJudgement(judgementId);
    if (round.status === 'failed') throw store.testError(ROUND_NOT_FINISHED_TEXT, 'BUSY');
    if (round.status === 'making') throw store.testError('Worca is not done with this round', 'BUSY');
    if (!j || j.roundId !== round.id || (j.purpose !== 'real' && j.purpose !== 'planted')) throw store.testError(`no card ${judgementId} in this round`, 'NOT_FOUND');
    if (j.met === null) throw store.testError('Worca has no verdict on this card to answer', 'BAD_REQUEST');
    cs.setAnswer(j.id, { agree: !!right, by });
    const v = view(round, { by });
    if (v.left === 0 && round.status !== 'done') cs.updateRound(round.id, { status: 'done' });
    return view(cs.readRound(round.id), { by });
  }
  /** D104, P4-M3: clearer words from the cards the person marked Wrong (not saved: the editor shows them). Nothing marked Wrong: nothing is sent. */
  async function reword(round, { by = null } = {}) {
    const v = view(round, { by });
    const wrong = v.cards.filter((c) => c.answer === false).map((c) => ({ excerpt: c.excerpt, met: c.met }));
    const criterion = v.criterion || '';
    const mock = d.mock() || !!(round.source && round.source.mock);   // I14
    if (!wrong.length) return { text: criterion, costUsd: 0 };
    if (!mock) {
      const b = d.budgetStatus();
      if (b && b.blocked) throw store.testError(LIMIT_TEXT, 'NOT_READY');
    }
    const book = (usd, costKind) => d.book({ workflowId: round.workflowId, exampleId: round.exampleId, roundId: round.id, purpose: 'reword', model: round.model, amountUsd: usd, costKind });
    return rewordCriterion({ criterion, wrong, model: round.model, mock, book }, { modelCall: d.modelCall, mock: d.mock, budget: d.budgetStatus });
  }
  return { start, view, answer, reword, making: () => [...making] };
}
