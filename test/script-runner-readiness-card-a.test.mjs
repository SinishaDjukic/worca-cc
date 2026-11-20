// test/script-runner-readiness-card-a.test.mjs — the readiness view (api.readiness) says who answered the Map
// card A (`readiness-confirm`) of this run: `cardA: { by: 'user' | 'away' | null }`, read in the parent from the
// run's stored step answers. The probe runs commands Map took from worca memory only when a person answered it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { normalizeScriptMeta } from '../src/shared/graph/script-meta.mjs';
import { writeStepQuestions } from '../src/core/artifacts.mjs';
import { cardAOf, CARD_A_FORM } from '../src/core/repo-readiness/run-view.mjs';
import { NIGHT_ACTOR } from '../src/core/night/config.mjs';
import { AUTO_ACTOR } from '../src/core/identity.mjs';
import { projectKey } from '../src/core/store.mjs';

delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function repo() {
  const d = tmp('rca-repo-');
  spawnSync('git', ['init', '-q', d]);
  writeFileSync(join(d, 'CLAUDE.md'), '# x\n');
  spawnSync('git', ['-C', d, 'add', '.']);
  return d;
}

const ASK = { kind: 'form', form: CARD_A_FORM, version: 1, title: 'Does this look right?', data: {} };
const answer = (by) => ({ kind: 'form', form: CARD_A_FORM, version: 1, values: { looksRight: 'correct' }, ...(by ? { answeredBy: by } : {}) });

async function cardAFor(dir, { rows = [], workspace = null } = {}) {
  const { id } = await seedPipeline(dir);
  for (const [i, r] of rows.entries()) {
    await writeStepQuestions(id, `2:n_map#${i + 1}`, 1, { agentKey: 'readinessMap', nodeId: 'n_map', questions: r.questions ?? ASK, ...(r.answers ? { answers: r.answers } : {}) });
  }
  const { meta } = normalizeScriptMeta({ metaVersion: 2, key: 'probe', runtime: 'node', file: 'prog.mjs', inputs: [], outputs: [], readiness: true });
  const pipelineDir = tmp('rca-pipe-');
  const file = join(tmp('rca-prog-'), 'prog.mjs');
  writeFileSync(file, 'export default (api) => ({ summary: JSON.stringify({ cardA: api.readiness.cardA ?? \'absent\', members: !!api.readiness.members }) });\n');
  const ctx = {
    node: { id: 'n_probe', kind: 'script', key: 'probe' }, executionId: 'x:n_probe:1', ordinal: 1, cycle: 1, pipelineDir, pipelineId: id,
    projectDir: dir, runCtx: { pipelineDir, projectDir: dir }, ports: { inputs: [], outputs: [] }, outputs: {}, verdict: null,
    bindings: {}, trigger: {}, script: { meta, runtime: 'node', file, params: {}, timeoutMs: 30000 }, claudeOpts: {},
    ...(workspace || {}),
  };
  return JSON.parse((await runScriptExecution(ctx)).summary);
}

test('cardAOf: the row\'s recorded actor decides; only an explicit person is user; the latest answer wins', () => {
  // A readStepQuestions row: the raw actor at the top (answeredByOf), formAnswer marks only Away mode.
  const row = (by, form = CARD_A_FORM, answered = true) => ({ ask: { kind: 'form', form },
    formAnswer: answered ? { form, values: {}, ...(by === NIGHT_ACTOR ? { answeredBy: 'away' } : {}) } : null, ...(by ? { answeredBy: by } : {}) });
  assert.deepEqual(cardAOf([]), { by: null });
  assert.deepEqual(cardAOf(undefined), { by: null });
  assert.deepEqual(cardAOf([row('local', CARD_A_FORM, false)]), { by: null }, 'asked, not answered');
  assert.deepEqual(cardAOf([row('local')]), { by: 'user' });
  assert.deepEqual(cardAOf([row('ada@example.com')]), { by: 'user' });
  assert.deepEqual(cardAOf([row('ada via Slack')]), { by: 'user' });
  assert.deepEqual(cardAOf([row(NIGHT_ACTOR)]), { by: 'away' });
  assert.deepEqual(cardAOf([row(AUTO_ACTOR)]), { by: null }, 'the --yes auto-answer is nobody');
  assert.deepEqual(cardAOf([row(null)]), { by: null }, 'no recorded actor: fail closed');
  assert.deepEqual(cardAOf([row('local', 'other')]), { by: null }, 'another form is not card A');
  assert.deepEqual(cardAOf([row(NIGHT_ACTOR), row('local')]), { by: 'user' }, 'the latest answer wins');
  assert.deepEqual(cardAOf([row('local'), row(AUTO_ACTOR)]), { by: null });
});

test('a person\'s answer on card A gives cardA.by user', async () => {
  const v = await cardAFor(repo(), { rows: [{ answers: answer('local') }] });
  assert.deepEqual(v.cardA, { by: 'user' });
});

test('an answer with no recorded actor is nobody (fail closed)', async () => {
  const v = await cardAFor(repo(), { rows: [{ answers: answer(null) }] });
  assert.deepEqual(v.cardA, { by: null });
});

test('the --yes auto-answer (answeredBy auto) is nobody', async () => {
  const v = await cardAFor(repo(), { rows: [{ answers: answer(AUTO_ACTOR) }] });
  assert.deepEqual(v.cardA, { by: null });
});

test('Away mode\'s answer on card A gives cardA.by away', async () => {
  const v = await cardAFor(repo(), { rows: [{ answers: answer(NIGHT_ACTOR) }] });
  assert.deepEqual(v.cardA, { by: 'away' });
});

test('no answer (an unattended run, or card A asked but open) gives cardA.by null', async () => {
  assert.deepEqual((await cardAFor(repo())).cardA, { by: null });
  assert.deepEqual((await cardAFor(repo(), { rows: [{}] })).cardA, { by: null });
});

test('another form\'s answer is not card A', async () => {
  const other = { kind: 'form', form: 'something-else', version: 1, values: {}, answeredBy: 'local' };
  const v = await cardAFor(repo(), { rows: [{ questions: { ...ASK, form: 'something-else' }, answers: other }] });
  assert.deepEqual(v.cardA, { by: null });
});

test('a workspace run carries cardA once, at the top level beside members', async () => {
  const a = repo(); const b = repo();
  const ka = projectKey(a); const kb = projectKey(b);
  const v = await cardAFor(a, {
    rows: [{ answers: answer('local') }],
    workspace: {
      runRoot: tmp('rca-root-'),
      workspace: { projects: [{ projectKey: ka, projectDir: a, worktreeDir: a }, { projectKey: kb, projectDir: b, worktreeDir: b }] },
      repos: [{ projectKey: ka, dir: a }, { projectKey: kb, dir: b }],
    },
  });
  assert.equal(v.members, true);
  assert.deepEqual(v.cardA, { by: 'user' });
});
