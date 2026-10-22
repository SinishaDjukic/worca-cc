// test/draft-release.test.mjs — Shaper s4: the PR-state pass (exactly one draft release, only after the merge), the
// version hint, and git-info's latestTag / createDraftRelease.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { createSliceFeature, recordShip } from '../src/core/shape/features.mjs';
import { draftReleasesOnMerge, recordRunRelease, releaseVersionHint } from '../src/core/draft-release.mjs';
import { createDraftRelease, latestTag, _testing as gitInfo } from '../src/core/git-info.mjs';

useTempHome(after, 'worca-draft-release-');
const tmp = [];
after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });
afterEach(() => gitInfo.reset());
const mkTmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-draft-release-repo-')); tmp.push(d); return d; };

// The full slice shape: createSliceFeature builds slice 2's ticket through sliceBrief (inScope / outOfScope / acceptance).
const slice = (n) => ({ id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [`do ${n}`], outOfScope: [], acceptance: [`ok ${n}`],
  dependsOn: [], estimate: 'M' });

let seq = 0;
function shippedFeature(mode = 'one', { release = { version: 'v1.12.0', target: 'main' } } = {}) {
  const dir = '/tmp/worca-draft-release-proj';
  const n = ++seq;
  const pids = [1, 2].map((i) => { const id = `pipe_dr${n}${mode}${i}`; seedPipelineRow({ id, projectKey: 'dr', status: 'done', title: `F · ${i}/2` }); return id; });
  const f = createSliceFeature({ pipelineId: pids[0], projectDir: dir, title: 'F', perspectives: ['product'], workflowId: 'wf_shape',
    outline: { why: 'because', slices: [slice(1), slice(2)] }, base: { mock: true } });
  // Slice 2 is linked the way production does: through its fired ticket (shape_feature_slices.pipeline_id stays null).
  const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pids[1], t);
  pids.forEach((p, i) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = 'OPEN' WHERE id = ?")
    .run(`https://github.com/me/repo${n}/pull/${i + 1}`, i + 1, p));
  recordShip(f.id, { mode, prUrl: mode === 'one' ? `https://github.com/me/repo${n}/pull/9` : null, release });
  return { ...f, n, pids };
}
const releaseRow = (table, id) => ({ ...getDb().prepare(`SELECT release_url, release_at, release_error FROM ${table} WHERE id = ?`).get(id) });

test('MERGED → exactly one draft release with the stored version; not before the merge; not twice', async () => {
  const f = shippedFeature('one');
  const calls = [];
  let state = 'OPEN';
  const deps = { prState: async () => state, createRelease: async (a) => { calls.push(a); return { ok: true, url: 'https://github.com/me/repo/releases/tag/v1.12.0' }; } };
  await draftReleasesOnMerge(deps);
  assert.equal(calls.length, 0, 'not before the merge');
  state = 'MERGED';
  await draftReleasesOnMerge(deps);
  await draftReleasesOnMerge(deps);
  assert.equal(calls.length, 1, 'exactly once');
  assert.deepEqual({ tag: calls[0].tag, prUrl: calls[0].prUrl, target: calls[0].target },
    { tag: 'v1.12.0', prUrl: `https://github.com/me/repo${f.n}/pull/9`, target: 'main' });
  const row = releaseRow('shape_features', f.id);
  assert.equal(row.release_url, 'https://github.com/me/repo/releases/tag/v1.12.0');
  assert.ok(row.release_at);
});

test('stacked: the watched PR is the last slice\'s (linked through its fired ticket)', async () => {
  const f = shippedFeature('stacked');
  const seen = [];
  await draftReleasesOnMerge({ prState: async ({ prUrl }) => { seen.push(prUrl); return 'OPEN'; }, createRelease: async () => ({ ok: true }) });
  assert.ok(seen.includes(`https://github.com/me/repo${f.n}/pull/2`), JSON.stringify(seen));
  assert.ok(!seen.includes(`https://github.com/me/repo${f.n}/pull/1`));
});

test('a failed create stores release_error and is never called again; a feature without a release is never asked', async () => {
  const f = shippedFeature('one');
  const none = shippedFeature('one', { release: null });
  const seen = []; const calls = [];
  // Earlier tests' features are still pending (the stacked one): count this feature's calls only.
  const deps = { prState: async ({ prUrl }) => { seen.push(prUrl); return 'MERGED'; }, createRelease: async (a) => { calls.push(a.prUrl); return { ok: false, error: 'tag exists' }; } };
  const out = await draftReleasesOnMerge(deps);
  assert.ok(out.failed.some((x) => x.id === f.id && x.error === 'tag exists'));
  await draftReleasesOnMerge(deps);
  assert.equal(calls.filter((u) => u === `https://github.com/me/repo${f.n}/pull/9`).length, 1);
  assert.equal(releaseRow('shape_features', f.id).release_error, 'tag exists');
  assert.ok(!seen.includes(`https://github.com/me/repo${none.n}/pull/9`));
});

test('a single run\'s choice (recordRunRelease) gets one draft release after MERGED', async () => {
  const dir = mkTmp();
  writeStoreMeta('dr-run', 'project', { key: 'dr-run', path: dir, name: 'Run' });
  seedPipelineRow({ id: 'pipe_drrun', projectKey: 'dr-run', status: 'done' });
  getDb().prepare("UPDATE pipelines SET pr_url = 'https://github.com/me/solo/pull/4' WHERE id = 'pipe_drrun'").run();
  assert.equal(recordRunRelease('pipe_drrun', { version: 'v2.0.0', target: 'main' }), true);
  const calls = [];
  const deps = { prState: async ({ prUrl }) => (prUrl.includes('/solo/') ? 'MERGED' : 'OPEN'),
    createRelease: async (a) => { calls.push(a); return { ok: true, url: 'https://github.com/me/solo/releases/tag/v2.0.0' }; } };
  await draftReleasesOnMerge(deps);
  await draftReleasesOnMerge(deps);
  const mine = calls.filter((c) => c.prUrl === 'https://github.com/me/solo/pull/4');
  assert.equal(mine.length, 1);
  assert.deepEqual({ tag: mine[0].tag, target: mine[0].target, projectDir: mine[0].projectDir }, { tag: 'v2.0.0', target: 'main', projectDir: dir });
  assert.equal(releaseRow('pipelines', 'pipe_drrun').release_url, 'https://github.com/me/solo/releases/tag/v2.0.0');
  assert.equal(recordRunRelease('pipe_drrun', { version: 'v3.0.0' }), false, 'claimed: the choice no longer changes');
});

test('releaseVersionHint: last tag + minor, else package.json, else nothing', async () => {
  const git = (d, ...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
  const tagged = mkTmp();
  git(tagged, 'init', '-q');
  git(tagged, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  git(tagged, 'tag', 'v1.11.0');
  assert.equal((await releaseVersionHint(tagged)).version, 'v1.12.0');
  assert.equal(await latestTag(tagged), 'v1.11.0');
  const pkg = mkTmp();
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.4.0' }));
  assert.deepEqual(await releaseVersionHint(pkg), { version: 'v1.4.0', from: 'package', lastTag: null, packageVersion: '1.4.0' });
  assert.equal((await releaseVersionHint(mkTmp())).version, null);
});

test('createDraftRelease: one gh release create --draft on the PR\'s repo; Azure → ok:false with no gh call', async () => {
  const seen = [];
  gitInfo.setRunner(async (cmd, args) => { seen.push([cmd, ...args]); return { ok: true, code: 0, stdout: 'https://github.com/me/repo/releases/tag/v1.12.0\n', stderr: '' }; });
  const r = await createDraftRelease({ prUrl: 'https://github.com/me/repo/pull/9', tag: 'v1.12.0', target: 'main' });
  assert.deepEqual(r, { ok: true, url: 'https://github.com/me/repo/releases/tag/v1.12.0' });
  const gh = seen.filter((a) => a[0] === 'gh');
  assert.equal(gh.length, 1);
  assert.deepEqual(gh[0], ['gh', 'release', 'create', 'v1.12.0', '--draft', '--repo', 'me/repo', '--title', 'v1.12.0', '--generate-notes', '--target', 'main']);
  seen.length = 0;
  const az = await createDraftRelease({ prUrl: 'https://dev.azure.com/o/p/_git/r/pullrequest/5', tag: 'v1.12.0' });
  assert.equal(az.ok, false);
  assert.ok(az.error);
  assert.equal(seen.filter((a) => a[0] === 'gh').length, 0);
});
