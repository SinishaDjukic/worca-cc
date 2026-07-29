// test/orchestrator-stepper-timing.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after); // store writes -> isolated temp home, not real ~/.worca-cc

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-timing-'));
  tmpDirs.push(dir);
  return dir;
}

test('stepper manifest is emitted before the first phase event (i.e. before preflight/clarify)', async () => {
  const dir = await makeTmpDir();
  const orch = createOrchestrator({
    projectDir: dir,
    workflowId: 'wf_default',
    prompt: 'demo task',
    claude: { mock: true }, // NOTE: option is `claude`, not `claudeOpts`
    auto: true,             // non-interactive: clarify auto-answers, gates auto-continue
  });

  const events = []; // ordered { event, hasStepper?, phase? }
  let firstStepperAt = -1;
  let firstPhaseAt = -1;
  let firstClarifyPhaseAt = -1;

  orch.on('state', (s) => {
    const i = events.push({ event: 'state', hasStepper: !!(s && s.stepper) }) - 1;
    if (firstStepperAt < 0 && s && s.stepper) firstStepperAt = i;
  });
  orch.on('phase', (p) => {
    const i = events.push({ event: 'phase', phase: p && p.phase }) - 1;
    if (firstPhaseAt < 0) firstPhaseAt = i;
    if (firstClarifyPhaseAt < 0 && p && String(p.phase).includes('clarify')) firstClarifyPhaseAt = i;
  });

  // In case clarify emits a question (non-auto path), answer it immediately.
  orch.on('question', (q) => orch.answer(q.id, { answers: [] }));

  await orch.run();

  assert.ok(firstStepperAt >= 0, 'a state event with a stepper was emitted');
  assert.ok(firstPhaseAt >= 0, 'at least one phase event was emitted');
  assert.ok(
    firstStepperAt < firstPhaseAt,
    `stepper (idx ${firstStepperAt}) must precede the first phase event (idx ${firstPhaseAt})`,
  );
  // Secondary, for readability: the blocking clarify phase comes strictly later.
  if (firstClarifyPhaseAt >= 0) {
    assert.ok(firstStepperAt < firstClarifyPhaseAt, 'stepper precedes the clarify phase');
  }
});

after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});
