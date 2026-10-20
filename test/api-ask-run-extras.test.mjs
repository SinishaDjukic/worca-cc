// test/api-ask-run-extras.test.mjs — worca Chat P3: what the chat run card's result region reads for a finished run.
// runCardResults shapes results.json (src/core/results.mjs assembleResults) into counts + the top files by churn;
// GET /api/ask/runs/:id carries it as `extras` with the last (newest) artifacts and the PR — null while a run is not over.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { recordArtifact, persistPrState } from '../src/core/artifacts.mjs';
import { noProjectWorkDir } from '../src/core/store.mjs';
import { runCardResults, lastArtifactsWindow, RUN_CARD_ARTIFACTS } from '../src/core/ask/run-card-extras.mjs';

useTempHome(after);                       // WORCA_HOME is a temp dir from here on; db.mjs opens lazily
let mod, srv, base;
const tmpDirs = [];
before(async () => {
  mod = await import('../ui/server.mjs');   // DYNAMIC: evaluated after useTempHome() ran
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  closeDbForTests();
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});
async function makeProjectDir() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-ask-extras-')); tmpDirs.push(d); return d; }

const RESULTS = {
  summary: { filesNew: 1, filesChanged: 2, filesDeleted: 0, linesAdded: 40, linesRemoved: 7, blockingIssues: 0, nitpicks: 0 },
  newFiles: [{ path: 'src/new.mjs', status: 'A', added: 30, removed: 0 }],
  changedFiles: [
    { path: 'src/a.mjs', status: 'M', added: 6, removed: 5, issues: [] },
    { path: 'img/logo.png', status: 'M', binary: true, issues: [] },
  ],
  keyThingsToCheck: [{ title: 'Null check in a.mjs' }],
  nitpicks: [],
};

test('runCardResults: counts, checks and the top files by churn (ties by path, never by locale); workspace runs read every project; junk is null', async () => {
  await checkRows([
    { name: 'a project run', run: async () => {
      assert.deepEqual(runCardResults(RESULTS), {
        filesChanged: 3, additions: 40, deletions: 7, checks: 1, topFiles: [
          { path: 'src/new.mjs', additions: 30, deletions: 0, status: 'A' },
          { path: 'src/a.mjs', additions: 6, deletions: 5, status: 'M' },
          { path: 'img/logo.png', additions: 0, deletions: 0, status: 'M', binary: true },
        ] });
    } },
    { name: 'top caps the list; equal churn sorts by code point', run: async () => {
      const raw = { summary: { filesNew: 0, filesChanged: 3, linesAdded: 3, linesRemoved: 0 },
        changedFiles: [{ path: 'b', status: 'M', added: 1, removed: 0 }, { path: 'B', status: 'M', added: 1, removed: 0 }, { path: 'a', status: 'M', added: 1, removed: 0 }] };
      assert.deepEqual(runCardResults(raw, { top: 2 }).topFiles.map((f) => f.path), ['B', 'a']);
    } },
    { name: 'a workspace run reads perProject and tags each file with its project', run: async () => {
      const raw = { summary: { filesNew: 0, filesChanged: 2, linesAdded: 9, linesRemoved: 2 }, perProject: {
        'api-00000001': { changedFiles: [{ path: 'srv.mjs', status: 'M', added: 8, removed: 2 }], keyThingsToCheck: [{}, {}] },
        'web-00000002': { newFiles: [{ path: 'app.js', status: 'A', added: 1, removed: 0 }] } } };
      const out = runCardResults(raw);
      assert.equal(out.checks, 2);
      assert.deepEqual(out.topFiles, [
        { path: 'srv.mjs', additions: 8, deletions: 2, status: 'M', projectKey: 'api-00000001' },
        { path: 'app.js', additions: 1, deletions: 0, status: 'A', projectKey: 'web-00000002' }]);
    } },
    { name: 'no summary → null', run: async () => {
      assert.equal(runCardResults(null), null);
      assert.equal(runCardResults({}), null);
      assert.equal(runCardResults({ summary: 'x' }), null);
    } },
    { name: 'lastArtifactsWindow: the last page of the browsable rows (hidden kinds never count)', run: async () => {
      const rows = [{ kind: 'prompt' }, { kind: 'live-log' }, { kind: 'plan' }, { kind: 'review' }, { kind: 'deck-asset' }];
      assert.deepEqual(lastArtifactsWindow(rows, 2), { total: 3, offset: 1 });
      assert.deepEqual(lastArtifactsWindow(rows, 6), { total: 3, offset: 0 });
      assert.deepEqual(lastArtifactsWindow(null), { total: 0, offset: 0 });
    } },
  ]);
});

test('GET /api/ask/runs/:id carries the chat card extras for a finished run (results, artifacts, PR) and null for a running one', async () => {
  const { id, dir } = await seedPipeline(await makeProjectDir(), { title: 'Done run', status: 'done', steps: [] });
  await writeFile(join(dir, 'results.json'), JSON.stringify(RESULTS));
  recordArtifact(id, 'plan', 'plan.md');             // createPipeline already indexed prompt.md (artifacts.mjs createPipeline)
  persistPrState(id, { url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN' });
  const body = await (await fetch(`${base}/api/ask/runs/${id}`)).json();
  assert.equal(body.state.id, id);
  assert.deepEqual(body.extras.results, runCardResults(RESULTS));
  assert.deepEqual(body.extras.artifacts.map((a) => a.relPath).sort(), ['plan.md', 'prompt.md']);
  assert.deepEqual(Object.keys(body.extras.artifacts[0]).sort(), ['bytes', 'cycle', 'kind', 'nodeId', 'relPath']);
  assert.equal(body.extras.moreArtifacts, false);
  assert.deepEqual(body.extras.pr, { url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN' });

  // Past RUN_CARD_ARTIFACTS the card shows the LAST rows — the newest outputs, not the prompt and the plan.
  for (let i = 0; i < RUN_CARD_ARTIFACTS; i++) recordArtifact(id, 'review', `reviews/r${i}.json`);
  const more = await (await fetch(`${base}/api/ask/runs/${id}`)).json();
  assert.deepEqual(more.extras.artifacts.map((a) => a.relPath), Array.from({ length: RUN_CARD_ARTIFACTS }, (_, i) => `reviews/r${i}.json`));
  assert.equal(more.extras.moreArtifacts, true);

  const stopped = await seedPipeline(await makeProjectDir(), { title: 'Stopped early', status: 'stopped', steps: [] });
  const s = await (await fetch(`${base}/api/ask/runs/${stopped.id}`)).json();
  assert.equal(s.extras.results, null, 'no results.json (a stop with no changes): null, never a 500');
  assert.equal(s.extras.pr, null);
  assert.equal(s.extras.moreArtifacts, false);
  assert.deepEqual(s.extras.artifacts.map((a) => a.relPath), ['prompt.md'], 'createPipeline indexes the prompt for every run');

  const running = await seedPipeline(await makeProjectDir(), { title: 'Running', status: 'running', steps: [] });
  assert.equal((await (await fetch(`${base}/api/ask/runs/${running.id}`)).json()).extras, null);
});

test('runCardResults: checks add up across projects; churn counts removals; exactly RUN_CARD_ARTIFACTS rows is not "more"', async () => {
  const ws = runCardResults({ summary: { filesNew: 0, filesChanged: 0 }, perProject: { 'a-00000001': { keyThingsToCheck: [{}, {}] }, 'b-00000002': { keyThingsToCheck: [{}] } } });
  assert.equal(ws.checks, 3, 'every project\'s things to check');
  const out = runCardResults({ summary: { filesNew: 0, filesChanged: 2 }, changedFiles: [
    { path: 'a-add.mjs', status: 'M', added: 5, removed: 0 }, { path: 'b-del.mjs', status: 'M', added: 0, removed: 9 }] });
  assert.deepEqual(out.topFiles.map((f) => f.path), ['b-del.mjs', 'a-add.mjs'], 'a deletion-heavy file is churn too');
  const { id } = await seedPipeline(await makeProjectDir(), { title: 'Six', status: 'done', steps: [] });
  for (let i = 0; i < RUN_CARD_ARTIFACTS - 1; i++) recordArtifact(id, 'review', `reviews/s${i}.json`);   // + prompt.md = exactly RUN_CARD_ARTIFACTS
  const six = await (await fetch(`${base}/api/ask/runs/${id}`)).json();
  assert.equal(six.extras.artifacts.length, RUN_CARD_ARTIFACTS);
  assert.equal(six.extras.moreArtifacts, false, 'every artifact is already a chip');
});

test('runCardResults passes a single-project checklist tally through as numbers, and never a workspace one (spec D7)', () => {
  const summary = { filesNew: 0, filesChanged: 0 };
  const cl = { met: '1', unmet: 1, na: 0, missing: 2, total: 4, cycle: 2 };
  assert.deepEqual(runCardResults({ summary, checklist: cl }).checklist, { met: 1, unmet: 1, na: 0, missing: 2, total: 4 });
  assert.equal(Object.hasOwn(runCardResults({ summary }), 'checklist'), false);
  assert.equal(Object.hasOwn(runCardResults({ summary, perProject: { 'a-00000001': {} }, checklist: cl }), 'checklist'), false);
});

test('GET /api/ask/runs/:id, a run without a project: its work/ files first (with sizes), then its newest other rows, and the browsable total', async () => {
  const { id, dir } = await seedPipeline(noProjectWorkDir('abcd1234'), { title: 'NP', status: 'done' });
  await mkdir(join(dir, 'work'), { recursive: true });
  await writeFile(join(dir, 'work', 'deck.html'), 'hello');
  recordArtifact(id, 'work', 'work/deck.html');
  await writeFile(join(dir, 'summary.md'), 'done\n');
  recordArtifact(id, 'summary', 'summary.md');
  const { extras } = await (await fetch(`${base}/api/ask/runs/${id}`)).json();
  assert.deepEqual(extras.artifacts[0], { kind: 'work', relPath: 'work/deck.html', bytes: 5, nodeId: null, cycle: null });
  assert.ok(extras.artifacts.some((a) => a.relPath === 'summary.md'), 'room left: the newest other rows follow');
  assert.equal(extras.artifactsTotal, extras.artifacts.length);
  assert.equal(extras.moreArtifacts, false);
});
