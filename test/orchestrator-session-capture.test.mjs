// test/orchestrator-session-capture.test.mjs
// A custom runner emits a session event through ctx.onEvent; the orchestrator must
// stamp it on the live step record (state.steps[].sessionId) keyed by attr.stepKey.
// Full mock run: custom runners override producer/verifier; the clarifier runner is
// built-in (constructor merges `{ clarifier, ...opts.runners }`) and auto-answers
// under auto: true.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-sess-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

test('session event lands on the step record and persists', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true,
    claude: { mock: true },
    runners: {
      producer: async (ctx) => { ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` }); return { status: 'ok', summary: 'ok' }; },
      verifier: async (ctx) => { ctx.onEvent({ type: 'session', sessionId: 'sess-ver' }); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const withSession = orch.state.steps.filter((s) => s.sessionId);
  assert.ok(withSession.length >= 2, 'producer and verifier steps captured session ids');
  assert.ok(withSession.some((s) => s.sessionId === 'sess-ver'));
});
