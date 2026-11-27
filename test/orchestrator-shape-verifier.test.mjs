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
afterEach(() => { delete process.env.WORCA_MOCK_VERIFY; _testing.runClaude = null; });
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
  assert.deepEqual(file.decision, decide(FIX('R-po-2')));
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
  assert.deepEqual((await resultOf(h.orch)).decision, normalized);
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
  assert.deepEqual((await resultOf(some.orch)).decision, decide(FIX('R-po-3')));
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
  assert.deepEqual((await resultOf(old.orch)).decision, decide({ id: 'R-po-2', answer: 'ship', reason: 'later' }));
  const kept = stashed(decide(FIX('R-po-2')), 'kept-stash');
  assert.equal((await kept.done).status, 'done');
  assert.deepEqual(kept.asked, [], 'replayed, not asked');
  assert.deepEqual((await resultOf(kept.orch)).decision, decide(FIX('R-po-2')));
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
