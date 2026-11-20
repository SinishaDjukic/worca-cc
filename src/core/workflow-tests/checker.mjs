// src/core/workflow-tests/checker.mjs — Check the checker (plans/workflow-tests-part4-plan.md D97, board 11). A round takes a good result,
// plants three mistakes, has the example's model check the four results (each asked twice more, and once with filler), and waits for the
// person's Right / Wrong on the four. Rounds run in the background; the page polls GET …/checker/:round.
import { mockEnabled } from '../claude-runner.mjs';
import { recordTestJudgeCost, budgetStatus as realBudgetStatus } from '../cost-budget.mjs';
import { judgeCriterion as realJudge, modelCall as realModelCall, firstLine } from './judge.mjs';
import { subjectOfTry } from './criteria-runner.mjs';
import { mainResult } from './result.mjs';
import { exampleSourcesText } from './sources-text.mjs';
import { padded, deterministicPlants, plantSystemPrompt, plantPrompt, parsePlantReply, applyPlants } from './planted.mjs';
import { SUBJECT_MAX, clipText, fenceTag } from './judge-prompt.mjs';
import * as store from './store.mjs';
import * as cs from './criteria-store.mjs';
import { NOT_CHECKED } from '../../shared/workflow-tests/criteria-text.mjs';

/** P4-M3's empty state, and the refusal. */
export const NO_SOURCE_TEXT = 'Try this example once first, so Worca has a good result to break.';
/** The words of Task 11's check route when the total spending limit is already reached. */
export const LIMIT_TEXT = 'Total cost limit reached — nothing was sent to the model. Raise the limit in worca Settings.';
const EXCERPT_MAX = 400;
const clip = (s) => { const t = String(s ?? '').trim(); return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX - 1)}…` : t; };

/** D97: the result you liked, else the newest passed try of the example (a real one before a mock one), else the run it came from when
 *  the person called it good. `mock`: the text came from a mock try (I14: the round then runs on the mock, never paid). */
export async function goodResultOf(example, { subjectOf = (t) => subjectOfTry(t), readMain = mainResult } = {}) {
  const liked = cs.readLiked(example.id);
  if (liked && liked.text.trim()) {
    return { kind: 'liked', text: liked.text, label: 'From the result you liked', mock: !!liked.fromPipeline && store.mockPipeline(liked.fromPipeline) };
  }
  const passed = store.triesForExample(example.id).filter((t) => t.status === 'passed' && t.pipelineId);
  const best = passed.find((t) => !t.mock) || passed[0];
  if (best) { const text = await subjectOf(best); if (text.trim()) return { kind: 'try', tryId: best.id, text, label: 'From a real result', mock: !!best.mock }; }
  if (example.from && example.from.verdict === 'good') {
    const m = await readMain(example.from.pipelineId);
    if (m.text && m.text.trim()) return { kind: 'run', pipelineId: example.from.pipelineId, text: m.text, label: 'From a real result', mock: store.mockPipeline(example.from.pipelineId) };
  }
  return null;
}

export function createChecker(deps = {}) {
  const d = { judgeCriterion: realJudge, modelCall: realModelCall, mock: () => mockEnabled({}), book: recordTestJudgeCost, budgetStatus: realBudgetStatus,
    subjectOf: (t) => subjectOfTry(t), contextOf: (ex) => exampleSourcesText(ex), inline: false, ...deps };
  const making = new Set();   // `${exampleId}|${criterionId}` of the rounds being made now

  async function make(round, ex, criterion, good) {
    // Every paid call of the round books through this one function, with purpose 'checker': the planting call and each check.
    const book = (usd, costKind) => d.book({ workflowId: round.workflowId, exampleId: ex.id, roundId: round.id, purpose: 'checker', model: round.model, amountUsd: usd, costKind });
    const mock = d.mock() || good.mock === true;   // D91, I14: a mock try's text is only ever checked by the mock
    let plants = null;
    if (!mock) {
      try {
        const tag = fenceTag();
        const r = await d.modelCall({ model: round.model, system: plantSystemPrompt(tag),
          prompt: plantPrompt({ criterion: criterion.text, result: clipText(good.text, SUBJECT_MAX).text, tag }) });
        if (r.costUsd > 0 || r.costKind === 'unknown') book(r.costUsd, r.costKind);   // P4-Q17: an unknown cost books a $0 row
        plants = applyPlants(good.text, parsePlantReply(r.text));
      } catch (e) { if (Number(e && e.costUsd) > 0 || (e && e.costKind === 'unknown')) book(Number(e.costUsd) || 0, e.costKind || 'billed'); }
    }
    plants = (plants || deterministicPlants(good.text)).slice(0, 3);
    const real = { how: null, excerpt: clip(good.text.split(/\n{2,}/).find((p) => p.trim() && !/^#/.test(p.trim())) || good.text), text: good.text };
    const cards = [real, ...plants];
    const context = d.contextOf(ex);
    const ask = async (subject, purpose, card, variant) => {
      const j = await d.judgeCriterion({ criterion: criterion.text, subject, context, model: round.model, mock, book });
      return cs.insertJudgement({ workflowId: round.workflowId, exampleId: ex.id, criterionId: criterion.id, fp: round.fp, model: round.model, purpose,
        roundId: round.id, card, variant, subject: purpose === 'real' || purpose === 'planted' ? subject.slice(0, SUBJECT_MAX) : null, j });
    };
    const mainJs = [];
    for (const [i, c] of cards.entries()) mainJs.push(await ask(c.text, i === 0 ? 'real' : 'planted', i, { how: c.how, excerpt: clip(c.excerpt) }));
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
    if (!good) throw store.testError(NO_SOURCE_TEXT, 'NOT_READY');
    // The total spending limit, refused up front (a mock round pays nothing, so it is never refused).
    if (!(d.mock() || good.mock === true)) {
      const b = d.budgetStatus();
      if (b && b.blocked) throw store.testError(LIMIT_TEXT, 'NOT_READY');
    }
    if (making.has(key)) throw store.testError('Worca is already checking this criterion.', 'BUSY');   // goodResultOf awaited
    making.add(key);
    let round;
    try {
      round = cs.createRound({ workflowId, exampleId: ex.id, criterionId: criterion.id, fp: cs.criterionFp(criterion.text), model: ex.judge.model,
        source: { criterionText: criterion.text, kind: good.kind, tryId: good.tryId ?? null, pipelineId: good.pipelineId ?? null, label: good.label, mock: !!good.mock }, by });
    } catch (e) { making.delete(key); throw e; }
    const job = make(round, ex, criterion, good)
      .catch((e) => { try { cs.updateRound(round.id, { status: 'failed', detail: firstLine(e) }); } catch { /* the round stays making until the next boot */ } })
      .finally(() => making.delete(key));
    if (d.inline) await job;
    return cs.readRound(round.id);
  }

  /** `by`: the viewer's own answers (Check the checker). `anyone`: anyone's newest answer per card (the trust report, I9). */
  function view(round, { by = null, anyone = false } = {}) {
    const js = cs.roundJudgements(round.id);
    const main = js.filter((j) => j.purpose === 'real' || j.purpose === 'planted');
    const cards = main.map((j) => ({ judgementId: j.id, card: j.card, planted: j.variant && j.variant.how ? j.variant.how : null,
      excerpt: j.variant ? j.variant.excerpt : null, met: j.met, reason: j.reason, answer: anyone ? cs.latestAnswerOf(j.id) : cs.answerOf(j.id, by) }));
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
    return { round, exampleName: ex ? ex.name : null, criterion: ranOn, ...(changed ? { textChanged: true } : {}), source: round.source, cards, left,
      auto: { same: { n: same, of: reps.length }, padding: { n: pad, of: pads.length }, proof: { n: main.filter((j) => j.proofFound).length, of: main.length } },
      costUsd: cs.roundSpentUsd(round.id), canUse: round.status === 'done' };
  }

  /** D96, D97: Right (true) or Wrong (false) on one card; the round is done when all four are answered. */
  async function answer(round, judgementId, right, { by = null } = {}) {
    const j = cs.readJudgement(judgementId);
    if (round.status === 'failed') throw store.testError('This round did not finish. Start a new round.', 'BUSY');
    if (round.status === 'making') throw store.testError('Worca is not done with this round', 'BUSY');
    if (!j || j.roundId !== round.id || (j.purpose !== 'real' && j.purpose !== 'planted')) throw store.testError(`no card ${judgementId} in this round`, 'NOT_FOUND');
    if (j.met === null) throw store.testError('Worca has no verdict on this card to answer', 'BAD_REQUEST');
    cs.setAnswer(j.id, { agree: !!right, by });
    const v = view(round, { by });
    if (v.left === 0 && round.status !== 'done') cs.updateRound(round.id, { status: 'done' });
    return view(cs.readRound(round.id), { by });
  }
  return { start, view, answer, making: () => [...making] };
}
