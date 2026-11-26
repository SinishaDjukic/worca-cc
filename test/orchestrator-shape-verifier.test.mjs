// test/orchestrator-shape-verifier.test.mjs — Shaper small runs C5 (D9, D14, D15): the Verifier run in the real
// orchestrator with the mock engine. `_afterVerify` reads the Verifier's file after n_verify, raises C3's `check` stop
// only past Care's bound, and writes verify-result.json {result, headSha, decision} into the run dir.
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

/** A Verifier run of `round` under Care's `fixCycles`; `on.gate` answers its stop. → {orch, asked, done} */
function start({ round = 1, fixCycles = 1, extra = 0, on = {}, afterSpawn = null, tag = 'v' } = {}) {
  const dir = gitDir(`verifier-${tag}`);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const orch = createOrchestrator({ workflowId: 'wf_shape_verify', prompt: verifyPrompt({ owned: OWNED, round }), projectDir: dir,
    claude: { mock: true }, shape: { verify: { featureId: 'feat_x', round, fixCycles, extra, owned: OWNED.map((o) => o.id), head: { index: 3, pipelineId: 'p3' } } } });
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
const pick = (value) => (q, orch) => orch.answer(q.id, q.stop.options.find((o) => o.value === value).payload);

test('a gap open at the Care bound raises exactly one stop question (Lean, round 2); continue ends the run with decision continue', async () => {
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([[], ['R-po-2']]);
  const h = start({ round: 2, fixCycles: 1, on: { gate: pick('continue') }, tag: 'bound' });
  const r = await h.done;
  assert.equal(r.status, 'done');
  const stops = h.asked.filter((q) => q.stop);
  assert.equal(h.asked.length, 1);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].stop.reason, 'check');
  assert.equal(stops[0].stop.pick, 'another');
  assert.equal(stops[0].stop.head, 'Verifier · 1 gap still open');
  const file = await resultOf(h.orch);
  assert.equal(file.decision, 'continue');
  assert.deepEqual(file.result.gaps.map((g) => g.id), ['R-po-2']);
  assert.deepEqual(file.result.held, ['R-po-1', 'R-po-3']);
  assert.equal(file.headSha, h.head, "headSha is the Verifier's checkout HEAD");
});

test('another writes decision another', async () => {
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([[], [], ['R-po-1', 'R-po-3']]);
  const h = start({ round: 3, fixCycles: 2, on: { gate: pick('another') }, tag: 'another' });
  assert.equal((await h.done).status, 'done');
  assert.equal(h.asked.length, 1);
  const file = await resultOf(h.orch);
  assert.equal(file.decision, 'another');
  assert.deepEqual(file.result.gaps.map((g) => g.id), ['R-po-1', 'R-po-3']);
});

test('round 1 with a gap raises none; n_verify raises no approval stop', async () => {
  process.env.WORCA_MOCK_VERIFY = JSON.stringify([['R-po-2']]);
  const h = start({ round: 1, fixCycles: 1, tag: 'r1' });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.asked, [], 'no question at all: no plan approval, no stop');
  const file = await resultOf(h.orch);
  assert.equal(file.decision, null);
  assert.deepEqual(file.result.gaps.map((g) => g.id), ['R-po-2']);
  const clean = start({ round: 2, fixCycles: 1, extra: 1, tag: 'clean' });
  assert.equal((await clean.done).status, 'done');
  assert.deepEqual(clean.asked, []);
  assert.deepEqual((await resultOf(clean.orch)).result.gaps, []);
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
