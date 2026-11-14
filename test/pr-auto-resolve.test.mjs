// test/pr-auto-resolve.test.mjs — "open a PR when a run finishes": the body check, the resolution order
// (run > project / workspace > team policy > none) with its sources, the exempt kinds, a feature's copy and the outcome writer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { writeWorkspaceSettings } from '../src/core/workspace-settings.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import {
  checkRunPrBody, scopePrSetting, resolveRunPr, readRunPrAuto, setRunPrOutcome, featurePrSetting, setFeaturePrOutcome, prAutoView, logToRun,
} from '../src/core/pr-auto.mjs';
import { PR_EXEMPT } from '../src/shared/pr-auto.mjs';
import { RUN_LOG_FILE } from '../src/core/run-log.mjs';
import { readFileSync } from 'node:fs';

useTempHome(after, 'worca-pr-auto-');
const dirs = [];
const repo = (tag) => { const d = gitDir(tag); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
before(() => { getDb(); });

const proj = repo('prauto-a');
const other = repo('prauto-b');
const policy = (dir, fields = {}, workspaceRuns = {}) => writeTeamPolicyPrefs(projectKey(dir), {
  present: true, docKnown: true, slug: `acme/${projectKey(dir)}`, headSha: 'abc1234', delegateTo: null,
  doc: { schema: 1, fields, workspaceRuns, catalogs: { guardrailSets: [], models: [] } },
});
const clearPolicy = (dir) => writeTeamPolicyPrefs(projectKey(dir), { present: false });
const D = (value) => ({ kind: 'default', value });

test('project: run > project > team (fields) > none, each with its source', async () => {
  clearPolicy(proj);
  assert.deepEqual(await resolveRunPr({ projectDir: proj }), { open: 'none', slices: 'each', scope: 'project', source: { open: 'default', slices: 'default' } });
  policy(proj, { 'pr.open': D('ready'), 'pr.slices': D('one') });
  let r = await resolveRunPr({ projectDir: proj });
  assert.deepEqual([r.open, r.slices, r.source], ['ready', 'one', { open: 'team', slices: 'team' }]);
  writeProjectSettings(proj, { 'pr.open': 'draft' });
  r = await resolveRunPr({ projectDir: proj });
  assert.deepEqual([r.open, r.slices, r.source], ['draft', 'one', { open: 'project', slices: 'team' }]);
  r = await resolveRunPr({ projectDir: proj, pr: { open: 'none', slices: 'each' } });
  assert.deepEqual([r.open, r.slices, r.source], ['none', 'each', { open: 'run', slices: 'run' }]);
  r = await resolveRunPr({ projectDir: proj, pr: { slices: 'each' } });
  assert.deepEqual([r.open, r.source], ['draft', { open: 'project', slices: 'run' }], 'a key the run did not send keeps the setting');
  writeProjectSettings(proj, { 'pr.open': null });
  clearPolicy(proj);
});

test('workspace: run > workspace > team workspaceRuns > team fields > none; slices is null and a run slices is ignored', async () => {
  const ws = await createWorkspace({ name: 'PR auto ws', projectPaths: [proj, other], policyProject: proj });
  assert.deepEqual((await scopePrSetting({ workspaceId: ws.id })).open, { value: 'none', source: 'default' });
  policy(proj, { 'pr.open': D('ready') });
  assert.deepEqual((await scopePrSetting({ workspaceId: ws.id })).open, { value: 'ready', source: 'team' }, 'fields apply when workspaceRuns is silent');
  policy(proj, { 'pr.open': D('ready') }, { 'pr.open': D('draft') });
  assert.deepEqual((await scopePrSetting({ workspaceId: ws.id })).open, { value: 'draft', source: 'team' }, 'workspaceRuns replaces fields');
  writeWorkspaceSettings(ws.id, { 'pr.open': 'none' });
  let r = await resolveRunPr({ workspaceId: ws.id, projectDir: proj });
  assert.deepEqual([r.scope, r.open, r.slices, r.source], ['workspace', 'none', null, { open: 'workspace', slices: null }]);
  r = await resolveRunPr({ workspaceId: ws.id, projectDir: proj, pr: { open: 'ready', slices: 'one' } });
  assert.deepEqual([r.open, r.slices, r.source], ['ready', null, { open: 'run', slices: null }]);
  clearPolicy(proj);
});

test('stale or missing policy home → no team layer, never a throw', async () => {
  const third = repo('prauto-c');
  const ws = await createWorkspace({ name: 'PR auto ws stale', projectPaths: [other, third] });   // no policy home
  assert.deepEqual(await scopePrSetting({ workspaceId: ws.id }), { scope: 'workspace', open: { value: 'none', source: 'default' }, slices: null });
  assert.deepEqual(await scopePrSetting({ workspaceId: 'wks-gone-00000000' }), { scope: 'workspace', open: { value: 'none', source: 'default' }, slices: null });
  assert.deepEqual(await scopePrSetting({}), { scope: 'none', open: { value: 'none', source: 'default' }, slices: null });
});

test('checkRunPrBody refusals (each message)', () => {
  assert.deepEqual(checkRunPrBody(undefined), { ok: true, pr: null });
  assert.deepEqual(checkRunPrBody(null), { ok: true, pr: null });
  assert.deepEqual(checkRunPrBody({ open: 'draft', slices: 'one' }), { ok: true, pr: { open: 'draft', slices: 'one' } });
  assert.deepEqual(checkRunPrBody({}), { ok: true, pr: null });
  assert.equal(checkRunPrBody('draft').error, 'pr must be an object like { "open": "draft" }');
  assert.equal(checkRunPrBody(['draft']).error, 'pr must be an object like { "open": "draft" }');
  assert.equal(checkRunPrBody({ open: 'always' }).error, 'pr.open must be one of none | draft | ready');
  assert.equal(checkRunPrBody({ slices: 'both' }).error, 'pr.slices must be one of each | one');
  assert.equal(checkRunPrBody({ nope: 1 }).error, 'pr: unknown key "nope"');
});

test('every exempt kind forces none and records the exemption', async () => {
  writeProjectSettings(proj, { 'pr.open': 'ready' });
  for (const exempt of PR_EXEMPT.filter((k) => k !== 'no-project')) {
    const r = await resolveRunPr({ projectDir: proj, pr: { open: 'draft' }, exempt });
    assert.deepEqual([r.open, r.slices, r.exempt], ['none', null, exempt], exempt);
  }
  const np = await resolveRunPr({ projectDir: proj, noProject: true, pr: { open: 'draft' } });
  assert.deepEqual([np.open, np.exempt, np.scope], ['none', 'no-project', 'none']);
  writeProjectSettings(proj, { 'pr.open': null });
});

const outline = { why: 'w', slices: [1, 2].map((n) => ({ id: `s${n}`, title: `S${n}`, goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'S' })) };
let feat;
const makeFeature = async (pr, extra = {}) => {
  const { id: pipelineId } = await seedPipeline(proj, { status: 'done' });
  return { pipelineId, ...createSliceFeature({ pipelineId, projectDir: proj, title: 'Feat', outline, perspectives: [], workflowId: 'wf_x', pr, ...extra }) };
};

test('a slice request reads the feature and ignores pr; a re-plan request reads the replaced feature; a pre-v86 feature reads as none', async () => {
  feat = await makeFeature({ open: 'draft', slices: 'one', source: { open: 'team', slices: 'project' } });
  const s = await resolveRunPr({ projectDir: proj, shape: { slice: { feature: feat.id, index: 2 } }, pr: { open: 'ready' } });
  assert.deepEqual([s.open, s.slices, s.source, s.featureId], ['draft', 'one', { open: 'feature', slices: 'feature' }, feat.id]);
  const rp = await resolveRunPr({ projectDir: proj, shape: { replaces: feat.id } });
  assert.deepEqual([rp.open, rp.slices, rp.featureId], ['draft', 'one', feat.id]);
  const legacy = await makeFeature(null);
  const l = await resolveRunPr({ projectDir: proj, shape: { slice: { feature: legacy.id } } });
  assert.deepEqual([l.open, l.slices, l.source.open], ['none', 'each', 'feature']);
  assert.deepEqual(featurePrSetting(feat.id), { open: 'draft', slices: 'one', source: { open: 'team', slices: 'project' }, outcome: null, createdBy: null, projectDir: proj });
  assert.equal(featurePrSetting('feat_missing'), null);
});

test('setRunPrOutcome: a non-final outcome is replaced, a final one is written once', async () => {
  const pa = { open: 'draft', slices: null, scope: 'project', source: { open: 'project', slices: null } };
  const { id } = await createPipeline(proj, { prompt: 'x', title: 'x', prAuto: pa });
  assert.equal(readRunPrAuto(id).outcome, undefined);
  assert.equal(setRunPrOutcome(id, { status: 'skipped', final: false, reason: 'a', at: 't1' }), true);
  assert.equal(setRunPrOutcome(id, { status: 'opened', final: true, urls: ['u'], at: 't2' }), true, 'a non-final one is replaced');
  assert.equal(setRunPrOutcome(id, { status: 'failed', final: true, reason: 'b', at: 't3' }), false, 'a final one is written once');
  assert.equal(readRunPrAuto(id).outcome.status, 'opened');
  assert.deepEqual(readRunPrAuto(id).source, pa.source, 'the decision itself is untouched');
  const plain = await createPipeline(proj, { prompt: 'y', title: 'y' });
  assert.equal(setRunPrOutcome(plain.id, { status: 'opened', final: true, at: 't' }), false, 'no row value, no outcome');
  assert.equal(readRunPrAuto(plain.id), null);
});

test('setFeaturePrOutcome writes when none is recorded or the last is held; prAutoView shows a slice run the feature values', async () => {
  const f = await makeFeature({ open: 'ready', slices: 'one', source: { open: 'run', slices: 'run' } });
  assert.equal(setFeaturePrOutcome(f.id, { status: 'held', final: false, at: 't1' }), true);
  assert.equal(setFeaturePrOutcome(f.id, { status: 'opened', final: true, urls: ['u'], at: 't2' }), true);
  assert.equal(setFeaturePrOutcome(f.id, { status: 'failed', final: true, at: 't3' }), false);
  assert.equal(featurePrSetting(f.id).outcome.status, 'opened');
  // the origin run of the feature is slice 1: its header shows the feature's values, read-only
  const origin = getDb().prepare('SELECT origin_pipeline_id AS p FROM shape_features WHERE id = ?').get(f.id).p;
  getDb().prepare('UPDATE pipelines SET pr_auto = ? WHERE id = ?').run(JSON.stringify({ open: 'none', slices: 'each', scope: 'project', source: { open: 'default', slices: 'default' } }), origin);
  const v = prAutoView(origin);
  assert.deepEqual([v.open, v.slices, v.source, v.readOnly, v.feature.id, v.feature.source, v.feature.outcome.status],
    ['ready', 'one', { open: 'feature', slices: 'feature' }, true, f.id, { open: 'run', slices: 'run' }, 'opened']);
  assert.equal(prAutoView('00000000'), null);
});

test('logToRun appends a pr line to the run live log and never throws for an unknown run', async () => {
  const { id, dir } = await createPipeline(proj, { prompt: 'z', title: 'z' });
  await logToRun(id, 'info', 'Opened a draft pull request: u');
  const line = JSON.parse(readFileSync(join(dir, RUN_LOG_FILE), 'utf8').trim());
  assert.deepEqual([line.source, line.level, line.text], ['pr', 'info', 'Opened a draft pull request: u']);
  assert.ok(Date.parse(line.ts));
  await logToRun('ffffffff', 'info', 'x');
});
