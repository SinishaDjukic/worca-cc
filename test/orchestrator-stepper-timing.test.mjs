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

test('stepper manifest is emitted before the first exec event (i.e. before preflight/clarify)', async () => {
  const dir = await makeTmpDir();
  const orch = createOrchestrator({
    projectDir: dir,
    workflowId: 'wf_default',
    prompt: 'demo task',
    claude: { mock: true }, // NOTE: option is `claude`, not `claudeOpts`
    auto: true,             // non-interactive: clarify auto-answers, gates auto-continue
  });

  const events = []; // ordered { event, hasStepper?, nodeId? }
  let firstStepperAt = -1;
  let firstExecAt = -1;
  let firstClarifyExecAt = -1;

  orch.on('state', (s) => {
    const i = events.push({ event: 'state', hasStepper: !!(s && s.stepper) }) - 1;
    if (firstStepperAt < 0 && s && s.stepper) firstStepperAt = i;
  });
  orch.on('exec', (p) => {
    const i = events.push({ event: 'exec', nodeId: p && p.nodeId }) - 1;
    if (firstExecAt < 0) firstExecAt = i;
    if (firstClarifyExecAt < 0 && p && String(p.nodeId).includes('clarify')) firstClarifyExecAt = i;
  });

  // In case clarify emits a question (non-auto path), answer it immediately.
  orch.on('question', (q) => orch.answer(q.id, { answers: [] }));

  await orch.run();

  assert.ok(firstStepperAt >= 0, 'a state event with a stepper was emitted');
  assert.ok(firstExecAt >= 0, 'at least one exec event was emitted');
  assert.ok(
    firstStepperAt < firstExecAt,
    `stepper (idx ${firstStepperAt}) must precede the first exec event (idx ${firstExecAt})`,
  );
  // Secondary, for readability: the blocking clarify execution comes strictly later.
  if (firstClarifyExecAt >= 0) {
    assert.ok(firstStepperAt < firstClarifyExecAt, 'stepper precedes the clarify execution');
  }
});

after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});
