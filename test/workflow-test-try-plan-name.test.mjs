// test/workflow-test-try-plan-name.test.mjs — workflow tests 3b (mock browser check, finding 2): every try's plan (and
// review, and every output named from the run's base name) is its own file. Tries of one example on two versions run at
// the same time under the same title, and a long example name is cut before its try number, so a name from the title
// alone made two tries share one plan file (one try then failed: "did not write output plan"). A normal run is unchanged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { tryTitle } from '../src/core/workflow-tests/try-body.mjs';
import { planPath } from '../src/core/artifacts.mjs';

useTempHome(after);
const projectDir = join(tmpdir(), 'wft-plan-name');

/** The plan file a run's first plan goes to, as the graph executor names it (executor.mjs planPath). */
function planOf({ test: isTest, id, title }) {
  const o = createOrchestrator({ projectDir, claude: { mock: true }, ...(isTest ? { workflowTest: true } : {}) });
  o.workMode = 'git';
  o.pipeline = { id, dir: join(tmpdir(), 'pipelines', `13-11-26-x-${id}`), promptText: 'Add a feature helper.' };
  const base = o._deriveBaseName(o.pipeline.promptText, title);
  return { base, path: planPath(projectDir, base, 1, '13-11-26', null, { projectKey: 'proj-1' }) };
}

test('two tries of one example on two versions (same title, same time) get two plan files', () => {
  const title = tryTitle({ name: 'Ticket 1: add a feature helper' }, 1);
  const v1 = planOf({ test: true, id: '5cf96058', title });
  const v2 = planOf({ test: true, id: 'a1b2c3d4', title });
  assert.notEqual(v1.path, v2.path);
  assert.ok(v1.base.length <= 40 && v2.base.length <= 40, `within the cap: ${v1.base}, ${v2.base}`);
  assert.equal(v1.base, 'test-ticket-1-add-a-feature-hel-5cf96058', 'still named after the example, with the run\'s own id');
});

test('a long example name: every try keeps a plan file of its own, within the cap', () => {
  const ex = { name: 'Ticket 2: helper that breaks test a, and a much longer description' };
  const paths = new Set();
  for (const [i, id] of ['11111111', '22222222', '33333333', '44444444', '55555555', '66666666'].entries()) {
    const p = planOf({ test: true, id, title: tryTitle(ex, (i % 3) + 1) });
    assert.ok(p.base.length <= 40, p.base);
    paths.add(p.path);
  }
  assert.equal(paths.size, 6);
});

test('a normal run\'s plan name is unchanged (the title\'s slug, cut at 40)', () => {
  const p = planOf({ test: false, id: '5cf96058', title: 'Add a feature helper for the billing page and more' });
  assert.equal(p.base, 'add-a-feature-helper-for-the-billing-pag');
});
