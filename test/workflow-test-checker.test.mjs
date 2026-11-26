// test/workflow-test-checker.test.mjs — D97: a good result, three planted ones, four verdicts the person answers, and Worca's own
// three tests (asked again, filler, proof). Free: the model calls are fakes, or the mock. User decision 2026-11-21: the planted ones
// are whole broken copies the checking model writes, one call each; Worca's own plants are for mock rounds only.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { padded, deterministicPlants, FILLER, PLANT_RESULT_MAX, COPY_TIMEOUT_MS } from '../src/core/workflow-tests/planted.mjs';
import { judgeCriterion as realJudge } from '../src/core/workflow-tests/judge.mjs';
import { createChecker, NO_SOURCE_TEXT, TOO_LONG_TEXT } from '../src/core/workflow-tests/checker.mjs';
import { ROUND_NOT_FINISHED_TEXT, NOT_CHECKED } from '../src/shared/workflow-tests/criteria-text.mjs';
import { trustReportModel } from '../src/shared/workflow-tests/criteria-report.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftcheck-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

const GOOD = '## Success metric\n\nCut export tickets by 60% within one quarter, counted by the Export tag.\n\n## Risks\n\nLarge accounts.';

test('planted.mjs: filler adds about half again; the mock round plants change the text', () => {
  const p = padded(GOOD);
  assert.ok(p.length >= GOOD.length * 1.4 && p.includes(FILLER) && p.endsWith('Large accounts.'));
  const d = deterministicPlants(GOOD);
  assert.deepEqual(d.map((x) => x.how), ['numbers removed', 'a made-up quote added', 'a part removed']);
  assert.ok(d.every((x) => x.text !== GOOD));
  assert.ok(!/60/.test(d[0].text));
});

/** A copy reply in this call's own tags, read from its system prompt as the model would. */
const tagOf = (system) => /<copy-([0-9a-f]+)>/.exec(system)[1];
const copyReply = (system, how, text) => { const t = tagOf(system); return `<how-${t}>${how}</how-${t}>\n<copy-${t}>\n${text}\n</copy-${t}>`; };
/** GOOD broken three ways, each everywhere it states its metric. */
const COPIES = [['number removed', GOOD.replace('by 60% ', '')], ['metric made vague', GOOD.replace('by 60% within one quarter', 'a lot over time')],
  ['measure removed', GOOD.replace('by 60% within one quarter, counted by the Export tag', 'soon')]];

/** An example with a passed try whose result is GOOD (or `text`), and a checker whose calls are fakes. `copies`: the copy calls' replies,
 *  as [how, text] pairs or as a function (system, i) → reply text. */
function setup({ judgeMet = (subject) => /60%/.test(subject), copies = COPIES, text = GOOD, extra = {}, use = 'draft', finishedAt = null,
  proofOf = (subject) => subject.split('\n').find((l) => /60%|500/.test(l)) || subject.split('\n').find((l) => l.length > 8) } = {}) {
  const ex = store.createExample('wf', { name: 'Bulk export', request: 'Write the brief.', criteria: [{ text: 'Names a success metric with a number' }],
    judge: { model: 'claude-haiku-4-5' } });
  const run = store.createTestRun({ workflowId: 'wf', kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: 'wf', exampleId: ex.id, use, fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000001', verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] }, ...(finishedAt ? { finishedAt } : {}) });
  let calls = 0;
  const plants = [];   // each copy call: { system, prompt, opts }
  const checker = createChecker({
    subjectOf: async () => text,
    modelCall: async (args, opts) => {
      calls += 1;
      const i = plants.length;
      plants.push({ ...args, opts });
      const r = typeof copies === 'function' ? copies(args.system, i) : copies[i] ? copyReply(args.system, ...copies[i]) : '';
      return { text: r, costUsd: 0.01, costKind: 'billed' };
    },
    judgeCriterion: async ({ subject, book }) => { calls += 1; book(0.01, 'billed'); const met = judgeMet(subject);
      return { met, reason: met ? 'Has a number.' : 'No number.', proof: proofOf(subject), proofFound: true, error: null, costUsd: 0.01, ms: 1 }; },
    mock: () => false, inline: true, budgetStatus: () => ({ blocked: false }), ...extra,
  });
  return { ex: store.readExample('wf', ex.id), checker, calls: () => calls, plants };
}
const startOf = (s) => s.checker.start({ workflowId: 'wf', exampleId: s.ex.id, criterionId: s.ex.criteria[0].id });
const ledger = (roundId) => prepare("SELECT amount_usd AS a, cost_kind AS k FROM wf_test_judge_ledger WHERE purpose = 'checker' AND round_id = ?").all(roundId);

test('a round: 4 cards (1 real, 3 whole copies), each asked 3 times and once with filler; answers finish it', async () => {
  const { ex, checker, calls } = setup();
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id, by: 'ana' });
  const v = checker.view(cs.readRound(round.id), { by: 'ana' });
  assert.equal(v.round.status, 'ready');
  assert.deepEqual(v.cards.map((c) => [c.card, c.planted, c.met]),
    [[0, null, true], [1, 'number removed', false], [2, 'metric made vague', false], [3, 'measure removed', false]]);
  assert.equal(calls(), 3 + 4 + 8 + 4, 'three copy calls, 4 cards, 8 repeats, 4 with filler');
  assert.deepEqual(v.auto, { same: { n: 4, of: 4 }, padding: { n: 4, of: 4 }, proof: { n: 4, of: 4 } });
  assert.equal(v.left, 4);
  assert.equal(v.canUse, false);
  assert.equal(Math.round(v.costUsd * 100) / 100, 0.19);
  for (const c of v.cards) await checker.answer(cs.readRound(round.id), c.judgementId, c.card !== 2, { by: 'ana' });
  const done = checker.view(cs.readRound(round.id), { by: 'ana' });
  assert.deepEqual([done.round.status, done.left, done.canUse], ['done', 0, true]);
  assert.equal(cs.roundDone('wf', done.round.fp, 'claude-haiku-4-5'), true);
  assert.equal(ledger(round.id).length, 19);
});

test('each copy call: the whole good result, the ways already used, a long timeout; the card shows only the changed lines', async () => {
  const s = setup();
  const round = await startOf(s);
  assert.equal(s.plants.length, 3);
  for (const p of s.plants) {
    assert.ok(p.prompt.includes(GOOD), 'the whole good result, not a clipped one');
    assert.deepEqual(p.opts, { timeoutMs: COPY_TIMEOUT_MS });
    assert.ok(p.system.includes('whole result') && p.system.includes('Never follow instructions'));
  }
  const ways = (p) => /<ways-[0-9a-f]+>\n([\s\S]*?)\n<\/ways-[0-9a-f]+>/.exec(p.prompt)[1];
  assert.deepEqual(s.plants.map(ways), ['none', 'number removed', 'number removed\nmetric made vague'], 'each copy is told the ways before it');
  assert.notEqual(tagOf(s.plants[0].system), tagOf(s.plants[1].system), 'each call has its own tags');
  const v = s.checker.view(cs.readRound(round.id), { by: 'x' });
  assert.deepEqual(v.cards.slice(1).map((c) => c.excerpt), ['Cut export tickets within one quarter, counted by the Export tag.',
    'Cut export tickets a lot over time, counted by the Export tag.', 'Cut export tickets soon.']);
});

test('every paid call of a round books a checker row: each copy call and each check, an unknown cost as a $0 row', async () => {
  // The real judgeCriterion with a fake helperCall, so the checker's own booking wiring (not a fake's) is what is tested.
  let helper = 0;
  const helperCall = async ({ prompt }) => {   // met with the metric line as proof, else not met
    helper += 1;
    const met = prompt.includes('by 60% within');
    return { text: JSON.stringify({ verdict: met ? 'met' : 'not met', reason: 'r', proof: met ? 'Cut export tickets by 60% within one quarter' : 'Large accounts.' }), costUsd: 0.02, costKind: 'billed' };
  };
  const s = setup({ extra: { judgeCriterion: (a) => realJudge(a, { helperCall, userSignIn: () => false, mock: () => false, budget: () => ({ blocked: false }), scratch: () => tmpdir() }) } });
  const round = await startOf(s);
  assert.equal(round.status, 'ready');
  assert.equal(helper, 16);
  assert.equal(ledger(round.id).length, 3 + 16, 'the three copy calls and the 16 checks');
  assert.equal(prepare("SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE round_id = ? AND purpose <> 'checker'").get(round.id).n, 0);
  let k = 0;
  const u = setup({ extra: { modelCall: async ({ system }) => ({ text: copyReply(system, ...COPIES[k++]), costUsd: 0, costKind: 'unknown' }) } });
  const r2 = await startOf(u);
  assert.equal(ledger(r2.id).filter((x) => x.k === 'unknown').length, 3, 'each copy call with an unknown cost books a $0 row');
  // Final review M1: a booking of a copy call that fails surfaces: the round fails and asks nothing more (as every other call site).
  let booked = 0;
  const lost = setup({ extra: { book: () => { booked += 1; if (booked === 1) throw new Error('ledger down'); } } });
  const warn = console.warn; console.warn = () => {};
  try {
    const r3 = await startOf(lost);
    assert.deepEqual([cs.readRound(r3.id).status, lost.calls(), booked], ['failed', 1, 1], 'no call was made after the lost booking');
  } finally { console.warn = warn; }
});

test('a copy that fails a check is not used: the round ends in the failed state, and the calls made stay booked', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const bad = {
      'identical to the good result': (system) => copyReply(system, 'nothing changed', GOOD),
      'the same, loosely': (system) => copyReply(system, 'case only', GOOD.toUpperCase()),
      'too short': (system) => copyReply(system, 'a summary', 'Cut tickets.'),
      'too long': (system) => copyReply(system, 'padded', `${GOOD}\n\n${GOOD}`),
      'cut off': (system) => copyReply(system, 'number removed', COPIES[0][1]).replace(/<\/copy-[0-9a-f]+>$/, ''),
      'not in its tags': () => JSON.stringify({ how: 'number removed', copy: COPIES[0][1] }),
      'no way named': (system) => copyReply(system, '', COPIES[0][1]),
    };
    for (const [why, first] of Object.entries(bad)) {
      const s = setup({ copies: (system, i) => (i === 0 ? first(system) : copyReply(system, ...COPIES[i])) });
      const round = await startOf(s);
      const r = cs.readRound(round.id);
      assert.deepEqual([r.status, r.detail], ['failed', ROUND_NOT_FINISHED_TEXT], why);
      assert.equal(s.calls(), 2, `${why}: the real card's check, then no further copy call and no check`);
      assert.equal(ledger(round.id).length, 2, `${why}: the calls made are booked`);
      assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judgements WHERE round_id = ?').get(round.id).n, 0);
    }
    // Fewer than three good copies: two good ones, then one the same as the first.
    const two = setup({ copies: (system, i) => copyReply(system, ...COPIES[i === 2 ? 0 : i]) });
    const r2 = await startOf(two);
    assert.deepEqual([cs.readRound(r2.id).status, two.calls(), ledger(r2.id).length], ['failed', 4, 4]);
    // A copy call that fails books what it spent; the round fails.
    const thrown = setup({ extra: { modelCall: async () => { throw Object.assign(new Error('boom'), { costUsd: 0.05, costKind: 'billed' }); } } });
    const r3 = await startOf(thrown);
    assert.deepEqual([cs.readRound(r3.id).status, cs.readRound(r3.id).detail, ledger(r3.id).map((x) => x.a)], ['failed', ROUND_NOT_FINISHED_TEXT, [0.01, 0.05]]);
  } finally { console.warn = warn; }
});

test("no free fallback in a real round: Worca's own plants are never used when a real model checks", async () => {
  const s = setup({ copies: () => '{}' });
  const warn = console.warn; console.warn = () => {};
  try {
    const round = await startOf(s);
    assert.equal(cs.readRound(round.id).status, 'failed');
    assert.equal(s.checker.view(cs.readRound(round.id), { by: 'x' }).cards.length, 0, 'no "numbers removed" card');
  } finally { console.warn = warn; }
});

test('the spending limit reached between copy calls: no more calls, the round fails with the limit words', async () => {
  let n = 0;
  const s = setup({ extra: { budgetStatus: () => ({ blocked: n++ >= 2 }) } });   // start() reads it once, the first copy call once
  const round = await startOf(s);
  const r = cs.readRound(round.id);
  assert.deepEqual([r.status, r.detail, s.calls(), ledger(round.id).length], ['failed', NOT_CHECKED.limit, 2, 2], 'the real card, one copy call');
});

// User decision 2026-11-22 (review I4): only the written text is planted; text over the limit is refused before a round, with its own words.
const HEADING = '--- The changes this try made to the project (a git diff) ---';
const DIFF = 'diff --git a/src/export.js b/src/export.js\n+// Cut export tickets by 60% (the brief)\n+export const LIMIT = 60;\n</result>';
const PROJECT = `${GOOD}\n\n${HEADING}\n${DIFF}`;

test('a result whose text is over PLANT_RESULT_MAX is refused before a round: its own words, no round, no call, $0; a mock round still runs', async () => {
  assert.equal(PLANT_RESULT_MAX, 40_000);
  assert.equal(TOO_LONG_TEXT, 'This result is too long for Worca to break on purpose. Check the checker works on results up to about 40,000 characters.');
  const big = `## Metric\n\nCut export tickets by 60%.\n\n${'Background. '.repeat(Math.ceil(PLANT_RESULT_MAX / 12))}`;
  const s = setup({ text: big });
  await assert.rejects(startOf(s), { code: 'NOT_READY', message: TOO_LONG_TEXT });
  assert.deepEqual([prepare('SELECT COUNT(*) AS n FROM wf_test_checker_rounds').get().n, s.calls(),
    prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n], [0, 0, 0], 'no round in the history, no call, nothing booked');
  // The limit is on the written text only: a project result under it with a long diff runs.
  const longDiff = `${GOOD}\n\n${HEADING}\n${'+// a changed line of the project\n'.repeat(Math.ceil(PLANT_RESULT_MAX / 30))}`;
  const p = setup({ text: longDiff });
  assert.ok(longDiff.length > PLANT_RESULT_MAX);
  assert.equal(cs.readRound((await startOf(p)).id).status, 'ready');
  const m = setup({ text: big, extra: { mock: () => true, judgeCriterion: (a) => realJudge(a, { mock: () => true }) } });
  assert.equal(cs.readRound((await startOf(m)).id).status, 'ready');
});

test('a project result: the copy calls get only its written text; each copy is the broken text plus the unchanged diff, judged whole', async () => {
  const subjects = [];
  const s = setup({ text: PROJECT, judgeMet: (subject) => /Cut export tickets by 60%/.test(subject.split(HEADING)[0]),
    extra: { judgeCriterion: async ({ subject, book }) => { subjects.push(subject); book(0.01, 'billed'); const met = /Cut export tickets by 60%/.test(subject.split(HEADING)[0]);
      return { met, reason: 'r', proof: met ? 'Cut export tickets by 60% within one quarter' : 'Large accounts.', proofFound: true, error: null, costUsd: 0.01, ms: 1 }; } } });
  const round = await startOf(s);
  assert.equal(cs.readRound(round.id).status, 'ready');
  for (const p of s.plants) {
    assert.ok(p.prompt.includes(GOOD), 'the written text, whole');
    assert.ok(!p.prompt.includes(HEADING) && !p.prompt.includes('diff --git'), 'never the diff');
  }
  const v = s.checker.view(cs.readRound(round.id), { by: 'x' });
  assert.deepEqual(v.cards.map((c) => c.met), [true, false, false, false]);
  const planted = prepare("SELECT subject FROM wf_test_judgements WHERE round_id = ? AND purpose = 'planted' ORDER BY card").all(round.id).map((r) => r.subject);
  assert.deepEqual(planted, COPIES.map(([, text]) => `${text}\n\n${HEADING}\n${DIFF}`), 'the broken text and the diff as it was');
  assert.ok(v.cards.slice(1).every((c) => !c.excerpt.includes('diff') && !c.excerpt.includes('LIMIT')), 'the card shows only the broken text');
  assert.equal(subjects.filter((x) => x.endsWith(DIFF)).length, 16, 'every check reads the whole result, its diff included');
});

test('a liked "changes" result: its written text is planted, its diff (with a closing tag inside) is never sent to a copy call', async () => {
  const { ex } = setup();
  cs.putLiked(ex.id, { kind: 'changes', name: 'c', data: Buffer.from(PROJECT) });
  let seen = '';
  const checker = createChecker({ mock: () => false, inline: true, budgetStatus: () => ({ blocked: false }),
    modelCall: async ({ prompt }) => { seen = prompt; return { text: '{}', costUsd: 0 }; },
    judgeCriterion: async () => ({ met: true, reason: 'r', proof: 'p', proofFound: true, error: null, costUsd: 0, ms: 1 }) });
  const warn = console.warn; console.warn = () => {};
  try { await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id }); } finally { console.warn = warn; }
  assert.ok(seen.includes(GOOD) && !seen.includes(HEADING) && !seen.includes('diff --git'));
  assert.equal(seen.match(/<\/result-[0-9a-f]{8}>/g).length, 1, 'only the call own closing tag closes the fence');
});

// User decision 2026-11-22: a copy that still holds the passage proving the criterion is weak: that copy's call is made once more.
const WEAK = GOOD.replace('## Risks', '## Dangers');   // the metric line kept: still met
const ways = (p) => /<ways-[0-9a-f]+>\n([\s\S]*?)\n<\/ways-[0-9a-f]+>/.exec(p.prompt)[1];

test('a weak copy, then a good one: the call is made once more, both are booked, and the round is ready', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const s = setup({ copies: (system, i) => (i === 0 ? copyReply(system, 'heading renamed', WEAK) : copyReply(system, ...COPIES[i - 1])) });
    const round = await startOf(s);
    assert.equal(cs.readRound(round.id).status, 'ready');
    assert.equal(s.plants.length, 4, 'three copies and one asked again');
    assert.deepEqual(s.plants.map(ways), ['none', 'none', 'number removed', 'number removed\nmetric made vague'], 'the call asked again has the same ways');
    // Fix round 7 (review I3): the call asked again carries the passage that still made the weak copy meet the criterion, and names it.
    const stillOf = (p) => { const m = /<still-([0-9a-f]+)>\n([\s\S]*?)\n<\/still-\1>/.exec(p.prompt); return m ? m[2] : null; };
    assert.deepEqual(s.plants.map(stillOf), [null, 'Cut export tickets by 60% within one quarter, counted by the Export tag.', null, null]);
    assert.ok(s.plants[1].system.includes(`<still-${tagOf(s.plants[1].system)}>`) && !s.plants[0].system.includes('<still-'));
    const v = s.checker.view(cs.readRound(round.id), { by: 'x' });
    assert.deepEqual(v.cards.map((c) => c.planted), [null, 'number removed', 'metric made vague', 'measure removed']);
    assert.equal(ledger(round.id).length, 4 + 16);
    assert.equal(Math.round(v.againUsd * 100) / 100, 0.2, 'checking again counts the call asked again too');
  } finally { console.warn = warn; }
});

test('weak twice: the round ends in the failed state, every call stays booked, no card is written', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const s = setup({ copies: (system, i) => (i < 2 ? copyReply(system, `heading renamed ${i}`, i ? GOOD.replace('## Risks', '## Perils') : WEAK) : copyReply(system, ...COPIES[i - 2])) });
    const round = await startOf(s);
    const r = cs.readRound(round.id);
    assert.deepEqual([r.status, r.detail], ['failed', ROUND_NOT_FINISHED_TEXT]);
    assert.deepEqual([s.calls(), s.plants.length, ledger(round.id).length], [3, 2, 3], 'the real card, the copy and the copy asked again');
    assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judgements WHERE round_id = ?').get(round.id).n, 0);
  } finally { console.warn = warn; }
});

test('no proof to check against (the good result not met, or a proof under 12 characters): a copy is not checked for it', async () => {
  const copies = (system, i) => (i === 0 ? copyReply(system, 'heading renamed', WEAK) : copyReply(system, ...COPIES[i]));
  const notMet = setup({ copies, judgeMet: () => false });
  assert.equal(cs.readRound((await startOf(notMet)).id).status, 'ready');
  assert.equal(notMet.plants.length, 3, 'no call asked again');
  const short = setup({ copies, proofOf: () => 'by 60%' });
  assert.equal(cs.readRound((await startOf(short)).id).status, 'ready');
  assert.equal(short.plants.length, 3);
  // Fix round 7 (review I3): a heading every correct copy keeps is no proof to check against.
  const heading = setup({ proofOf: () => '## Success metric' });
  assert.equal(cs.readRound((await startOf(heading)).id).status, 'ready');
  assert.equal(heading.plants.length, 3, 'no call asked again');
});

test("the good result's own earlier verdict gives the proof when it has one; else the real card's", async () => {
  // The real card quotes a line every copy keeps ("Large accounts."); the try's own earlier verdict quotes the metric line.
  const s = setup({ proofOf: () => 'Large accounts.' });
  const t = store.triesForExample(s.ex.id)[0];
  cs.insertJudgement({ workflowId: 'wf', exampleId: s.ex.id, criterionId: s.ex.criteria[0].id, fp: cs.criterionFp(s.ex.criteria[0].text), model: 'claude-haiku-4-5',
    purpose: 'try', tryId: t.id, j: { met: true, reason: 'r', proof: 'Cut export tickets by 60% within one quarter', proofFound: true } });
  assert.equal(cs.readRound((await startOf(s)).id).status, 'ready');
  assert.equal(s.plants.length, 3, 'the earlier proof is not in any copy');
  const warn = console.warn; console.warn = () => {};
  try {
    const r = setup({ proofOf: () => 'Large accounts.' });   // no earlier verdict: the real card's proof, which every copy holds
    const round = await startOf(r);
    assert.deepEqual([cs.readRound(round.id).status, r.plants.length], ['failed', 2]);
  } finally { console.warn = warn; }
});

test('the spending limit already reached: a paid round is refused up front and nothing is sent; a mock round is not', async () => {
  let sent = 0;
  const blocked = setup({ extra: { budgetStatus: () => ({ blocked: true }), modelCall: async () => { sent += 1; return { text: '{}', costUsd: 0 }; } } });
  await assert.rejects(blocked.checker.start({ workflowId: 'wf', exampleId: blocked.ex.id, criterionId: blocked.ex.criteria[0].id }), { code: 'NOT_READY', message: /Total cost limit reached/ });
  assert.equal(sent, 0);
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_checker_rounds').get().n, 0, 'no round row for a refused start');
  const free = setup({ extra: { mock: () => true, budgetStatus: () => ({ blocked: true }) } });
  const r = await free.checker.start({ workflowId: 'wf', exampleId: free.ex.id, criterionId: free.ex.criteria[0].id });
  assert.equal(r.status, 'ready');
});

test('I14: a good result from a mock try is checked by the mock, never paid, also outside WORCA_MOCK=1', async () => {
  const ex = store.createExample('wf', { name: 'Mock only', request: 'R', criteria: [{ text: 'Names a success metric with a number' }], judge: { model: 'claude-haiku-4-5' } });
  const run = store.createTestRun({ workflowId: 'wf', kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: 'wf', exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1, mock: true });
  store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000009', verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });
  let paid = 0;
  const seenMock = [];
  const checker = createChecker({ subjectOf: async () => GOOD, mock: () => false, inline: true, budgetStatus: () => ({ blocked: true }),
    modelCall: async () => { paid += 1; return { text: '{}', costUsd: 0.01, costKind: 'billed' }; },
    judgeCriterion: async ({ mock }) => { seenMock.push(mock); return { met: true, reason: 'r', proof: 'Cut export tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }; } });
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: store.readExample('wf', ex.id).criteria[0].id });
  assert.equal(paid, 0, 'no copy call');
  assert.ok(seenMock.length === 16 && seenMock.every((m) => m === true), 'every check on the mock');
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE round_id = ?').get(round.id).n, 0);
  assert.equal(store.mockPipeline('p0000009'), true);
  assert.equal(store.mockPipeline('p0000001'), false);
});

test('board 59 A: tried, but no try passed (and nothing liked, no good run): refused with its own words, still a 422 (NOT_READY)', async () => {
  const { NO_PASSED_TRY_TEXT } = await import('../src/core/workflow-tests/checker.mjs');
  assert.equal(NO_PASSED_TRY_TEXT, 'No try of this example passed yet, so Worca has no good result to break. Pick a result you liked, or fix what fails and try again.');
  const ex = store.createExample('wf', { name: 'E', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'm' } });
  const run = store.createTestRun({ workflowId: 'wf', kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const checker = createChecker({ subjectOf: async () => GOOD, modelCall: async () => ({ text: '{}', costUsd: 0 }), judgeCriterion: async () => ({}), mock: () => false });
  const start = () => checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  const add = (status) => {
    const t = store.insertTry({ runId: run.id, workflowId: 'wf', exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
    store.linkTry(run.id, t.id, 'b');
    store.updateTry(t.id, { status, pipelineId: 'p0000001', verdict: { passed: status === 'passed', facts: { status: 'done' }, basics: [], checks: [] } });
  };
  add('stopped');
  await assert.rejects(start(), { code: 'NOT_READY', message: NO_SOURCE_TEXT }, 'a try that did not finish is not a try: board 53 state 3 stays');
  add('failed');
  await assert.rejects(start(), { code: 'NOT_READY', message: NO_PASSED_TRY_TEXT });
});

test('review M3: a passed try with no text never reads "No try of this example passed yet"', async () => {
  const ex = store.createExample('wf', { name: 'E', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'm' } });
  const run = store.createTestRun({ workflowId: 'wf', kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const checker = createChecker({ subjectOf: async () => '', modelCall: async () => ({ text: '{}', costUsd: 0 }), judgeCriterion: async () => ({}), mock: () => false });
  const add = (status, pipelineId) => {
    const t = store.insertTry({ runId: run.id, workflowId: 'wf', exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
    store.updateTry(t.id, { status, ...(pipelineId ? { pipelineId } : {}), verdict: { passed: status === 'passed', facts: { status: 'done' }, basics: [], checks: [] } });
  };
  add('passed', 'p0000001');   // passed, but its result is empty
  add('failed', 'p0000002');
  await assert.rejects(checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id }), { code: 'NOT_READY', message: NO_SOURCE_TEXT });
  const ex2 = store.createExample('wf', { name: 'E2', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'm' } });
  const t = store.insertTry({ runId: run.id, workflowId: 'wf', exampleId: ex2.id, use: 'draft', fp: 'f', exampleFp: ex2.fingerprint, tryNo: 1 });
  store.updateTry(t.id, { status: 'passed', verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });   // passed, no pipeline
  await assert.rejects(checker.start({ workflowId: 'wf', exampleId: ex2.id, criterionId: store.readExample('wf', ex2.id).criteria[0].id }), { code: 'NOT_READY', message: NO_SOURCE_TEXT });
});

test('no good result: refused with the board sentence; one round at a time per criterion', async () => {
  const ex = store.createExample('wf', { name: 'E', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'm' } });
  const checker = createChecker({ subjectOf: async () => '', modelCall: async () => ({ text: '{}', costUsd: 0 }), judgeCriterion: async () => ({}), mock: () => false });
  await assert.rejects(checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id }), { code: 'NOT_READY', message: NO_SOURCE_TEXT });
  const s = setup();
  const slow = createChecker({ subjectOf: async () => GOOD, modelCall: () => new Promise(() => {}), judgeCriterion: async () => ({}), mock: () => false, budgetStatus: () => ({ blocked: false }) });
  await slow.start({ workflowId: 'wf', exampleId: s.ex.id, criterionId: s.ex.criteria[0].id });
  await assert.rejects(slow.start({ workflowId: 'wf', exampleId: s.ex.id, criterionId: s.ex.criteria[0].id }), { code: 'BUSY' });
});

test('M18: a round left making by a restart is failed at boot, so the page stops polling', () => {
  const ex = store.createExample('wf', { name: 'E', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'm' } });
  const r = cs.createRound({ workflowId: 'wf', exampleId: ex.id, criterionId: 'k_1', fp: 'f', model: 'm', source: {} });
  assert.equal(cs.recoverRounds(), 1);
  assert.deepEqual([cs.readRound(r.id).status, cs.recoverRounds()], ['failed', 0]);
});

test('a check that errors on a real or planted card fails the round, books every paid call, and no answer is accepted', async () => {
  let n = 0;
  const { ex, checker } = setup({ extra: { judgeCriterion: async ({ subject, book }) => { n += 1; book(0.01, 'billed');
    if (n === 3) return { met: null, reason: null, proof: null, proofFound: false, error: 'limit', costUsd: 0.01, ms: 1 };
    return { met: /60%/.test(subject), reason: 'r', proof: 'p', proofFound: true, error: null, costUsd: 0.01, ms: 1 }; } } });
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  const r = cs.readRound(round.id);
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /spending limit is reached/);
  assert.ok(ledger(round.id).length >= 3 + 3);
  const v = checker.view(r, { by: 'ana' });
  await assert.rejects(checker.answer(r, v.cards[0].judgementId, true, { by: 'ana' }), { code: 'BUSY' });
});

test('answer() refuses a card whose verdict is empty, even in a ready round', async () => {
  const { ex, checker } = setup();
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  const j = cs.insertJudgement({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: round.fp, model: round.model, purpose: 'planted',
    roundId: round.id, card: 9, j: { met: null, error: 'failed' } });
  await assert.rejects(checker.answer(cs.readRound(round.id), j.id, true, { by: 'ana' }), { code: 'BAD_REQUEST' });
});

test('errored repeats and filler checks are left out of the totals, and the round stays ready', async () => {
  const subjects = [];
  const { ex, checker } = setup({ extra: { judgeCriterion: async ({ subject, book }) => { subjects.push(subject); book(0.01, 'billed');
    const filler = subject.includes('adds no new facts');
    if (filler && subjects.filter((s) => s.includes('adds no new facts')).length === 1) return { met: null, error: 'failed', proofFound: false, costUsd: 0.01, ms: 1 };
    return { met: /60%/.test(subject), reason: 'r', proof: 'p', proofFound: true, error: null, costUsd: 0.01, ms: 1 }; } } });
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  assert.equal(cs.readRound(round.id).status, 'ready');
  assert.deepEqual(checker.view(cs.readRound(round.id), { by: 'ana' }).auto.padding, { n: 3, of: 3 });
});

test('a failed copy call that reported an unknown $0 cost books a $0 unknown row (P4-Q17)', async () => {
  const u = setup({ extra: { modelCall: async () => { throw Object.assign(new Error('x'), { costUsd: 0, costKind: 'unknown' }); } } });
  const r = await startOf(u);
  assert.equal(prepare("SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE round_id = ? AND cost_kind = 'unknown'").get(r.id).n, 1);
});

test('the view shows the criterion text the round ran on, and says when the text was changed since', async () => {
  const { ex, checker } = setup();
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  assert.equal(checker.view(cs.readRound(round.id), { by: 'x' }).textChanged, undefined);
  store.updateExample('wf', ex.id, { criteria: [{ ...ex.criteria[0], text: 'Names a success metric, with a number and a date' }] });
  const v = checker.view(cs.readRound(round.id), { by: 'x' });
  assert.equal(v.criterion, 'Names a success metric with a number');
  assert.equal(v.textChanged, true);
});

test('a failed round has its own words when started again', async () => {
  const { ex, checker } = setup({ extra: { judgeCriterion: async () => { throw new Error('x'); } } });
  const warn = console.warn; console.warn = () => {};
  let round;
  try { round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id }); } finally { console.warn = warn; }
  assert.equal(round.status, 'failed');
  assert.equal(cs.readRound(round.id).detail, 'This round did not finish. Start a new round.', 'board 58: never the error text itself');
  await assert.rejects(checker.answer(round, 1, true, {}), { message: 'This round did not finish. Start a new round.' });
});

test('a one-paragraph result with no numbers still gets 3 plants, so a round has its 4 cards', () => {
  for (const text of ['Customers can export their data to CSV from the settings page.', '## Goal\n\nCustomers can export data.']) {
    const d = deterministicPlants(text);
    assert.equal(d.length, 3, `3 plants for: ${text.slice(0, 20)}`);
    assert.equal(new Set(d.map((x) => x.text)).size, 3, 'three different broken versions');
    assert.ok(d.every((x) => x.text !== text && /[A-Za-z]/.test(x.text.replace(/^#.*$/gm, ''))));
  }
});

test('a one-paragraph good result (with or without a heading) plants without emptying the text, and the mock round is ready', async () => {
  for (const text of ['Cut export tickets by 60% within one quarter, counted by the Export tag.', '## Metric\n\nCut export tickets by 60% within one quarter, counted by the Export tag.']) {
    const d = deterministicPlants(text);
    assert.ok(d.length >= 3 && d.every((x) => x.text !== text && /[A-Za-z]/.test(x.text.replace(/^#.*$/gm, ''))), `3 usable plants for: ${text.slice(0, 20)}`);
    const { ex, checker } = setup({ extra: { subjectOf: async () => text, mock: () => true,
      judgeCriterion: (a) => realJudge(a, { mock: () => true }) } });
    const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
    assert.equal(cs.readRound(round.id).status, 'ready', cs.readRound(round.id).detail);
    assert.equal(checker.view(cs.readRound(round.id), { by: 'x' }).cards.length, 4);
  }
});

test('a main card with no verdict stops the round before the repeats and filler are asked', async () => {
  let n = 0;
  const { ex, checker } = setup({ extra: { judgeCriterion: async ({ book }) => { n += 1; book(0.01, 'billed');
    return n === 2 ? { met: null, error: 'unreadable', proofFound: false, costUsd: 0.01, ms: 1 } : { met: true, reason: 'r', proof: 'p', proofFound: true, costUsd: 0.01, ms: 1 }; } } });
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  assert.equal(cs.readRound(round.id).status, 'failed');
  assert.equal(n, 4, 'only the four main cards were asked');
});

test("P4-M3, P4-Q17: the view says when the cost of some of the round's checks is not known", async () => {
  const known = setup();
  const r1 = await startOf(known);
  assert.equal(known.checker.view(cs.readRound(r1.id), { by: 'x' }).costUnknown, false);
  let k = 0;
  const u = setup({ extra: { modelCall: async ({ system }) => ({ text: copyReply(system, ...COPIES[k++]), costUsd: 0, costKind: 'unknown' }) } });
  const r2 = await startOf(u);
  assert.equal(u.checker.view(cs.readRound(r2.id), { by: 'x' }).costUnknown, true);
});

test("check again: its estimate is the round's own calls (the copy calls included), not the clearer words", async () => {
  const s = setup();
  const round = await startOf(s);
  // The clearer-words call books on the round too (purpose 'reword', checker.mjs reword).
  const { recordTestJudgeCost } = await import('../src/core/cost-budget.mjs');
  recordTestJudgeCost({ workflowId: 'wf', exampleId: s.ex.id, roundId: round.id, purpose: 'reword', model: round.model, amountUsd: 0.02, costKind: 'billed' });
  const v = s.checker.view(cs.readRound(round.id), { by: 'x' });
  assert.equal(Math.round(v.costUsd * 100) / 100, 0.21, 'what the round cost, its clearer words included');
  assert.equal(Math.round(v.againUsd * 100) / 100, 0.19, 'checking again makes 3 copies and 16 checks again');
});

test('P4-M3 (board 11): the source of the real card names the version and the date of the try it came from', async () => {
  const { ex, checker } = setup({ use: 4, finishedAt: '2026-10-14T09:30:00.000Z' });
  const round = await checker.start({ workflowId: 'wf', exampleId: ex.id, criterionId: ex.criteria[0].id });
  const v = checker.view(cs.readRound(round.id), { by: 'x' });
  assert.equal(v.source.label, 'From a real result');
  assert.equal(v.source.useLabel, 'v4');
  assert.equal(v.source.at, '2026-10-14T09:30:00.000Z');
  const d = setup();
  const r2 = await d.checker.start({ workflowId: 'wf', exampleId: d.ex.id, criterionId: d.ex.criteria[0].id });
  assert.equal(d.checker.view(cs.readRound(r2.id), { by: 'x' }).source.useLabel, 'Your draft', 'the label the Tests pages use (useLabel)');
});

test('fix round 2 (N2): an example deleted while the round looks for its good result gets no round, no call and no row', async () => {
  let deleted = false;
  const s = setup({ extra: { subjectOf: async () => { if (!deleted) { deleted = store.deleteExample('wf', s.ex.id); } return GOOD; } } });
  prepare("UPDATE wf_test_runs SET status = 'done' WHERE workflow_id = 'wf'").run();   // no test holds the example
  const rounds = () => prepare('SELECT COUNT(*) AS n FROM wf_test_checker_rounds').get().n;
  const before = rounds();
  await assert.rejects(s.checker.start({ workflowId: 'wf', exampleId: s.ex.id, criterionId: s.ex.criteria[0].id }), { code: 'NOT_FOUND' });
  assert.equal(deleted, true, 'the delete went through during the await');
  assert.deepEqual([rounds(), s.calls(), prepare('SELECT COUNT(*) AS n FROM wf_test_judgements WHERE example_id = ?').get(s.ex.id).n], [before, 0, 0]);
});

// The paid check (2026-11-21): the good result stated its target in several sections, and a plant that broke one of them still met the
// criterion ("0 of 3 caught" while the checker was right). With whole copies, every place is broken, so every planted card is caught.
const PAID = readFileSync(fileURLToPath(new URL('./fixtures/workflow-tests/paid-plan-result.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const TARGET = /500 customers|500-customer/;
const PAID_COPIES = [
  ['number removed', PAID.replaceAll('500 customers within 90 days', 'many customers soon').replace('500 customers / 90 days', 'many customers soon').replace('500-customer target', 'customer target')],
  ['target made into activity', PAID.replaceAll('500 customers within 90 days', 'a launch campaign').replace('500 customers / 90 days', 'a launch campaign').replace('500-customer target', 'launch campaign')],
  ['only a vague hope', PAID.replaceAll('500 customers within 90 days', 'more customers').replace('500 customers / 90 days', 'more customers').replace('500-customer target', 'growth hope')]];

test('the paid case: a target stated in four places is broken in all of them, so all three planted mistakes are caught', async () => {
  assert.equal((PAID.match(/500 customers|500-customer/g) || []).length, 4, 'the fixture states its target in four places');
  for (const [how, text] of PAID_COPIES) assert.ok(!TARGET.test(text), `${how}: no place left`);
  const s = setup({ text: PAID, copies: PAID_COPIES, judgeMet: (subject) => TARGET.test(subject),
    proofOf: (subject) => subject.split('\n').find((l) => TARGET.test(l)) || 'Target is absent or wrong' });   // the line that proves it
  const round = await startOf(s);
  const v = s.checker.view(cs.readRound(round.id), { by: 'x' });
  assert.deepEqual(v.cards.map((c) => [c.planted, c.met]), [[null, true], ['number removed', false], ['target made into activity', false], ['only a vague hope', false]]);
  for (const c of v.cards.slice(1)) assert.ok(!TARGET.test(c.excerpt) && c.excerpt.length <= 400 && c.excerpt.includes(' … '), `only changed lines: ${c.excerpt}`);
  const report = trustReportModel({ rounds: [{ criterionText: v.criterion, cards: v.cards, same: v.auto.same, padding: v.auto.padding }] });
  assert.deepEqual(report.tests.find((t) => t.key === 'planted'), { key: 'planted', state: 'good', caught: 3, of: 3, missedOn: [] });
});

test("mock rounds: Worca's own plants break numbers everywhere; their cards never show an unbroken line (review I2), and blind ones are not missed (I1)", async () => {
  const THREE = ['## Acceptance Criteria', '7. States launch target: 500 customers within 90 days', '',
    '## Tests', '| **90-day target** | Text search | Target is absent or wrong | Brief states or implies: "500 customers within 90 days" |', '',
    '## Handoff', 'The brief integrates customer pain (quote) and launch target (500 customers / 90 days).'].join('\n');
  const d = deterministicPlants(THREE);
  assert.equal(d[0].how, 'numbers removed');
  assert.ok(!/\d/.test(d[0].text), `no number left anywhere: ${d[0].text}`);
  assert.ok(!/\d/.test(d[0].excerpt) && d[0].excerpt.split(' … ').length === 3, `the changed lines, without their numbers: ${d[0].excerpt}`);
  assert.ok(d[0].text.includes('## Tests\n| **-day target** |'), 'headings and table borders are kept');
  const s = setup({ text: THREE, judgeMet: () => true, extra: { mock: () => true } });
  const round = await startOf(s);
  const v = s.checker.view(cs.readRound(round.id), { by: 'x' });
  assert.deepEqual(v.cards.map((c) => [c.planted, !!c.blind]), [[null, false], ['numbers removed', false], ['a made-up quote added', true], ['a part removed', true]]);
  const planted = (cards) => trustReportModel({ rounds: [{ criterionText: 'c', cards, same: { n: 0, of: 0 }, padding: { n: 0, of: 0 } }] }).tests.find((t) => t.key === 'planted');
  assert.deepEqual([planted(v.cards).caught, planted(v.cards).of], [0, 1], 'a blind plant called met is not counted as missed');
  const wrong = v.cards.map((c) => (c.card === 2 ? { ...c, answer: false } : c));
  assert.deepEqual([planted(wrong).caught, planted(wrong).of], [0, 2], 'unless the person said Worca was wrong on it');
});

test("round 6 review M4: a project example's good run is checked with its changes, as a try of it is; a text example's is not", async () => {
  const { goodResultOf } = await import('../src/core/workflow-tests/checker.mjs');
  const { CHANGES_HEADING } = await import('../src/core/workflow-tests/judge-prompt.mjs');
  const readMain = async () => ({ text: '## Done\nAdded the parser test.' });
  const readPatch = async (pipelineId) => ({ patch: `diff --git a/t.js b/t.js\n+test('parser') // ${pipelineId}` });
  const from = { pipelineId: 'p0000042', verdict: 'good', use: 'draft' };
  const project = await goodResultOf({ id: 990001, project: { path: 'x' }, from }, { readMain, readPatch });
  assert.equal(project.text, `## Done\nAdded the parser test.\n\n${CHANGES_HEADING}\ndiff --git a/t.js b/t.js\n+test('parser') // p0000042`);
  const text = await goodResultOf({ id: 990002, project: null, from }, { readMain, readPatch });
  assert.equal(text.text, '## Done\nAdded the parser test.');
  const none = await goodResultOf({ id: 990003, project: { path: 'x' }, from }, { readMain, readPatch: async () => null });
  assert.equal(none.text, '## Done\nAdded the parser test.', 'no diff kept: the text alone');
});
