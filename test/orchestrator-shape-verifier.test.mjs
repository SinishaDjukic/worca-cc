// test/orchestrator-shape-verifier.test.mjs — Shaper small runs C5 (D9, D14, D15): the Verifier run in the real
// orchestrator with the mock engine. `_afterVerify` reads the Verifier's file after n_verify, raises the gap stop
// (reason `check`) on any round with an open gap, and writes verify-result.json {result, headSha, decision} into the
// run dir; `decision` is the normalized answer object.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { verifyPrompt } from '../src/shared/shape/verifier.mjs';
import { getDb } from '../src/core/db.mjs';
import { setNightMode, setNightModeToggle } from '../src/core/settings.mjs';
import { readNightDecisions, writeNightDecision } from '../src/core/night/store.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV_KEYS = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_MOCK_VERIFY'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-verifier-home-'));
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_FLAGS = 'shaperSmallRuns';
});
afterEach(async () => {
  delete process.env.WORCA_MOCK_VERIFY; _testing.runClaude = null;
  await setNightMode(null); await setNightModeToggle('auto');   // slice 10: no Away setting leaks into the next case
});
after(async () => {
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const OWNED = [1, 2, 3].map((i) => ({ id: `R-po-${i}`, run: i, text: `requirement ${i}`, example: `example ${i}` }));
const VERIFIER = /^MOCK_ROLE: feature-verifier$/m;

/** A Verifier run of `round` under Care's `fixCycles`; `on.gate` answers its stop. `ref` adds to shape.verify (texts,
 *  shipped); `auto` is --yes. → {orch, asked, done} */
function start({ round = 1, fixCycles = 1, extra = 0, on = {}, afterSpawn = null, tag = 'v', ref = {}, auto = false } = {}) {
  const dir = gitDir(`verifier-${tag}`);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const orch = createOrchestrator({ workflowId: 'wf_shape_verify', prompt: verifyPrompt({ owned: OWNED, round }), projectDir: dir,
    claude: { mock: true }, ...(auto ? { auto: true } : {}),
    shape: { verify: { featureId: 'feat_x', round, fixCycles, extra, owned: OWNED.map((o) => o.id), head: { index: 3, pipelineId: 'p3' }, ...ref } } });
  const asked = [];
  _testing.runClaude = async (o) => {
    if (afterSpawn) { const r = await afterSpawn(o); if (r !== undefined) return r; }
    return runClaude(o);
  };
  orch.on('question', (q) => {
    asked.push(q);
    const own = on[q.kind];
    if (own) setImmediate(() => own(q, orch));
  });
  return { orch, asked, done: orch.run(), head };
}
const resultOf = async (orch) => JSON.parse(await readFile(join(orch.pipeline.dir, 'verify-result.json'), 'utf8'));
const TEXTS = Object.fromEntries(OWNED.map((o) => [o.id, o.text]));
const decide = (...answers) => ({ decision: 'answer', answers });
const FIX = (id) => ({ id, answer: 'fix' });
const reply = (payload) => (q, orch) => orch.answer(q.id, payload);
/** Slice 10: the decision of a gate the person answered alone. */
const byYou = (d) => ({ ...d, answeredBy: Object.fromEntries(d.answers.map((a) => [a.id, 'you'])) });
const whyOf = (id) => `the mock Verifier found ${id} missing between runs`;
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);

test('round 1 with a gap raises exactly one gap stop (form gaps); a clean round raises none; n_verify raises no approval stop', { timeout: 60_000 }, async () => {
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-2']]);
  const h = start({ round: 1, fixCycles: 3, ref: { texts: TEXTS }, on: { gate: reply(decide(FIX('R-po-2'))) }, tag: 'r1' });
  assert.equal((await h.done).status, 'done');
  assert.equal(h.asked.length, 1, 'one question: the gate, no plan approval');
  const q = h.asked[0];
  assert.equal(q.kind, 'gate');
  assert.equal(q.stop.reason, 'check');
  assert.equal(q.stop.form, 'gaps');
  assert.equal(q.stop.pick, 'fix');
  assert.equal(q.stop.head, 'Verifier · 1 gap found');
  assert.deepEqual(q.stop.gaps, [{ id: 'R-po-2', why: whyOf('R-po-2'), text: 'requirement 2' }]);
  const file = await resultOf(h.orch);
  assert.deepEqual(file.decision, byYou(decide(FIX('R-po-2'))));
  assert.deepEqual(file.result.gaps.map((g) => g.id), ['R-po-2']);
  assert.deepEqual(file.result.held, ['R-po-1', 'R-po-3']);
  assert.equal(file.headSha, h.head, "headSha is the Verifier's checkout HEAD");
  const clean = start({ round: 2, fixCycles: 1, extra: 1, tag: 'clean' });
  assert.equal((await clean.done).status, 'done');
  assert.deepEqual(clean.asked, []);
  assert.deepEqual((await resultOf(clean.orch)).result.gaps, []);
});

test('a continue, another or incomplete answer is refused and the stop stays open; a complete one writes the normalized answers and one audit line', { timeout: 60_000 }, async () => {
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', 'R-po-2', 'R-po-3']]);
  const refused = [];
  const raw = decide({ id: 'R-po-3', answer: 'change', text: '  requirement 3,\n new words ' },
    { id: 'R-po-2', answer: 'ship', reason: ' covered by\n a later feature ' }, FIX('R-po-1'));
  const h = start({ round: 1, fixCycles: 3, ref: { texts: TEXTS }, tag: 'answers', on: { gate: (q, orch) => {
    for (const bad of [{ decision: 'continue' }, { decision: 'another' }, decide(FIX('R-po-1')),
      decide(FIX('R-po-1'), { id: 'R-po-2', answer: 'ship', reason: '' }, FIX('R-po-3'))]) refused.push(orch.answer(q.id, bad));
    refused.push(orch.answer(q.id, raw));
  } } });
  const r = await Promise.race([h.done, new Promise((res) => setTimeout(() => res({ status: 'still asking' }), 45_000).unref())]);
  assert.deepEqual(refused, [false, false, false, false, true], 'only the complete answer is taken');
  assert.equal(r.status, 'done');
  assert.equal(h.asked.length, 1, 'asked once: a refused answer leaves the same question open');
  const normalized = decide(FIX('R-po-1'), { id: 'R-po-2', answer: 'ship', reason: 'covered by a later feature' },
    { id: 'R-po-3', answer: 'change', text: 'requirement 3, new words', from: 'requirement 3' });
  assert.deepEqual((await resultOf(h.orch)).decision, byYou(normalized));
  assert.deepEqual(auditOf(h.orch).filter((t) => t.startsWith('Verifier:')),
    ['Verifier: 1 fix run · 1 changed requirement · 1 ships with a gap · decided by you']);
});

test('a gap shipped earlier in the series is not asked again: the stop lists only the open gap, and with none open the answer is empty', { timeout: 60_000 }, async () => {
  const shipped = [{ id: 'R-po-2', reason: 'covered by a later feature' }];
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([[], ['R-po-2']]);
  const all = start({ round: 2, fixCycles: 3, ref: { texts: TEXTS, shipped }, tag: 'carried' });
  assert.equal((await all.done).status, 'done');
  assert.deepEqual(all.asked, [], 'nothing left to ask');
  const file = await resultOf(all.orch);
  assert.deepEqual(file.decision, decide());
  assert.deepEqual(file.result.gaps.map((g) => g.id), ['R-po-2'], 'the gap is still reported');
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([[], ['R-po-2', 'R-po-3']]);
  const some = start({ round: 2, fixCycles: 3, ref: { texts: TEXTS, shipped }, tag: 'carried-one', on: { gate: reply(decide(FIX('R-po-3'))) } });
  assert.equal((await some.done).status, 'done');
  assert.equal(some.asked.length, 1);
  assert.deepEqual(some.asked[0].stop.gaps.map((g) => g.id), ['R-po-3']);
  assert.equal(some.asked[0].stop.head, 'Verifier · 1 gap still open');
  assert.deepEqual((await resultOf(some.orch)).decision, byYou(decide(FIX('R-po-3'))));
});

test('a stashed answer from before the gate ({decision: another}) is asked again; a complete stashed answer is replayed', { timeout: 60_000 }, async () => {
  const id = 'verify-2-x:n_verify:1';
  const stashed = (payload, tag) => {
    process.env.WORCA_MOCK_VERIFY = JSON.stringify([[], ['R-po-2']]);
    let h;
    h = start({ round: 2, fixCycles: 1, ref: { texts: TEXTS }, tag, on: { gate: reply(decide({ id: 'R-po-2', answer: 'ship', reason: 'later' })) },
      afterSpawn: (o) => { if (VERIFIER.test(o.prompt || '')) h.orch._stopAnswer = { id, payload }; return undefined; } });
    return h;
  };
  const old = stashed({ decision: 'another' }, 'old-stash');
  assert.equal((await old.done).status, 'done');
  assert.deepEqual(old.asked.map((q) => q.id), [id], 'the gate is asked again');
  assert.deepEqual((await resultOf(old.orch)).decision, byYou(decide({ id: 'R-po-2', answer: 'ship', reason: 'later' })));
  const kept = stashed(decide(FIX('R-po-2')), 'kept-stash');
  assert.equal((await kept.done).status, 'done');
  assert.deepEqual(kept.asked, [], 'replayed, not asked');
  const { answeredBy: who = {}, ...replayed } = (await resultOf(kept.orch)).decision;
  assert.deepEqual(replayed, decide(FIX('R-po-2')));
  assert.deepEqual(who, {}, 'a stash from before the field names nobody');
});

test('under --yes a round with a gap writes decision null and no audit line: no gap ships without a reason', { timeout: 60_000 }, async () => {
  for (const round of [1, 2]) {
    process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-2'], ['R-po-2']]);
    const h = start({ round, fixCycles: 1, ref: { texts: TEXTS }, auto: true, tag: `yes-${round}` });
    assert.equal((await h.done).status, 'done', String(round));
    const file = await resultOf(h.orch);
    assert.equal(file.decision, null, String(round));
    assert.deepEqual(file.result.gaps.map((g) => g.id), ['R-po-2']);
    assert.deepEqual(auditOf(h.orch).filter((t) => t.startsWith('Verifier:')), [], String(round));
  }
});

test('a missing result file fails the run with VERIFY_RESULT_MISSING (an unparseable or oversized file); an absent one pauses on dev\'s missing-output path', async () => {
  const writeBad = (body) => async (o) => {
    if (!VERIFIER.test(o.prompt || '')) return undefined;
    const out = String(o.prompt).match(/Write \*\*verify\*\* to: (\S+)/)[1];
    await writeFile(out, body, 'utf8');
    return { text: 'wrote a bad file', exitCode: 0 };
  };
  for (const [tag, body] of [['bad', 'not json'], ['shape', '{"verdicts": []}'], ['big', JSON.stringify({ checks: [], pad: 'x'.repeat(300_000) })]]) {
    const h = start({ tag, afterSpawn: writeBad(body) });
    const r = await h.done;
    assert.equal(r.status, 'error', tag);
    assert.match(r.error, /The Verifier wrote no result/, tag);
    assert.equal(h.orch._graphError?.code, 'VERIFY_RESULT_MISSING', tag);
    assert.deepEqual(h.asked, [], tag);
    await assert.rejects(resultOf(h.orch), tag);
  }
  const absent = start({ tag: 'absent', afterSpawn: (o) => (VERIFIER.test(o.prompt || '') ? { text: 'wrote nothing', exitCode: 0 } : undefined) });
  assert.equal((await absent.done).status, 'paused');
  await assert.rejects(resultOf(absent.orch));
});

// Slice 9 (R-po-4): a note is no question, and --yes never acknowledges it. The mock writes no findings, so the test
// writes the Verifier's file.
test('under --yes a clean file with a note keeps result.findings in verify-result.json, asks nothing and writes no acks', { timeout: 60_000 }, async () => {
  const note = 'the import test takes 40 s';
  const writeNoted = async (o) => {
    if (!VERIFIER.test(o.prompt || '')) return undefined;
    const out = String(o.prompt).match(/Write \*\*verify\*\* to: (\S+)/)[1];
    await writeFile(out, JSON.stringify({ checks: OWNED.map((x) => ({ id: x.id, holds: true })), findings: [note] }), 'utf8');
    return { text: 'checked', exitCode: 0 };
  };
  const h = start({ ref: { texts: TEXTS }, auto: true, afterSpawn: writeNoted, tag: 'yes-note' });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.asked, [], 'a note opens no gate on the run');
  const file = await resultOf(h.orch);
  assert.deepEqual(file.result, { held: OWNED.map((o) => o.id), gaps: [], findings: [{ id: 'note-1', text: note }] });
  assert.doesNotMatch(JSON.stringify(file), /"acks"/);
});

// ── Slice 10 (R-po-5): Away mode answers fix for a plain gap and holds the rest for the person ────────────────
const JUDGEMENT = (id) => ({ id, kind: 'judgement' });
const SHIP = (id) => ({ id, answer: 'ship', reason: 'later' });
const HOLD = 'the Verifier calls this a judgement call';
const away = async (patch = {}) => { await setNightMode({ enabled: true, ...patch }); await setNightModeToggle('on'); };
const verifierAudit = (orch) => getDb().prepare('SELECT text, actor FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(orch.getState().id)
  .filter((r) => r.text.startsWith('Verifier:')).map((r) => ({ ...r }));   // node:sqlite rows have a null prototype
const awayLine = (id) => ({ text: `Verifier: Gap ${id} → fix · decided by Away mode`, actor: 'night-mode' });
const nightRows = (orch) => readNightDecisions(orch.getState().id);
/** The run's end, or 'still asking' when its gate never closes. */
const ended = (done) => Promise.race([done, new Promise((res) => setTimeout(() => res({ status: 'still asking' }), 45_000).unref())]);

test('Away mode answers fix for a plain gap and holds a judgement call', { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  const h = start({ ref: { texts: TEXTS }, tag: 'away-mixed', on: { gate: reply(decide(SHIP('R-po-2'))) } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.equal(h.asked.length, 1, 'one question, for the held gap');
  const stop = h.asked[0].stop;
  assert.deepEqual(stop.gaps.map((g) => [g.id, g.kind, g.hold]), [['R-po-2', 'judgement', HOLD]]);
  assert.deepEqual(stop.decided, [{ id: 'R-po-1', answer: 'fix', by: 'away' }]);
  assert.equal(stop.head, 'Verifier · 1 gap found');
  const file = await resultOf(h.orch);
  assert.deepEqual(file.result.gaps.map((g) => [g.id, g.kind]), [['R-po-1', undefined], ['R-po-2', 'judgement']]);
  assert.deepEqual(verifierAudit(h.orch)[0], awayLine('R-po-1'));
  assert.deepEqual(nightRows(h.orch).map((r) => [r.kind, r.questionId, r.strategy, r.choice, r.flagged]),
    [['gate', h.asked[0].id, 'rule', 'fix R-po-1', false]]);
});

test("the person's answer to the held gap logs decided by you and the decision says who answered each gap", { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  const h = start({ ref: { texts: TEXTS }, tag: 'away-you', on: { gate: reply(decide(SHIP('R-po-2'))) } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.deepEqual((await resultOf(h.orch)).decision,
    { decision: 'answer', answers: [FIX('R-po-1'), SHIP('R-po-2')], answeredBy: { 'R-po-1': 'away', 'R-po-2': 'you' } });
  const lines = verifierAudit(h.orch);
  assert.deepEqual(lines.map((l) => l.text), [awayLine('R-po-1').text, 'Verifier: 1 ships with a gap · decided by you'],
    "the person's line counts the person's answers only");
  assert.notEqual(lines[1].actor, 'night-mode');
});

test('mixed round: no verify-result decision until the person answers the held gap', { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  let seen = null;
  const h = start({ ref: { texts: TEXTS }, tag: 'away-wait', on: { gate: async (q, orch) => {
    await new Promise((r) => setTimeout(r, 200));   // Away on, and no grace timer answers the held gap
    seen = { pending: orch.pendingQuestion?.id ?? null, written: await resultOf(orch).then(() => true, () => false) };
    orch.answer(q.id, decide(FIX('R-po-2')));
  } } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.deepEqual(seen, { pending: h.asked[0].id, written: false });
  assert.deepEqual(h.asked[0].stop.gaps.map((g) => g.id), ['R-po-2'], 'only the held gap is asked');
  assert.deepEqual((await resultOf(h.orch)).decision.answeredBy, { 'R-po-1': 'away', 'R-po-2': 'you' });
});

test('a refused answer to the held gap leaves the gate open and keeps the Away answers', { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  const taken = [];
  const h = start({ ref: { texts: TEXTS }, tag: 'away-refused', on: { gate: (q, orch) => {
    for (const payload of [decide({ id: 'R-po-2', answer: 'ship', reason: '' }), decide(SHIP('R-po-1'), FIX('R-po-2')), decide(FIX('R-po-2'))]) {
      taken.push(orch.answer(q.id, payload));
    }
  } } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.deepEqual(taken, [false, false, true], "a missing reason and an answer for Away's gap are refused");
  assert.equal(h.asked.length, 1);
  assert.deepEqual((await resultOf(h.orch)).decision.answers, [FIX('R-po-1'), FIX('R-po-2')]);
  assert.equal(verifierAudit(h.orch).filter((l) => l.actor === 'night-mode').length, 1);
  assert.equal(nightRows(h.orch).length, 1);
});

test('Away mode with every gap plain asks nothing: all fix, all away, one night row, one audit line each', { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', 'R-po-3']]);
  const h = start({ ref: { texts: TEXTS }, tag: 'away-all', on: { gate: reply(decide(FIX('R-po-1'), FIX('R-po-3'))) } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.deepEqual(h.asked, [], 'no question event');
  assert.deepEqual((await resultOf(h.orch)).decision,
    { decision: 'answer', answers: [FIX('R-po-1'), FIX('R-po-3')], answeredBy: { 'R-po-1': 'away', 'R-po-3': 'away' } });
  assert.deepEqual(verifierAudit(h.orch), [awayLine('R-po-1'), awayLine('R-po-3')], 'and no line by you');
  assert.deepEqual(nightRows(h.orch).map((r) => [r.kind, r.strategy, r.choice, r.flagged]), [['gate', 'rule', 'fix R-po-1, R-po-3', false]]);
});

test('Away mode off: every gap is asked, nothing is decided for the person, and the decision says you', { timeout: 60_000 }, async () => {
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  const answer = decide(FIX('R-po-1'), FIX('R-po-2'));
  const h = start({ ref: { texts: TEXTS }, tag: 'away-off', on: { gate: reply(answer) } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.deepEqual(h.asked[0].stop.gaps.map((g) => g.id), ['R-po-1', 'R-po-2']);
  assert.equal('decided' in h.asked[0].stop, false);
  assert.deepEqual((await resultOf(h.orch)).decision, byYou(answer));
  assert.deepEqual(verifierAudit(h.orch).map((l) => l.text), ['Verifier: 2 fix runs · decided by you']);
  assert.deepEqual(nightRows(h.orch), []);
});

test("Away mode with its answer limit spent holds every gap for the person", { timeout: 60_000 }, async () => {
  await away({ maxDecisions: 1 });
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1']]);
  let h;
  h = start({ ref: { texts: TEXTS }, tag: 'away-limit', on: { gate: reply(decide(FIX('R-po-1'))) },
    afterSpawn: (o) => { if (VERIFIER.test(o.prompt || '')) writeNightDecision(h.orch.getState().id, { questionId: 'earlier', kind: 'clarify', choice: 'x' }); return undefined; } });
  assert.equal((await ended(h.done)).status, 'done');
  assert.deepEqual(h.asked.map((q) => q.stop.gaps.map((g) => g.id)), [['R-po-1']]);
  assert.equal('decided' in h.asked[0].stop, false);
  assert.deepEqual((await resultOf(h.orch)).decision.answeredBy, { 'R-po-1': 'you' });
  assert.deepEqual(nightRows(h.orch).map((r) => r.questionId), ['earlier'], 'no second row');
});

/** Resume the paused Verifier run of `h`; `on` answers a gate it asks again. */
function resumeOf(h, on = {}) {
  const orch = createOrchestrator({ workflowId: 'wf_shape_verify', projectDir: h.orch.projectDir, claude: { mock: true },
    resume: readPipelineForResume(h.orch.getState().id), shape: h.orch.runShape });
  const asked = [];
  orch.on('question', (q) => { asked.push(q); const own = on[q.kind]; if (own) setImmediate(() => own(q, orch)); });
  return { orch, asked, done: orch.resume() };
}

test('a pause after the Away split resumes with the same Away answers, one Away line and one night row, even with Away off again', { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  const h = start({ ref: { texts: TEXTS }, tag: 'away-pause', on: { gate: (q, orch) => orch.pause() } });
  assert.equal((await ended(h.done)).status, 'paused');
  await setNightModeToggle('off');
  const r = resumeOf(h, { gate: reply(decide(FIX('R-po-2'))) });
  assert.equal((await ended(r.done)).status, 'done');
  assert.equal(r.asked.length, 1);
  assert.equal(r.asked[0].id, h.asked[0].id);
  assert.deepEqual(r.asked[0].stop.decided, [{ id: 'R-po-1', answer: 'fix', by: 'away' }]);
  assert.deepEqual(r.asked[0].stop.gaps.map((g) => g.id), ['R-po-2']);
  assert.deepEqual((await resultOf(r.orch)).decision.answeredBy, { 'R-po-1': 'away', 'R-po-2': 'you' });
  assert.equal(verifierAudit(r.orch).filter((l) => l.actor === 'night-mode').length, 1);
  assert.equal(nightRows(r.orch).length, 1);
});

test("the person's answer, then a pause, is replayed on resume with who answered each gap", { timeout: 60_000 }, async () => {
  await away();
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-1', JUDGEMENT('R-po-2')]]);
  const h = start({ ref: { texts: TEXTS }, tag: 'away-replay', on: { gate: (q, orch) => { orch.answer(q.id, decide(SHIP('R-po-2'))); orch.pause(); } } });
  assert.equal((await ended(h.done)).status, 'paused');
  await setNightModeToggle('off');
  const r = resumeOf(h);
  assert.equal((await ended(r.done)).status, 'done');
  assert.deepEqual(r.asked, [], 'replayed, not asked');
  assert.deepEqual((await resultOf(r.orch)).decision,
    { decision: 'answer', answers: [FIX('R-po-1'), SHIP('R-po-2')], answeredBy: { 'R-po-1': 'away', 'R-po-2': 'you' } });
  assert.deepEqual(verifierAudit(r.orch).map((l) => l.text), [awayLine('R-po-1').text, 'Verifier: 1 ships with a gap · decided by you']);
  assert.equal(nightRows(r.orch).length, 1);
});
