// test/run-progress-replay.test.mjs — Known bug 3: over a recorded run the bar moves only on events and never back.
// Regenerate after a deliberate engine change (review the diff):
//   UPDATE_RUN_REPLAY=1 WORCA_HOME=$(mktemp -d) node --test test/run-progress-replay.test.mjs
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { runProgress } from '../src/shared/run-progress.mjs';
import { runModel } from '../src/shared/run-model.mjs';

const FILE = fileURLToPath(new URL('./fixtures/run-replay/wf_default.json', import.meta.url));
const ROW_KEYS = ['executionId', 'nodeId', 'kind', 'status', 'ordinal', 'cycle', 'startedAt', 'taskId', 'phaseOrdinal', 'taskTotal'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const sig = (f) => JSON.stringify([f.status, f.steps, f.active, f.endReached, f.tokens, f.progressFacts, f.pendingQuestion]);

async function record() {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const orch = createOrchestrator({ projectDir: gitDir('replay'), workflowId: 'wf_default', prompt: 'replay probe',
    claude: { mock: true }, auto: false });
  let stepper = null;
  let pq = null;
  const frames = [];
  const push = (s) => {
    stepper ||= s.stepper;
    const f = { status: s.status, steps: (s.steps || []).map((r) => pick(r, ROW_KEYS)), active: s.active || [],
      endReached: s.endReached === true,
      // Only what runProgress reads: a token's `path` is an absolute temp path and must never land in the fixture.
      tokens: Object.fromEntries(Object.entries(s.tokens || {}).map(([k, t]) => [k, { seq: t.seq, firedAt: t.firedAt }])),
      progressFacts: s.progressFacts || null,
      pendingQuestion: pq ? { kind: pq.kind, questions: pq.questions || [] } : null };
    if (!frames.length || sig(frames.at(-1)) !== sig(f)) frames.push(f);
  };
  orch.on('state', push);
  orch.on('question', (q) => { pq = q; push(orch.getState());
    setImmediate(() => { pq = null; orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] }); }); });
  await orch.run();
  push(orch.getState());
  return { workflowId: 'wf_default', stepper, frames };
}

let home;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_MAX_PARALLEL: process.env.WORCA_MAX_PARALLEL };
useTempHome(after);
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-replay-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_MAX_PARALLEL = '4';           // as test/seed-traces.test.mjs pins it, so a re-record is stable
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(home, { recursive: true, force: true });
});

test('recorded wf_default run: the fill never decreases and moves only on an event', { timeout: 300000 }, async () => {
  if (process.env.UPDATE_RUN_REPLAY === '1') {
    mkdirSync(join(FILE, '..'), { recursive: true });
    writeFileSync(FILE, `${JSON.stringify(await record(), null, 1)}\n`);
  }
  const { stepper, frames } = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.ok(frames.length >= 10, 'a real run has many frames');
  const memo = {};
  let last = null;
  for (const [i, f] of frames.entries()) {
    const st = { ...f, stepper };
    const p = runProgress(st, memo);
    if (last) {
      assert.ok(p.fraction >= last.fraction, `frame ${i}: ${p.fraction} < ${last.fraction}`);
      for (let s = 0; s < 4; s++) assert.ok(p.fill[s] >= last.fill[s], `frame ${i}: section ${s} went back`);
    }
    // No event, only time: the same frame an hour later gives the same fill and the same line.
    const a = runModel(st, { memo: { ...memo }, now: Date.parse('2026-10-18T10:00:00Z'), timeZone: 'UTC' });
    const b = runModel(st, { memo: { ...memo }, now: Date.parse('2026-10-18T11:00:00Z'), timeZone: 'UTC' });
    assert.equal(a.progress.fraction, b.progress.fraction, `frame ${i}: moved on time`);
    assert.equal(a.line, b.line);
    last = p;
  }
  assert.equal(last.fraction, 1, 'the run reached Ready');
  assert.ok(frames.some((f) => f.pendingQuestion), 'the recording includes a Needs you frame');
});
