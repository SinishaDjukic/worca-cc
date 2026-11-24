// test/orchestrator-resume-rerun.test.mjs
// Rerun (docs/runs.md): a rerun's live state carries `rerunOf` from its start, and a resumed rerun carries it again, so
// the live run page links back without reading the saved run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { createPipeline, findPipelineRowById, readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-resume-rerun-'));
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

const engine = ENGINES[0];

test('a resumed rerun keeps rerunOf on its live state', async () => {
  const dir = gitDir();
  const src = await createPipeline(dir, { prompt: 'p', title: 'Fix login' });
  let hangOnce = true;
  let orchRef = null;
  const mkRunners = () => ({
    producer: async (ctx) => {
      if (hangOnce) {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
  });

  const orch1 = engine.create({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners(), rerunOf: src.id });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  assert.equal(orch1.getState().rerunOf.id, src.id, 'a fresh rerun mirrors the link');

  const orch2 = engine.create({ projectDir: dir, claude: { mock: true }, auto: true, runners: mkRunners(), resume: readPipelineForResume(orch1.state.id) });
  orchRef = orch2;
  const states = [];
  orch2.on('state', (s) => states.push(s));
  assert.equal((await orch2.resume()).status, 'done');
  assert.ok(states.length, 'the resumed run emitted state');
  assert.deepEqual(states[0].rerunOf, { id: src.id, key: findPipelineRowById(src.id).project_key, title: 'Fix login', exists: true },
    'the first state frame of the resumed run already links back');
});
